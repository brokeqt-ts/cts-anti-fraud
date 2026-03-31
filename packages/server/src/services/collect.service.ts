import type pg from 'pg';
import type { CollectPayloadItem, ProxyInfo, ProfileConfig } from '@cts/shared';
import { processRpcPayload } from '../parsers/rpc-router.js';
import { parseBillingRequestBody } from '../parsers/billing-payment-parser.js';
import { scoreAccountOnUpdate } from './ai/auto-scoring.service.js';
import { classifyAndUpdateAccountType } from './account-type-classifier.js';
import { checkAndCreateBan } from './auto-ban-detector.js';
import { classifyAndUpdateVertical } from './offer-vertical-classifier.js';
import { autoPopulateAccount } from './account-auto-populate.js';
import { ensureAccountExists } from './ensure-account.js';
import { updateAccountHealthScore } from './health-score.service.js';

export class CollectService {
  constructor(private pool: pg.Pool) {}

  async processPayload(profileId: string, batch: CollectPayloadItem[], antidetectBrowser?: string, proxyInfo?: ProxyInfo, fingerprintHash?: string, profileConfig?: ProfileConfig, userId?: string): Promise<number> {
    let processed = 0;

    for (const item of batch) {
      try {
        await this.storeRawPayload(profileId, item, userId);
        processed++;
      } catch (err) {
        console.error(`Failed to process item of type ${item.type}:`, err);
      }
    }

    // Auto-link antidetect profile to accounts found in the batch
    if (antidetectBrowser && antidetectBrowser !== 'unknown') {
      try {
        await this.upsertAntidetectProfile(profileId, antidetectBrowser, batch);
      } catch (err) {
        console.warn('[Collect] Failed to upsert antidetect profile:', err);
      }
    }

    // Update fingerprint hash on antidetect profile
    if (fingerprintHash && antidetectBrowser && antidetectBrowser !== 'unknown') {
      try {
        await this.updateFingerprintHash(profileId, antidetectBrowser, fingerprintHash);
      } catch (err) {
        console.warn('[Collect] Failed to update fingerprint:', err);
      }
    }

    // Auto-save proxy info and link to accounts
    if (proxyInfo?.ip) {
      try {
        await this.upsertProxy(proxyInfo, batch);
      } catch (err) {
        console.warn('[Collect] Failed to upsert proxy:', err);
      }
    }

    // Apply manual profile config (proxy provider, account type, payment service)
    if (profileConfig) {
      try {
        await this.applyProfileConfig(profileConfig, batch);
      } catch (err) {
        console.warn('[Collect] Failed to apply profile config:', err);
      }
    }

    try {
      await this.updateLastReceived();
    } catch (err) {
      console.error('Failed to update last_received timestamp:', err);
    }

    // Auto-score accounts that received new data (non-blocking)
    const accountIds = new Set<string>();
    for (const item of batch) {
      const accountId = item.data?.['accountId'] as string | undefined;
      if (accountId) accountIds.add(accountId);
    }
    for (const accountId of accountIds) {
      scoreAccountOnUpdate(this.pool, accountId).catch(() => {});
      classifyAndUpdateAccountType(this.pool, accountId).catch(() => {});
      classifyAndUpdateVertical(this.pool, accountId).catch(() => {});
      autoPopulateAccount(this.pool, accountId).catch(() => {});
      updateAccountHealthScore(this.pool, accountId).catch(() => {});
    }

    return processed;
  }

