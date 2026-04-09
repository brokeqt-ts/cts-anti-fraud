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
 * Track campaign-level changes: budget, status, domain.
 */
export async function trackCampaignChanges(
  pool: pg.Pool,
  accountGoogleId: string,
  campaignId: string,
  campaignName: string | null,
  incomingFields: Record<string, unknown>,
): Promise<void> {
  const result = await pool.query(
    `SELECT status, budget_micros, domain_name
     FROM campaigns WHERE account_google_id = $1 AND campaign_id = $2`,
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
}
