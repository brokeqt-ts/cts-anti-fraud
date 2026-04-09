import type pg from 'pg';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface ListAccountsParams {
  search?: string;
  status?: string;
  currency?: string;
  tagId?: string;
  limit: number;
  offset: number;
  userId?: string;
}

export interface ListAccountsResult {
  total: number;
  accounts: Record<string, unknown>[];
}

export interface AccountDetailResult {
  account: Record<string, unknown>;
  signals: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  notificationDetails: Record<string, unknown>[];
  bans: Record<string, unknown>[];
  payloadStats: Record<string, unknown> | undefined;
  campaigns: Record<string, unknown>[];
  billing: Record<string, unknown> | null;
  metrics: Record<string, unknown>[];
  ads: Record<string, unknown>[];
  adGroups: Record<string, unknown>[];
  keywords: Record<string, unknown>[];
  keywordDailyStats: Record<string, unknown>[];
  campaignMetrics: Record<string, unknown>[];
  antidetectProfile: Record<string, unknown> | undefined;
  accountEvents: Record<string, unknown>[];
}

export interface PatchAccountParams {
  accountType?: string | null;
  offerVertical?: string | null;
}

// ─── Repository Functions ───────────────────────────────────────────────────

export async function listAccounts(pool: pg.Pool, params: ListAccountsParams): Promise<ListAccountsResult> {
  const conditions: string[] = [`a.google_account_id ~ '^\\d{7,13}$'`];
  const queryParams: unknown[] = [];
  let paramIdx = 1;

  if (params.userId) {
    conditions.push(`a.user_id = $${paramIdx++}`);
    queryParams.push(params.userId);
  }
  if (params.search) {
    conditions.push(`(a.google_account_id ILIKE $${paramIdx} OR a.display_name ILIKE $${paramIdx} OR ap.profile_name ILIKE $${paramIdx})`);
    queryParams.push(`%${params.search}%`);
    paramIdx++;
  }
  if (params.status) {
    conditions.push(`a.status = $${paramIdx++}`);
    queryParams.push(params.status);
  }
  if (params.currency) {
    conditions.push(`a.currency = $${paramIdx++}`);
    queryParams.push(params.currency);
  }
  if (params.tagId) {
    conditions.push(`EXISTS (SELECT 1 FROM account_tags atg WHERE atg.account_id = a.id AND atg.tag_id = $${paramIdx++})`);
    queryParams.push(params.tagId);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  // Main query: replaced scalar subqueries with LEFT JOIN aggregations for performance
  const result = await pool.query(
    `SELECT
       a.id,
       a.google_account_id,
       a.display_name,
       a.status AS account_status,
       a.payer_name,
       a.currency,
       a.updated_at,
       COALESCE(ban_agg.ban_count, 0)::int AS ban_count,
       sig.signal_value AS suspended_signal,
       rp_agg.last_seen,
       rp_agg.first_seen,
       dom.domain,
       ap.profile_name,
       ap.browser_type::text AS browser_type,
       pm.card_info,
       COALESCE(nd_agg.notifications_count, 0)::int AS notifications_count,
       a.account_type,
       a.account_type_source
     FROM accounts a
     -- Ban count aggregate
     LEFT JOIN (
       SELECT account_google_id, COUNT(*)::int AS ban_count
       FROM ban_logs GROUP BY account_google_id
     ) ban_agg ON ban_agg.account_google_id = a.google_account_id
     -- Latest suspended signal
     LEFT JOIN LATERAL (
       SELECT s.signal_value FROM account_signals s
       WHERE s.account_google_id = a.google_account_id AND s.signal_name = 'account_suspended'
       ORDER BY s.captured_at DESC LIMIT 1
     ) sig ON true
     -- First/last seen from raw_payloads
     LEFT JOIN (
       SELECT profile_id, MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
       FROM raw_payloads GROUP BY profile_id
     ) rp_agg ON rp_agg.profile_id = a.google_account_id
     -- Latest domain from ads
     LEFT JOIN LATERAL (
       SELECT COALESCE(ads.display_url, (ads.final_urls->>0)::text) AS domain
       FROM ads WHERE ads.account_google_id = a.google_account_id
       ORDER BY ads.captured_at DESC LIMIT 1
     ) dom ON true
     -- Latest antidetect profile
     LEFT JOIN LATERAL (
       SELECT ap2.profile_name, ap2.browser_type
       FROM account_consumables ac2
       JOIN antidetect_profiles ap2 ON ap2.id = ac2.antidetect_profile_id
       WHERE ac2.account_id = a.id AND ac2.unlinked_at IS NULL
       ORDER BY ac2.linked_at DESC LIMIT 1
     ) ap ON true
     -- Latest payment method
     LEFT JOIN LATERAL (
       SELECT CASE
         WHEN pm2.card_network IS NOT NULL AND pm2.last4 IS NOT NULL
           THEN pm2.card_network || ' ••' || pm2.last4
         WHEN pm2.bin IS NOT NULL THEN 'BIN ' || pm2.bin
         ELSE NULL
       END AS card_info
       FROM account_consumables ac3
       JOIN payment_methods pm2 ON pm2.id = ac3.payment_method_id
       WHERE ac3.account_id = a.id AND ac3.unlinked_at IS NULL
       ORDER BY ac3.linked_at DESC LIMIT 1
     ) pm ON true
     -- Notification count aggregate
     LEFT JOIN (
       SELECT account_google_id, COUNT(*)::int AS notifications_count
       FROM notification_details GROUP BY account_google_id
     ) nd_agg ON nd_agg.account_google_id = a.google_account_id
     ${where}
     ORDER BY a.updated_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...queryParams, params.limit, params.offset],
  );

  // Count query: simplified — no LATERAL JOINs needed, only joins required for WHERE filters
  const needsProfileJoin = params.search != null;
  const countSql = needsProfileJoin
    ? `SELECT COUNT(*) as total FROM accounts a
       LEFT JOIN LATERAL (
         SELECT ap2.profile_name FROM account_consumables ac2
         JOIN antidetect_profiles ap2 ON ap2.id = ac2.antidetect_profile_id
         WHERE ac2.account_id = a.id AND ac2.unlinked_at IS NULL LIMIT 1
       ) ap ON true ${where}`
    : `SELECT COUNT(*) as total FROM accounts a ${where}`;
  const countResult = await pool.query(countSql, queryParams);

  // Fetch tags for all returned accounts in a single query
  const accountIds = result.rows.map((r: Record<string, unknown>) => r['id'] as string);
  if (accountIds.length > 0) {
    const tagsResult = await pool.query(
      `SELECT atg.account_id, t.id AS tag_id, t.name, t.color
       FROM account_tags atg
       JOIN tags t ON t.id = atg.tag_id
       WHERE atg.account_id = ANY($1)
       ORDER BY t.name`,
      [accountIds],
    );
    const tagsByAccount = new Map<string, Array<{ id: string; name: string; color: string }>>();
    for (const row of tagsResult.rows as Array<{ account_id: string; tag_id: string; name: string; color: string }>) {
      const arr = tagsByAccount.get(row.account_id) ?? [];
      arr.push({ id: row.tag_id, name: row.name, color: row.color });
      tagsByAccount.set(row.account_id, arr);
    }
    for (const acc of result.rows as Array<Record<string, unknown>>) {
      acc['tags'] = tagsByAccount.get(acc['id'] as string) ?? [];
    }
  } else {
    for (const acc of result.rows as Array<Record<string, unknown>>) {
      acc['tags'] = [];
    }
  }

  return {
    total: parseInt(countResult.rows[0]?.['total'] as string, 10),
    accounts: result.rows,
  };
}

export async function getAccountDetail(pool: pg.Pool, googleId: string, userId?: string): Promise<AccountDetailResult | null> {
  const accountConditions = ['a.google_account_id = $1'];
  const accountParams: unknown[] = [googleId];
  if (userId) {
    accountConditions.push(`a.user_id = $2`);
    accountParams.push(userId);
  }

  const [account, signals, notifications, bans, payloadStats, campaigns, billing, notificationDetails, metrics, ads, adGroups, keywords, keywordDailyStats, campaignMetrics, antidetectProfile, accountEvents] = await Promise.all([
    pool.query(
      `SELECT a.*,
              a.status AS account_status,
              (SELECT p.provider FROM account_consumables ac
               JOIN proxies p ON p.id = ac.proxy_id
               WHERE ac.account_id = a.id AND ac.unlinked_at IS NULL AND p.provider IS NOT NULL
               ORDER BY ac.linked_at DESC LIMIT 1) AS proxy_provider,
              (SELECT pm.service_provider FROM account_consumables ac
               JOIN payment_methods pm ON pm.id = ac.payment_method_id
               WHERE ac.account_id = a.id AND ac.unlinked_at IS NULL AND pm.service_provider IS NOT NULL
               ORDER BY ac.linked_at DESC LIMIT 1) AS payment_service
       FROM accounts a
       WHERE ${accountConditions.join(' AND ')}`,
      accountParams,
    ),
    pool.query(
      `SELECT id, signal_name, signal_value, captured_at
       FROM account_signals
       WHERE account_google_id = $1
       ORDER BY captured_at DESC
       LIMIT 100`,
      [googleId],
    ),
    pool.query(
      `SELECT id, notifications, captured_at
       FROM account_notifications
       WHERE account_google_id = $1
       ORDER BY captured_at DESC
       LIMIT 20`,
      [googleId],
    ),
    pool.query(
      `SELECT id, banned_at, ban_target, ban_reason, ban_reason_internal,
              offer_vertical, domain, campaign_type, lifetime_hours,
              COALESCE(source, 'manual') as source, resolved_at,
              post_mortem, post_mortem_generated_at
       FROM ban_logs
       WHERE account_google_id = $1
       ORDER BY banned_at DESC`,
      [googleId],
    ),
    pool.query(
      `SELECT COUNT(*) as total_payloads,
              MIN(created_at) as first_seen,
              MAX(created_at) as last_seen
       FROM raw_payloads
       WHERE profile_id = $1`,
      [googleId],
    ),
    pool.query(
      `SELECT id, campaign_id, campaign_name, campaign_type, status,
              budget_micros, currency, target_languages, target_countries,
              start_date, end_date, bidding_strategy_type, bidding_strategy_config,
              captured_at
       FROM campaigns
       WHERE account_google_id = $1
       ORDER BY captured_at DESC`,
      [googleId],
    ),
    pool.query(
      `SELECT id, payment_method, payment_method_icon_url, balance_formatted,
              threshold_micros, billing_cycle_end, captured_at
       FROM billing_info
       WHERE account_google_id = $1
       ORDER BY captured_at DESC
       LIMIT 1`,
      [googleId],
    ),
    pool.query(
      `SELECT id, notification_id, title, description, category,
              notification_type, label, priority, captured_at
       FROM notification_details
       WHERE account_google_id = $1
       ORDER BY captured_at DESC
       LIMIT 50`,
      [googleId],
    ),
    pool.query(
      `SELECT id, metric_type, date_range, data_points, total_value, captured_at
       FROM account_metrics
       WHERE account_google_id = $1
       ORDER BY captured_at DESC`,
      [googleId],
    ),
    pool.query(
      `SELECT id, ad_id, campaign_id, ad_group_id, headlines, descriptions,
              final_urls, display_url, ad_type, review_status, captured_at
       FROM ads
       WHERE account_google_id = $1
       ORDER BY captured_at DESC`,
      [googleId],
    ),
    pool.query(
      `SELECT id, ad_group_id, ad_group_name, campaign_id, status, captured_at
       FROM ad_groups
       WHERE account_google_id = $1
       ORDER BY captured_at DESC`,
      [googleId],
    ),
    pool.query(
      `SELECT id, keyword_id, campaign_id, ad_group_id, keyword_text,
              match_type, is_negative, status, quality_score,
              qs_expected_ctr, qs_ad_relevance, qs_landing_page,
              impressions, clicks, cost_micros, ctr, avg_cpc_micros,
              conversions, conversion_rate, cost_per_conversion_micros,
              currency, max_cpc_micros, captured_at
       FROM keywords
       WHERE account_google_id = $1
       ORDER BY clicks DESC NULLS LAST, impressions DESC NULLS LAST`,
      [googleId],
    ),
    pool.query(
      `SELECT date, metric_name, SUM(metric_value) AS metric_value
       FROM keyword_daily_stats
       WHERE account_google_id = $1
         AND metric_name IN ('stats.clicks', 'stats.impressions', 'stats.cost')
       GROUP BY date, metric_name
       ORDER BY date`,
      [googleId],
    ),
    pool.query(
      `SELECT campaign_id,
              SUM(impressions) AS impressions,
              SUM(clicks) AS clicks,
              CASE WHEN SUM(impressions) > 0
                THEN ROUND(SUM(clicks)::numeric / SUM(impressions) * 100, 2)
                ELSE 0 END AS ctr,
              SUM(cost_micros) AS cost_micros,
              CASE WHEN SUM(clicks) > 0
                THEN ROUND(SUM(cost_micros)::numeric / SUM(clicks))
                ELSE 0 END AS avg_cpc_micros
       FROM keywords
       WHERE account_google_id = $1
       GROUP BY campaign_id`,
      [googleId],
    ),
    pool.query(
      `SELECT ap.profile_name, ap.browser_type::text AS browser_type
       FROM account_consumables ac
       JOIN antidetect_profiles ap ON ap.id = ac.antidetect_profile_id
       JOIN accounts a ON a.id = ac.account_id
       WHERE a.google_account_id = $1 AND ac.unlinked_at IS NULL
       ORDER BY ac.linked_at DESC
       LIMIT 1`,
      [googleId],
    ),
    pool.query(
      `SELECT id, event_type, field_name, old_value, new_value, detail, created_at
       FROM account_events
       WHERE account_google_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [googleId],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] })),
  ]);

  if (account.rowCount === 0) return null;

  return {
    account: account.rows[0]!,
    signals: signals.rows,
    notifications: notifications.rows,
    notificationDetails: notificationDetails.rows,
    bans: bans.rows,
    payloadStats: payloadStats.rows[0],
    campaigns: campaigns.rows,
    billing: billing.rows[0] ?? null,
    metrics: metrics.rows,
    ads: ads.rows,
    adGroups: adGroups.rows,
    keywords: keywords.rows,
    keywordDailyStats: keywordDailyStats.rows,
    campaignMetrics: campaignMetrics.rows,
    antidetectProfile: antidetectProfile.rows[0],
    accountEvents: accountEvents.rows,
  };
}

