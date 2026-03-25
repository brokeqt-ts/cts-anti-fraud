import type { Knex } from 'knex';

/**
 * Migration 019: Create account_metrics table for OverviewService chart data.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('account_metrics', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('account_google_id').notNullable();
    table.string('metric_type').notNullable(); // 'impressions', 'cost', 'clicks', 'ctr', 'conversions'
    table.string('date_range'); // e.g. 'last_7_days', 'last_30_days'
    table.jsonb('data_points'); // array of {day_index, hour, value}
    table.decimal('total_value', 18, 4);
    table.uuid('raw_payload_id').references('id').inTable('raw_payloads').onDelete('SET NULL');
    table.timestamp('captured_at').notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);
  });

  await knex.raw(`CREATE INDEX idx_metrics_account ON account_metrics (account_google_id)`);
  await knex.raw(`CREATE INDEX idx_metrics_type ON account_metrics (metric_type)`);

  await knex.raw(`
    CREATE TRIGGER update_account_metrics_updated_at
    BEFORE UPDATE ON account_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_account_metrics_updated_at ON account_metrics');
  await knex.schema.dropTableIfExists('account_metrics');
}
