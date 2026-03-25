import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('creative_snapshots');
  if (exists) return;

  await knex.schema.createTable('creative_snapshots', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('account_google_id').notNullable();
    table.text('campaign_id').notNullable();
    table.text('campaign_name').nullable();
    table.date('snapshot_date').notNullable();
    table.bigInteger('impressions').defaultTo(0);
    table.bigInteger('clicks').defaultTo(0);
    table.decimal('ctr', 10, 6).nullable();
    table.decimal('cpc', 12, 2).nullable();
    table.bigInteger('conversions').defaultTo(0);
    table.bigInteger('cost_micros').defaultTo(0);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE UNIQUE INDEX idx_creative_snapshots_unique
      ON creative_snapshots (campaign_id, account_google_id, snapshot_date);
    CREATE INDEX idx_creative_snapshots_campaign
      ON creative_snapshots (campaign_id, snapshot_date);
    CREATE INDEX idx_creative_snapshots_account
      ON creative_snapshots (account_google_id, snapshot_date);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('creative_snapshots');
}
