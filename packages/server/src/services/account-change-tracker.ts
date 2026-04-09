import type pg from 'pg';

interface TrackedField {
  column: string;
  label: string;
  eventType: string;
  format?: (v: unknown) => string;
}

const TRACKED_ACCOUNT_FIELDS: TrackedField[] = [
  { column: 'status', label: 'Статус', eventType: 'status_change' },
  { column: 'display_name', label: 'Имя аккаунта', eventType: 'name_change' },
  { column: 'payment_bin', label: 'BIN карты', eventType: 'bin_change' },
  { column: 'payment_card_country', label: 'Страна карты', eventType: 'card_country_change' },
  { column: 'payment_bank', label: 'Банк', eventType: 'bank_change' },
  { column: 'account_type', label: 'Тип аккаунта', eventType: 'type_change' },
  { column: 'offer_vertical', label: 'Вертикаль', eventType: 'vertical_change' },
  {
    column: 'total_spend',
    label: 'Расход',
    eventType: 'spend_milestone',
    format: (v) => `$${Number(v).toFixed(2)}`,
  },
];

/**
 * Compare current account state with incoming data and log changes.
 * Called before the account is updated in the database.
 */
export async function trackAccountChanges(
  pool: pg.Pool,
  googleAccountId: string,
  incomingFields: Record<string, unknown>,
): Promise<void> {
  // Fetch current state
  const result = await pool.query(
    `SELECT status, display_name, payment_bin, payment_card_country,
            payment_bank, account_type, offer_vertical, total_spend
     FROM accounts WHERE google_account_id = $1`,
    [googleAccountId],
  );

  if (result.rowCount === 0) return;
  const current = result.rows[0] as Record<string, unknown>;

  const events: Array<{ eventType: string; fieldName: string; oldValue: string | null; newValue: string | null; detail: string }> = [];

  for (const field of TRACKED_ACCOUNT_FIELDS) {
    const newVal = incomingFields[field.column];
    if (newVal === undefined || newVal === null) continue;

    const oldVal = current[field.column];
    if (oldVal === null && newVal === null) continue;
    if (oldVal === newVal) continue;
    if (String(oldVal) === String(newVal)) continue;

    // Special: spend milestones — only log at $100 increments
    if (field.column === 'total_spend') {
      const oldSpend = Number(oldVal ?? 0);
      const newSpend = Number(newVal);
      const oldMilestone = Math.floor(oldSpend / 100);
      const newMilestone = Math.floor(newSpend / 100);
      if (newMilestone > oldMilestone && newSpend > 0) {
        events.push({
          eventType: field.eventType,
          fieldName: field.label,
          oldValue: field.format ? field.format(oldVal) : String(oldVal ?? ''),
          newValue: field.format ? field.format(newVal) : String(newVal),
          detail: `Расход достиг $${newMilestone * 100}`,
        });
      }
      continue;
    }

    const fmt = field.format ?? String;
    events.push({
      eventType: field.eventType,
      fieldName: field.label,
      oldValue: oldVal != null ? fmt(oldVal) : null,
      newValue: fmt(newVal),
      detail: `${field.label}: ${oldVal != null ? fmt(oldVal) : '—'} → ${fmt(newVal)}`,
    });
  }

  // Batch insert
  for (const ev of events) {
    await pool.query(
      `INSERT INTO account_events (account_google_id, event_type, field_name, old_value, new_value, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [googleAccountId, ev.eventType, ev.fieldName, ev.oldValue, ev.newValue, ev.detail],
    );
  }
}

/**
 * Track keyword-level changes: status, quality score.
 */
export async function trackKeywordChanges(
  pool: pg.Pool,
  accountGoogleId: string,
  keywordId: string,
  keywordText: string | null,
  incomingFields: Record<string, unknown>,
): Promise<void> {
  const result = await pool.query(
    `SELECT status, quality_score
     FROM keywords WHERE account_google_id = $1 AND keyword_id = $2`,
    [accountGoogleId, keywordId],
  );

  if (result.rowCount === 0) return;
  const current = result.rows[0] as Record<string, unknown>;
  const label = keywordText ?? keywordId;

  // Status change
  if (incomingFields['status'] != null && current['status'] != null && String(incomingFields['status']) !== String(current['status'])) {
    const STATUS_LABELS: Record<string, string> = { '2': 'paused', '3': 'enabled', '4': 'removed' };
    const oldLabel = STATUS_LABELS[String(current['status'])] ?? String(current['status']);
    const newLabel = STATUS_LABELS[String(incomingFields['status'])] ?? String(incomingFields['status']);
    await pool.query(
      `INSERT INTO account_events (account_google_id, event_type, field_name, old_value, new_value, detail)
       VALUES ($1, 'keyword_status', $2, $3, $4, $5)`,
      [accountGoogleId, 'Статус ключевого слова', oldLabel, newLabel, `Ключ "${label}": ${oldLabel} → ${newLabel}`],
    );
  }

  // Quality Score change
  if (incomingFields['quality_score'] != null && current['quality_score'] != null) {
    const oldQs = Number(current['quality_score']);
    const newQs = Number(incomingFields['quality_score']);
    if (oldQs > 0 && newQs > 0 && oldQs !== newQs) {
      await pool.query(
        `INSERT INTO account_events (account_google_id, event_type, field_name, old_value, new_value, detail)
         VALUES ($1, 'qs_change', $2, $3, $4, $5)`,
        [accountGoogleId, 'Quality Score', String(oldQs), String(newQs), `Ключ "${label}": QS ${oldQs} → ${newQs}`],
      );
    }
  }
}

/**
 * Track ad-level changes: review_status.
 */
export async function trackAdChanges(
  pool: pg.Pool,
  accountGoogleId: string,
  adId: string,
  incomingReviewStatus: string | null,
): Promise<void> {
  if (!incomingReviewStatus) return;

  const result = await pool.query(
    `SELECT review_status FROM ads WHERE account_google_id = $1 AND ad_id = $2
     ORDER BY captured_at DESC LIMIT 1`,
    [accountGoogleId, adId],
  );

  if (result.rowCount === 0) return;
  const oldStatus = result.rows[0]!['review_status'] as string | null;
  if (!oldStatus || oldStatus === incomingReviewStatus) return;

  const REVIEW_LABELS: Record<string, string> = {
    '0': 'unknown', '2': 'approved', '3': 'disapproved',
    '4': 'under_review', '5': 'approved_limited', '6': 'eligible',
  };
  const oldLabel = REVIEW_LABELS[oldStatus] ?? oldStatus;
  const newLabel = REVIEW_LABELS[incomingReviewStatus] ?? incomingReviewStatus;

  await pool.query(
    `INSERT INTO account_events (account_google_id, event_type, field_name, old_value, new_value, detail)
     VALUES ($1, 'ad_review', $2, $3, $4, $5)`,
    [accountGoogleId, 'Статус объявления', oldLabel, newLabel, `Объявление ${adId}: ${oldLabel} → ${newLabel}`],
  );
}

/**
 * Track verification status changes.
 */
export async function trackVerificationChange(
  pool: pg.Pool,
  accountGoogleId: string,
  newStatus: string,
): Promise<void> {
  const result = await pool.query(
    `SELECT verification_status FROM accounts WHERE google_account_id = $1`,
    [accountGoogleId],
  );

  if (result.rowCount === 0) return;
  const oldStatus = result.rows[0]!['verification_status'] as string | null;
  if (!oldStatus || oldStatus === newStatus) return;

  await pool.query(
    `INSERT INTO account_events (account_google_id, event_type, field_name, old_value, new_value, detail)
     VALUES ($1, 'verification_change', $2, $3, $4, $5)`,
    [accountGoogleId, 'Верификация', oldStatus, newStatus, `Верификация: ${oldStatus} → ${newStatus}`],
  );
}

/**
 * Track campaign-level changes: budget, status, domain, bidding strategy.
 */
export async function trackCampaignChanges(
  pool: pg.Pool,
  accountGoogleId: string,
  campaignId: string,
  campaignName: string | null,
  incomingFields: Record<string, unknown>,
): Promise<void> {
  const result = await pool.query(
    `SELECT status, budget_micros, domain_name, bidding_strategy_type
     FROM campaigns WHERE account_google_id = $1 AND campaign_id = $2
     ORDER BY captured_at DESC LIMIT 1`,
    [accountGoogleId, campaignId],
  );

  if (result.rowCount === 0) return;
  const current = result.rows[0] as Record<string, unknown>;

  const label = campaignName ?? campaignId;

  // Status change
  if (incomingFields['status'] && current['status'] && String(incomingFields['status']) !== String(current['status'])) {
    await pool.query(
      `INSERT INTO account_events (account_google_id, event_type, field_name, old_value, new_value, detail)
       VALUES ($1, 'campaign_status', $2, $3, $4, $5)`,
      [
        accountGoogleId,
        'Статус кампании',
        String(current['status']),
        String(incomingFields['status']),
        `Кампания "${label}": ${current['status']} → ${incomingFields['status']}`,
      ],
    );
  }

  // Budget change
  if (incomingFields['budget_micros'] && current['budget_micros']) {
    const oldBudget = Number(current['budget_micros']);
    const newBudget = Number(incomingFields['budget_micros']);
    if (oldBudget > 0 && newBudget > 0 && oldBudget !== newBudget) {
      const oldFmt = `$${(oldBudget / 1_000_000).toFixed(2)}`;
      const newFmt = `$${(newBudget / 1_000_000).toFixed(2)}`;
      await pool.query(
        `INSERT INTO account_events (account_google_id, event_type, field_name, old_value, new_value, detail)
         VALUES ($1, 'budget_change', $2, $3, $4, $5)`,
        [
          accountGoogleId,
          'Бюджет кампании',
          oldFmt,
          newFmt,
          `Кампания "${label}": бюджет ${oldFmt} → ${newFmt}`,
        ],
      );
    }
  }

  // Domain change
  if (incomingFields['domain_name'] && current['domain_name'] && String(incomingFields['domain_name']) !== String(current['domain_name'])) {
    await pool.query(
      `INSERT INTO account_events (account_google_id, event_type, field_name, old_value, new_value, detail)
       VALUES ($1, 'domain_change', $2, $3, $4, $5)`,
      [
        accountGoogleId,
        'Домен кампании',
        String(current['domain_name']),
        String(incomingFields['domain_name']),
        `Кампания "${label}": домен ${current['domain_name']} → ${incomingFields['domain_name']}`,
      ],
    );
  }

  // Bidding strategy change
  if (incomingFields['bidding_strategy_type'] != null && current['bidding_strategy_type'] != null) {
    if (String(incomingFields['bidding_strategy_type']) !== String(current['bidding_strategy_type'])) {
      const BIDDING_LABELS: Record<string, string> = {
        '2': 'Manual CPC', '10': 'Max Conversions', '12': 'Target CPA',
        '13': 'Target ROAS', '14': 'Max Clicks', '15': 'Max Conv Value',
      };
      const oldLabel = BIDDING_LABELS[String(current['bidding_strategy_type'])] ?? String(current['bidding_strategy_type']);
      const newLabel = BIDDING_LABELS[String(incomingFields['bidding_strategy_type'])] ?? String(incomingFields['bidding_strategy_type']);
      await pool.query(
        `INSERT INTO account_events (account_google_id, event_type, field_name, old_value, new_value, detail)
         VALUES ($1, 'bidding_change', $2, $3, $4, $5)`,
        [
          accountGoogleId,
          'Стратегия ставок',
          oldLabel,
          newLabel,
          `Кампания "${label}": стратегия ${oldLabel} → ${newLabel}`,
        ],
      );
    }
  }
}