export async function patchAccount(
  pool: pg.Pool,
  googleId: string,
  params: PatchAccountParams,
  userId?: string,
): Promise<Record<string, unknown> | null> {
  const sets: string[] = [];
  const queryParams: unknown[] = [];
  let idx = 1;

  if (params.accountType !== undefined) {
    sets.push(`account_type = $${idx++}`);
    queryParams.push(params.accountType);
    sets.push(`account_type_source = $${idx++}`);
    queryParams.push('manual');
  }
  if (params.offerVertical !== undefined) {
    sets.push(`offer_vertical = $${idx++}`);
    queryParams.push(params.offerVertical);
    sets.push(`offer_vertical_source = $${idx++}`);
    queryParams.push('manual');
  }

  if (sets.length === 0) return null;

  const conditions = [`google_account_id = $${idx++}`];
  queryParams.push(googleId);

  if (userId) {
    conditions.push(`user_id = $${idx++}`);
    queryParams.push(userId);
  }

  const result = await pool.query(
    `UPDATE accounts SET ${sets.join(', ')}, updated_at = NOW() WHERE ${conditions.join(' AND ')} RETURNING *`,
    queryParams,
  );

  return result.rowCount === 0 ? null : result.rows[0]!;
}

export async function getAccountIdByGoogleId(pool: pg.Pool, googleId: string, userId?: string): Promise<string | null> {
  const conditions = ['google_account_id = $1'];
  const params: unknown[] = [googleId];
  if (userId) {
    conditions.push('user_id = $2');
    params.push(userId);
  }
  const result = await pool.query(
    `SELECT id FROM accounts WHERE ${conditions.join(' AND ')}`,
    params,
  );
  return result.rowCount === 0 ? null : (result.rows[0]!['id'] as string);
}

