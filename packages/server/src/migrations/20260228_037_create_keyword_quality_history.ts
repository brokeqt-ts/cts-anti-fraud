import type { Knex } from 'knex';

/**
 * Migration 037: Create keyword_quality_history table.
 *
 * Stores daily Quality Score snapshots per keyword for tracking
 * QS trends over time. Components: overall (1-10), expected CTR,
 * ad relevance, landing page experience (enum 1-3).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('keyword_quality_history', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('account_google_id').notNullable();
    table.text('keyword_id').notNullable();
    table.date('date').notNullable();
    table.integer('quality_score'); // 1-10 overall score
    table.integer('expected_ctr'); // enum: 1=BELOW_AVERAGE, 2=AVERAGE, 3=ABOVE_AVERAGE
    table.integer('ad_relevance'); // enum: 1-3
    table.integer('landing_page_experience'); // enum: 1-3
    table.uuid('raw_payload_id').references('id').inTable('raw_payloads').onDelete('SET NULL');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // One row per keyword per day
  await knex.raw(`
    CREATE UNIQUE INDEX idx_kqh_dedup
    ON keyword_quality_history (account_google_id, keyword_id, date)
  `);
  await knex.raw(`CREATE INDEX idx_kqh_account ON keyword_quality_history (account_google_id)`);
  await knex.raw(`CREATE INDEX idx_kqh_keyword ON keyword_quality_history (keyword_id)`);
  await knex.raw(`CREATE INDEX idx_kqh_date ON keyword_quality_history (date)`);

  // Auto-update trigger
  await knex.raw(`
    CREATE TRIGGER update_keyword_quality_history_updated_at
    BEFORE UPDATE ON keyword_quality_history
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('keyword_quality_history');
}
