import type { Knex } from 'knex';

/**
 * Migration 065: Fix notification_details deduplication and remove junk announcements.
 *
 * Problem 1 — Duplicates:
 *   The old unique index was (notification_id, raw_payload_id). Since each
 *   NotificationService/List interception creates a new raw_payload, the same
 *   Google notification_id was inserted on every capture. Fix: unique index on
 *   (notification_id, account_google_id) — one row per notification per account.
 *
 * Problem 2 — Junk announcements:
 *   ANNOUNCEMENT / ANNOUNCEMENT_ADWORDS_EXPRESS type notifications and
 *   SUGGESTIONS_* labels are Google-global or optimization hints — not
 *   account-level policy events. Delete existing rows and block future inserts
 *   via the parser blacklist update.
 */
export async function up(knex: Knex): Promise<void> {
  // 1. Delete junk rows: announcements and suggestions (duplicates of Google-global news)
  await knex.raw(`
    DELETE FROM notification_details
    WHERE notification_type IN ('ANNOUNCEMENT', 'ANNOUNCEMENT_ADWORDS_EXPRESS')
       OR label ~ '^SUGGESTIONS_'
       OR notification_type ~ '^SUGGESTIONS_'
  `);

  // 2. Deduplicate remaining rows — keep the latest captured_at per (notification_id, account_google_id)
  await knex.raw(`
    DELETE FROM notification_details a
    USING notification_details b
    WHERE a.notification_id IS NOT NULL
      AND a.account_google_id IS NOT NULL
      AND a.notification_id = b.notification_id
      AND a.account_google_id = b.account_google_id
      AND a.captured_at < b.captured_at
  `);

  // 3. Drop old partial unique index (notification_id, raw_payload_id)
  await knex.raw(`
    DROP INDEX IF EXISTS notification_details_notification_id_raw_payload_id_key
  `);
  // Also drop any unnamed constraint variants
  await knex.raw(`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'notification_details'
          AND indexdef ILIKE '%notification_id%raw_payload_id%'
      LOOP
        EXECUTE 'DROP INDEX IF EXISTS ' || r.indexname;
      END LOOP;
    END$$
  `);

  // 4. Add new unique index: one row per (notification_id, account_google_id)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_details_dedup
      ON notification_details (notification_id, account_google_id)
      WHERE notification_id IS NOT NULL AND account_google_id IS NOT NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS idx_notification_details_dedup`);
}
