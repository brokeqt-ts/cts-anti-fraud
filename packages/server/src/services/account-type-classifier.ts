import type pg from 'pg';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export type AccountType = 'farm' | 'purchased' | 'agency' | 'unknown';

export interface ClassificationSignal {
  signal: string;
  value: string;
  points_to: AccountType;
  weight: number;
}

export interface ClassificationResult {
  account_type: AccountType;
  confidence: number;
  signals: ClassificationSignal[];
}

// ─── Signal Detectors ───────────────────────────────────────────────────────

async function detectYoungNoHistory(pool: pg.Pool, googleId: string): Promise<ClassificationSignal | null> {
  const result = await pool.query(`
    SELECT
      EXTRACT(DAY FROM NOW() - MIN(rp.created_at)) AS age_days,
      (SELECT COUNT(*) FROM billing_info bi WHERE bi.account_google_id = $1) AS billing_count
    FROM raw_payloads rp
    WHERE rp.profile_id = $1
  `, [googleId]);

  const row = result.rows[0];
  if (!row) return null;

  const ageDays = parseFloat(row['age_days'] as string) || 0;
  const billingCount = parseInt(row['billing_count'] as string, 10) || 0;

  if (ageDays < 7 && billingCount === 0) {
    return { signal: 'young_no_billing', value: `age=${Math.round(ageDays)}d, billing=0`, points_to: 'farm', weight: 0.25 };
  }
  return null;
}

async function detectMultipleAccountsOnProfile(pool: pg.Pool, googleId: string): Promise<ClassificationSignal | null> {
  const result = await pool.query(`
    SELECT COUNT(DISTINCT ac2.account_id) AS account_count
    FROM accounts a
    JOIN account_consumables ac ON ac.account_id = a.id AND ac.unlinked_at IS NULL
    JOIN antidetect_profiles ap ON ap.id = ac.antidetect_profile_id
    JOIN account_consumables ac2 ON ac2.antidetect_profile_id = ap.id AND ac2.unlinked_at IS NULL
    WHERE a.google_account_id = $1
  `, [googleId]);

  const count = parseInt(result.rows[0]?.['account_count'] as string, 10) || 0;
  if (count >= 3) {
    return { signal: 'multi_account_profile', value: `${count} accounts on same profile`, points_to: 'farm', weight: 0.3 };
  }
  return null;
}

async function detectMccParent(pool: pg.Pool, googleId: string): Promise<ClassificationSignal | null> {
  // Check if account has manager (MCC) hierarchy signals in raw_payload
  const result = await pool.query(`
    SELECT raw_payload
    FROM accounts
    WHERE google_account_id = $1 AND raw_payload IS NOT NULL
  `, [googleId]);

  const raw = result.rows[0]?.['raw_payload'] as Record<string, unknown> | null;
  if (!raw) return null;

  const rawStr = JSON.stringify(raw).toLowerCase();
  if (rawStr.includes('manager') || rawStr.includes('mcc') || rawStr.includes('manageraccount')) {
    return { signal: 'mcc_parent_detected', value: 'Manager account reference found', points_to: 'agency', weight: 0.35 };
  }
  return null;
}

async function detectPurchasedSignals(pool: pg.Pool, googleId: string): Promise<ClassificationSignal | null> {
  // Verification not started + account is old => likely purchased
  const result = await pool.query(`
    SELECT
      EXTRACT(DAY FROM NOW() - MIN(rp.created_at)) AS age_days,
      (SELECT signal_value FROM account_signals
       WHERE account_google_id = $1 AND signal_name = 'verification_status'
       ORDER BY captured_at DESC LIMIT 1) AS verification
    FROM raw_payloads rp
    WHERE rp.profile_id = $1
  `, [googleId]);

  const row = result.rows[0];
  if (!row) return null;

  const ageDays = parseFloat(row['age_days'] as string) || 0;
  const verification = row['verification'] as Record<string, unknown> | null;
  const verStr = JSON.stringify(verification ?? '').toLowerCase();

  if (ageDays > 30 && (verStr.includes('not_started') || verStr.includes('not started'))) {
    return { signal: 'unverified_old_account', value: `age=${Math.round(ageDays)}d, verification=not_started`, points_to: 'purchased', weight: 0.3 };
  }
  return null;
}

async function detectCurrencyMismatch(pool: pg.Pool, googleId: string): Promise<ClassificationSignal | null> {
  const result = await pool.query(`
    SELECT a.currency,
           (SELECT pm.country FROM account_consumables ac
            JOIN payment_methods pm ON pm.id = ac.payment_method_id
            WHERE ac.account_id = a.id AND ac.unlinked_at IS NULL AND pm.country IS NOT NULL
            ORDER BY ac.linked_at DESC LIMIT 1) AS card_country
    FROM accounts a
    WHERE a.google_account_id = $1
  `, [googleId]);

  const row = result.rows[0];
  if (!row || !row['currency'] || !row['card_country']) return null;

  const currency = (row['currency'] as string).toUpperCase();
  const cardCountry = (row['card_country'] as string).toUpperCase();

  // Simple currency-country mapping for common cases
  const currencyCountry: Record<string, string[]> = {
    'USD': ['US'], 'EUR': ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'IE', 'FI', 'PT', 'GR'],
    'GBP': ['GB'], 'RUB': ['RU'], 'UAH': ['UA'], 'PLN': ['PL'], 'BRL': ['BR'],
    'TRY': ['TR'], 'INR': ['IN'], 'CAD': ['CA'], 'AUD': ['AU'],
  };

  const expected = currencyCountry[currency];
  if (expected && !expected.includes(cardCountry)) {
    return { signal: 'currency_country_mismatch', value: `currency=${currency}, card_country=${cardCountry}`, points_to: 'purchased', weight: 0.2 };
  }
  return null;
}