export async function insertProxy(
  pool: pg.Pool,
  proxyType: string,
  provider: string | null,
  geo: string | null,
  ipAddress: string | null,
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO proxies (proxy_type, provider, geo, ip_address) VALUES ($1, $2, $3, $4) RETURNING id`,
    [proxyType, provider, geo, ipAddress],
  );
  return result.rows[0]!['id'] as string;
}

export async function insertAntidetectProfile(
  pool: pg.Pool,
  browserType: string,
  profileExternalId: string | null,
  fingerprintHash: string | null,
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO antidetect_profiles (browser_type, profile_external_id, fingerprint_hash) VALUES ($1, $2, $3) RETURNING id`,
    [browserType, profileExternalId, fingerprintHash],
  );
  return result.rows[0]!['id'] as string;
}

export async function insertPaymentMethod(
  pool: pg.Pool,
  bin: string | null,
  cardType: string | null,
  providerBank: string | null,
  country: string | null,
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO payment_methods (bin, card_type, provider_bank, country) VALUES ($1, $2, $3, $4) RETURNING id`,
    [bin, cardType, providerBank, country],
  );
  return result.rows[0]!['id'] as string;
}

export async function linkConsumable(
  pool: pg.Pool,
  accountId: string,
  consumableColumn: 'proxy_id' | 'antidetect_profile_id' | 'payment_method_id',
  consumableId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO account_consumables (account_id, ${consumableColumn}) VALUES ($1, $2)`,
    [accountId, consumableId],
  );
}

export async function unlinkConsumable(pool: pg.Pool, id: string, accountId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE account_consumables SET unlinked_at = NOW()
     WHERE id = $1 AND account_id = $2 AND unlinked_at IS NULL
     RETURNING id`,
    [id, accountId],
  );
  return (result.rowCount ?? 0) > 0;
}