  /**
   * Upsert antidetect profile and auto-link to account(s) found in batch data.
   * This fills antidetect_profiles + account_consumables AUTOMATICALLY.
   */
  private async upsertAntidetectProfile(
    profileName: string,
    browserType: string,
    batch: CollectPayloadItem[],
  ): Promise<void> {
    const profileResult = await this.pool.query(
      `INSERT INTO antidetect_profiles (browser_type, profile_name, profile_external_id)
       VALUES ($1::browser_type, $2, $2)
       ON CONFLICT (browser_type, profile_name) WHERE profile_name IS NOT NULL
       DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [browserType, profileName],
    );
    const antidetectProfileId = profileResult.rows[0]?.['id'] as string | undefined;
    if (!antidetectProfileId) return;

    // Collect unique google account IDs from batch (googleCid field)
    const accountGoogleIds = new Set<string>();
    for (const item of batch) {
      const cid = item.data['googleCid'] as string | undefined;
      if (cid) accountGoogleIds.add(cid);
    }

    // Link profile to each account (ON CONFLICT DO NOTHING for idempotency)
    for (const googleId of accountGoogleIds) {
      await this.pool.query(
        `INSERT INTO account_consumables (account_id, antidetect_profile_id)
         SELECT a.id, $2::uuid
         FROM accounts a
         WHERE a.google_account_id = $1
         ON CONFLICT DO NOTHING`,
        [googleId, antidetectProfileId],
      );
    }
  }

  /**
   * Update fingerprint hash for antidetect profile. Detects fingerprint changes.
   */
  private async updateFingerprintHash(
    profileName: string,
    browserType: string,
    newHash: string,
  ): Promise<void> {
    // Find existing profile
    const existing = await this.pool.query(
      `SELECT id, fingerprint_hash FROM antidetect_profiles
       WHERE browser_type = $1::browser_type AND profile_name = $2`,
      [browserType, profileName],
    );

    if (existing.rowCount === 0) return;

    const profileId = existing.rows[0]!['id'] as string;
    const oldHash = existing.rows[0]!['fingerprint_hash'] as string | null;

    if (oldHash && oldHash !== newHash) {
      // Fingerprint changed — log it
      await this.pool.query(
        `UPDATE antidetect_profiles
         SET fingerprint_hash = $1,
             fingerprint_last_changed_at = NOW(),
             fingerprint_change_count = COALESCE(fingerprint_change_count, 0) + 1,
             updated_at = NOW()
         WHERE id = $2`,
        [newHash, profileId],
      );
    } else if (!oldHash) {
      // First fingerprint — just store it
      await this.pool.query(
        `UPDATE antidetect_profiles SET fingerprint_hash = $1, updated_at = NOW() WHERE id = $2`,
        [newHash, profileId],
      );
    }
    // If same hash — no update needed
  }

  /**
   * Upsert proxy by IP address and auto-link to account(s) found in batch data.
   * This fills proxies + account_consumables.proxy_id AUTOMATICALLY.
   */
  private async upsertProxy(
    proxyInfo: ProxyInfo,
    batch: CollectPayloadItem[],
  ): Promise<void> {
    const proxyResult = await this.pool.query(
      `INSERT INTO proxies (proxy_type, ip_address, geo, raw_payload)
       VALUES ('residential', $1, $2, $3)
       ON CONFLICT (ip_address) WHERE ip_address IS NOT NULL
       DO UPDATE SET
         geo = COALESCE(EXCLUDED.geo, proxies.geo),
         raw_payload = EXCLUDED.raw_payload,
         updated_at = NOW()
       RETURNING id`,
      [
        proxyInfo.ip,
        proxyInfo.geo,
        JSON.stringify({ org: proxyInfo.org, asn: proxyInfo.asn, geo: proxyInfo.geo }),
      ],
    );
    const proxyId = proxyResult.rows[0]?.['id'] as string | undefined;
    if (!proxyId) return;

    console.log(`[Collect] Proxy upserted: ${proxyInfo.ip} (${proxyInfo.geo ?? 'unknown geo'}) → ${proxyId}`);

    // Collect unique google account IDs from batch
    const accountGoogleIds = new Set<string>();
    for (const item of batch) {
      const cid = item.data['googleCid'] as string | undefined;
      if (cid) accountGoogleIds.add(cid);
    }

    // Link proxy to each account
    for (const googleId of accountGoogleIds) {
      await this.pool.query(
        `INSERT INTO account_consumables (account_id, proxy_id)
         SELECT a.id, $2::uuid
         FROM accounts a
         WHERE a.google_account_id = $1
         ON CONFLICT DO NOTHING`,
        [googleId, proxyId],
      );
    }
  }

  private async storeRawPayload(profileId: string, item: CollectPayloadItem, userId?: string): Promise<void> {
    switch (item.type) {
      case 'account':
        await this.processAccountData(profileId, item, userId);
        break;
      case 'campaign':
        await this.processCampaignData(profileId, item);
        break;
      case 'performance':
        await this.processPerformanceData(profileId, item);
        break;
      case 'billing':
        await this.processBillingData(profileId, item);
        break;
      case 'ad_review':
        await this.processAdReviewData(profileId, item);
        break;
      case 'status_change':
        await this.processStatusChangeData(profileId, item, userId);
        break;
      case 'billing_request':
        await this.processBillingRequest(profileId, item, userId);
        break;
      case 'raw':
      case 'raw_text':
        await this.processRawData(profileId, item, userId);
        break;
    }
  }

  private async processBillingRequest(profileId: string, item: CollectPayloadItem, userId?: string): Promise<void> {
    const data = item.data as Record<string, unknown>;
    const requestBody = data['requestBody'] as string | undefined;
    const sourceUrl = (data['url'] as string | undefined) ?? null;
    const googleCid = data['googleCid'] as string | undefined;
    const effectiveProfileId = googleCid ?? profileId;

    // 1. Always save raw to raw_payloads for debugging
    const rawResult = await this.pool.query(
      `INSERT INTO raw_payloads (profile_id, item_type, source_url, raw_payload, user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [effectiveProfileId, 'billing_request', sourceUrl, JSON.stringify(data), userId ?? null],
    );
    const rawPayloadId = rawResult.rows[0]?.['id'] as string | undefined;

    if (!requestBody) return;

    // 2. Parse
    const parsed = parseBillingRequestBody(requestBody);
    if (!parsed) return; // Not a payment submission

    console.log(`[Collect] Billing request parsed: ${parsed.cardNetwork} •••• ${parsed.last4} (${parsed.countryCode ?? 'unknown'})`);

    // 3. Upsert payment_methods (dedup by bin + last4)
    const pmResult = await this.pool.query(
      `INSERT INTO payment_methods (
         bin, bin8, last4, card_network, card_type_code, pan_hash,
         expiry_month, expiry_year, cardholder_name,
         billing_street, billing_postal_code, billing_city,
         country, locale, instrument_display, payment_token,
         raw_payload_id, extracted_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
       ON CONFLICT (bin, last4) WHERE bin IS NOT NULL AND last4 IS NOT NULL DO UPDATE SET
         bin8 = COALESCE(EXCLUDED.bin8, payment_methods.bin8),
         card_network = COALESCE(EXCLUDED.card_network, payment_methods.card_network),
         card_type_code = COALESCE(EXCLUDED.card_type_code, payment_methods.card_type_code),
         pan_hash = COALESCE(EXCLUDED.pan_hash, payment_methods.pan_hash),
         expiry_month = COALESCE(EXCLUDED.expiry_month, payment_methods.expiry_month),
         expiry_year = COALESCE(EXCLUDED.expiry_year, payment_methods.expiry_year),
         cardholder_name = COALESCE(EXCLUDED.cardholder_name, payment_methods.cardholder_name),
         billing_street = COALESCE(EXCLUDED.billing_street, payment_methods.billing_street),
         billing_postal_code = COALESCE(EXCLUDED.billing_postal_code, payment_methods.billing_postal_code),
         billing_city = COALESCE(EXCLUDED.billing_city, payment_methods.billing_city),
         country = COALESCE(EXCLUDED.country, payment_methods.country),
         locale = COALESCE(EXCLUDED.locale, payment_methods.locale),
         instrument_display = COALESCE(EXCLUDED.instrument_display, payment_methods.instrument_display),
         payment_token = COALESCE(EXCLUDED.payment_token, payment_methods.payment_token),
         raw_payload_id = EXCLUDED.raw_payload_id,
         extracted_at = NOW(),
         updated_at = NOW()
       RETURNING id`,
      [
        parsed.bin6,
        parsed.bin8,
        parsed.last4,
        parsed.cardNetwork,
        parsed.cardTypeCode,
        parsed.panHash,
        parsed.expiryMonth,
        parsed.expiryYear,
        parsed.cardholderName,
        parsed.billingAddress?.street ?? null,
        parsed.billingAddress?.postalCode ?? null,
        parsed.billingAddress?.city ?? null,
        parsed.countryCode,
        parsed.locale,
        parsed.instrumentDisplay,
        parsed.paymentToken,
        rawPayloadId ?? null,
      ],
    );
    const paymentMethodId = pmResult.rows[0]?.['id'] as string | undefined;
    if (!paymentMethodId) return;

    // 4. Link to account if we can resolve it
    const accountResult = await this.pool.query(
      `SELECT id FROM accounts WHERE google_account_id = $1`,
      [effectiveProfileId],
    );

    if (accountResult.rows.length > 0) {
      const accountId = accountResult.rows[0]['id'] as string;

      // Update accounts.payment_bin, accounts.payment_card_country
      await this.pool.query(
        `UPDATE accounts SET
           payment_bin = COALESCE($1, payment_bin),
           payment_card_country = COALESCE($2, payment_card_country),
           updated_at = NOW()
         WHERE id = $3`,
        [parsed.bin6, parsed.countryCode, accountId],
      );

      // Link via account_consumables
      await this.pool.query(
        `INSERT INTO account_consumables (account_id, payment_method_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [accountId, paymentMethodId],
      );

      console.log(`[Collect] Payment method ${paymentMethodId} linked to account ${accountId}`);
    }
  }

  private async processRawData(profileId: string, item: CollectPayloadItem, userId?: string): Promise<void> {
    const sourceUrl = (item.data['url'] as string | undefined) ?? null;

    // Prefer googleCid from extension page URL over antidetect profile name
    const googleCid = item.data['googleCid'] as string | undefined;
    const effectiveProfileId = googleCid ?? profileId;

    const result = await this.pool.query(
      `INSERT INTO raw_payloads (profile_id, item_type, source_url, raw_payload, user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [effectiveProfileId, item.type, sourceUrl, JSON.stringify(item.data), userId ?? null],
    );

    // Attempt structured RPC extraction
    const rawPayloadId = result.rows[0]?.['id'] as string | undefined;
    if (rawPayloadId && sourceUrl) {
      try {
        await processRpcPayload(this.pool, rawPayloadId, sourceUrl, item.data as Record<string, unknown>, effectiveProfileId, userId);
      } catch (err) {
        console.warn('[RPC Parser] Failed to parse:', err);
      }
    }
  }

  private async processAccountData(_profileId: string, item: CollectPayloadItem, userId?: string): Promise<void> {
    const data = item.data as Record<string, unknown>;
    const googleAccountId = data['accountId'] as string | undefined;

    if (!googleAccountId) return;

    // Validate CID format before inserting
    const accountId = await ensureAccountExists(this.pool, googleAccountId, userId);
    if (!accountId) return;

    // Update with richer data from the structured 'account' item
    await this.pool.query(
      `UPDATE accounts SET
         display_name = COALESCE($1, display_name),
         status = COALESCE($2, status),
         raw_payload = $3,
         updated_at = NOW()
       WHERE id = $4`,
      [
        (data['displayName'] as string | undefined) ?? null,
        (data['status'] as string | undefined) ?? 'active',
        JSON.stringify(item.data),
        accountId,
      ],
    );
  }

  private async processCampaignData(_profileId: string, item: CollectPayloadItem): Promise<void> {
    const data = item.data as Record<string, unknown>;
    const googleAccountId = data['accountId'] as string | undefined;
    const googleCampaignId = data['campaignId'] as string | undefined;

    if (!googleAccountId || !googleCampaignId) return;

    const accountResult = await this.pool.query(
      `SELECT id FROM accounts WHERE google_account_id = $1`,
      [googleAccountId],
    );

    if (accountResult.rows.length === 0) return;

    const accountId = accountResult.rows[0]['id'] as string;

    await this.pool.query(
      `INSERT INTO campaigns (account_id, google_campaign_id, campaign_name, campaign_type, status, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [
        accountId,
        googleCampaignId,
        data['campaignName'] ?? null,
        data['campaignType'] ?? 'search',
        data['status'] ?? 'active',
        JSON.stringify(item.data),
      ],
    );
  }

  private async processPerformanceData(
    _profileId: string,
    item: CollectPayloadItem,
  ): Promise<void> {
    const data = item.data as Record<string, unknown>;
    const googleCampaignId = data['campaignId'] as string | undefined;

    if (!googleCampaignId) return;

    await this.pool.query(
      `UPDATE campaigns SET
        impressions = COALESCE($1, impressions),
        clicks = COALESCE($2, clicks),
        ctr = COALESCE($3, ctr),
        cpc = COALESCE($4, cpc),
        conversions = COALESCE($5, conversions),
        cost = COALESCE($6, cost),
        raw_payload = $7,
        updated_at = NOW()
       WHERE google_campaign_id = $8`,
      [
        data['impressions'] ?? null,
        data['clicks'] ?? null,
        data['ctr'] ?? null,
        data['cpc'] ?? null,
        data['conversions'] ?? null,
        data['cost'] ?? null,
        JSON.stringify(item.data),
        googleCampaignId,
      ],
    );
  }

  private async processBillingData(_profileId: string, item: CollectPayloadItem): Promise<void> {
    const data = item.data as Record<string, unknown>;
    const googleAccountId = data['accountId'] as string | undefined;

    if (!googleAccountId) return;

    await this.pool.query(
      `UPDATE accounts SET
        total_spend = COALESCE($1, total_spend),
        payment_bin = COALESCE($2, payment_bin),
        payment_bank = COALESCE($3, payment_bank),
        raw_payload = $4,
        updated_at = NOW()
       WHERE google_account_id = $5`,
      [
        data['totalSpend'] ?? null,
        data['paymentBin'] ?? null,
        data['paymentBank'] ?? null,
        JSON.stringify(item.data),
        googleAccountId,
      ],
    );
  }

  private async processAdReviewData(_profileId: string, item: CollectPayloadItem): Promise<void> {
    const data = item.data as Record<string, unknown>;
    const googleCampaignId = data['campaignId'] as string | undefined;

    if (!googleCampaignId) return;

    await this.pool.query(
      `UPDATE campaigns SET
        status = COALESCE($1, status),
        raw_payload = $2,
        updated_at = NOW()
       WHERE google_campaign_id = $3`,
      [data['reviewStatus'] ?? null, JSON.stringify(item.data), googleCampaignId],
    );
  }

  private async processStatusChangeData(
    _profileId: string,
    item: CollectPayloadItem,
    userId?: string,
  ): Promise<void> {
    const data = item.data as Record<string, unknown>;
    const googleAccountId = (data['accountId'] as string | undefined)
      ?? (data['googleCid'] as string | undefined);

    if (!googleAccountId) return;

    const newStatus = data['newStatus'] as string | undefined;
    const previousStatus = data['previousStatus'] as string | undefined;

    console.log(`[Collect] Status change: ${googleAccountId} ${previousStatus ?? '?'} → ${newStatus ?? '?'}`);

    // Update account status
    await this.pool.query(
      `UPDATE accounts SET status = COALESCE($1, status), updated_at = NOW()
       WHERE google_account_id = $2`,
      [newStatus, googleAccountId],
    );

    // Store raw status change in raw_payloads for audit trail
    await this.pool.query(
      `INSERT INTO raw_payloads (profile_id, item_type, raw_payload, user_id)
       VALUES ($1, 'status_change', $2, $3)`,
      [googleAccountId, JSON.stringify(item.data), userId ?? null],
    );

    // Trigger full auto-ban detection pipeline (with post-mortem, scoring, alerts)
    if (newStatus === 'suspended' || newStatus === 'banned') {
      const signalValue = { value: { '1': true } };
      checkAndCreateBan(this.pool, googleAccountId, signalValue).catch((err) => {
        console.error(`[Collect] Auto-ban detection failed for ${googleAccountId}:`, err);
      });
    } else if (newStatus === 'active') {
      // Account was unsuspended — resolve existing auto-bans
      const signalValue = { value: { '1': false } };
      checkAndCreateBan(this.pool, googleAccountId, signalValue).catch((err) => {
        console.error(`[Collect] Ban resolution failed for ${googleAccountId}:`, err);
      });
    }
  }

  /**
   * Apply manual profile config from extension popup to the relevant tables.
   * - proxy_provider → proxies.provider
   * - account_type → accounts.account_type (source = 'manual')
   * - payment_service → payment_methods.service_provider
   */
  private async applyProfileConfig(
    config: ProfileConfig,
    batch: CollectPayloadItem[],
  ): Promise<void> {
    // Collect unique google account IDs from batch
    const accountGoogleIds = new Set<string>();
    for (const item of batch) {
      const cid = (item.data['googleCid'] as string | undefined)
        ?? (item.data['accountId'] as string | undefined);
      if (cid) accountGoogleIds.add(cid);
    }

    for (const googleId of accountGoogleIds) {
      // 1. Set account_type with source = 'manual' (only if manual value provided)
      if (config.account_type) {
        await this.pool.query(
          `UPDATE accounts
           SET account_type = $1,
               account_type_source = 'manual',
               updated_at = NOW()
           WHERE google_account_id = $2
             AND (account_type_source IS NULL OR account_type_source != 'manual' OR account_type != $1)`,
          [config.account_type, googleId],
        );
      }

      // 2. Set proxy provider on linked proxies
      if (config.proxy_provider) {
        await this.pool.query(
          `UPDATE proxies
           SET provider = $1, updated_at = NOW()
           WHERE id IN (
             SELECT ac.proxy_id FROM account_consumables ac
             JOIN accounts a ON a.id = ac.account_id
             WHERE a.google_account_id = $2
               AND ac.proxy_id IS NOT NULL
               AND ac.unlinked_at IS NULL
           ) AND (provider IS NULL OR provider != $1)`,
          [config.proxy_provider, googleId],
        );
      }

      // 3. Set payment service on linked payment methods
      if (config.payment_service) {
        await this.pool.query(
          `UPDATE payment_methods
           SET service_provider = $1, updated_at = NOW()
           WHERE id IN (
             SELECT ac.payment_method_id FROM account_consumables ac
             JOIN accounts a ON a.id = ac.account_id
             WHERE a.google_account_id = $2
               AND ac.payment_method_id IS NOT NULL
               AND ac.unlinked_at IS NULL
           ) AND (service_provider IS NULL OR service_provider != $1)`,
          [config.payment_service, googleId],
        );
      }
    }
  }

  private async updateLastReceived(): Promise<void> {
    // _meta table is created by migration 040
    await this.pool.query(
      `INSERT INTO _meta (key, value) VALUES ('last_data_received', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [new Date().toISOString()],
    );
  }

  async getLastReceived(): Promise<string | null> {
    try {
      const result = await this.pool.query(
        `SELECT value FROM _meta WHERE key = 'last_data_received'`,
      );
      return result.rows.length > 0 ? (result.rows[0]['value'] as string) : null;
    } catch {
      return null;
    }
  }
}