async function detectRapidCampaignCreation(pool: pg.Pool, googleId: string): Promise<ClassificationSignal | null> {
  const result = await pool.query(`
    SELECT COUNT(*) AS campaign_count
    FROM campaigns
    WHERE account_google_id = $1
      AND captured_at < (
        SELECT MIN(rp.created_at) + INTERVAL '24 hours'
        FROM raw_payloads rp WHERE rp.profile_id = $1
      )
  `, [googleId]);

  const count = parseInt(result.rows[0]?.['campaign_count'] as string, 10) || 0;
  if (count >= 5) {
    return { signal: 'rapid_campaign_creation', value: `${count} campaigns in first 24h`, points_to: 'farm', weight: 0.25 };
  }
  return null;
}

function detectGenericAccountName(displayName: string | null): ClassificationSignal | null {
  if (!displayName) return null;

  const genericPatterns = [
    /^acc(ount)?\s*\d+$/i,
    /^profile\s*\d+$/i,
    /^test\s*\d*$/i,
    /^user\s*\d+$/i,
    /^\d{5,}$/,
    /^[a-f0-9]{8,}$/i,
  ];

  for (const pattern of genericPatterns) {
    if (pattern.test(displayName.trim())) {
      return { signal: 'generic_account_name', value: displayName, points_to: 'farm', weight: 0.15 };
    }
  }
  return null;
}

// ─── Main Classifier ────────────────────────────────────────────────────────

export async function classifyAccountType(
  pool: pg.Pool,
  googleId: string,
): Promise<ClassificationResult> {
  // Get account display name for name-based detection
  const acctResult = await pool.query(
    `SELECT display_name FROM accounts WHERE google_account_id = $1`,
    [googleId],
  );
  const displayName = acctResult.rows[0]?.['display_name'] as string | null;

  // Collect signals in parallel
  const signalResults = await Promise.all([
    detectYoungNoHistory(pool, googleId),
    detectMultipleAccountsOnProfile(pool, googleId),
    detectMccParent(pool, googleId),
    detectPurchasedSignals(pool, googleId),
    detectCurrencyMismatch(pool, googleId),
    detectRapidCampaignCreation(pool, googleId),
  ]);

  // Add sync signals
  const nameSignal = detectGenericAccountName(displayName);

  const signals: ClassificationSignal[] = [
    ...signalResults.filter((s): s is ClassificationSignal => s !== null),
    ...(nameSignal ? [nameSignal] : []),
  ];

  if (signals.length === 0) {
    return { account_type: 'unknown', confidence: 0, signals: [] };
  }

  // Weighted voting
  const votes: Record<AccountType, number> = { farm: 0, purchased: 0, agency: 0, unknown: 0 };
  let totalWeight = 0;

  for (const signal of signals) {
    votes[signal.points_to] += signal.weight;
    totalWeight += signal.weight;
  }

  // Find winner
  let bestType: AccountType = 'unknown';
  let bestScore = 0;
  for (const [type, score] of Object.entries(votes)) {
    if (score > bestScore) {
      bestScore = score;
      bestType = type as AccountType;
    }
  }

  const confidence = totalWeight > 0 ? Math.min(bestScore / totalWeight, 1) : 0;

  return {
    account_type: bestType,
    confidence: Math.round(confidence * 100) / 100,
    signals,
  };
}

// ─── Integration: Classify + Update ─────────────────────────────────────────

/**
 * Classify account type and update if confident enough.
 * Never overwrites manually-set types.
 */
export async function classifyAndUpdateAccountType(
  pool: pg.Pool,
  googleId: string,
): Promise<ClassificationResult | null> {
  // Check if manually set
  const existing = await pool.query(
    `SELECT account_type, account_type_source FROM accounts WHERE google_account_id = $1`,
    [googleId],
  );
  const row = existing.rows[0];
  if (!row) return null;

  // Never overwrite manual entries
  if (row['account_type_source'] === 'manual') return null;

  const result = await classifyAccountType(pool, googleId);

  // Only update if confidence > 0.6
  if (result.confidence > 0.6 && result.account_type !== 'unknown') {
    await pool.query(
      `UPDATE accounts
       SET account_type = $1, account_type_source = 'auto', account_type_signals = $2, updated_at = NOW()
       WHERE google_account_id = $3 AND (account_type_source IS NULL OR account_type_source = 'auto')`,
      [result.account_type, JSON.stringify(result.signals), googleId],
    );
  }

  return result;
}
