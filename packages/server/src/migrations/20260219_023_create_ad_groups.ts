import type { Knex } from 'knex';

/**
 * Migration 023: Create ad_groups table for AdGroupService/List data.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ad_groups', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('account_google_id').notNullable();
    table.string('campaign_id');
    table.string('ad_group_id').notNullable();
    table.string('ad_group_name');
    table.integer('status');
    table.uuid('raw_payload_id').references('id').inTable('raw_payloads').onDelete('SET NULL');
    table.timestamp('captured_at').notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);
  });

  await knex.raw(`CREATE INDEX idx_adgroups_account ON ad_groups (account_google_id)`);
  await knex.raw(`CREATE UNIQUE INDEX idx_adgroups_dedup ON ad_groups (ad_group_id, raw_payload_id)`);

  await knex.raw(`
    CREATE TRIGGER update_ad_groups_updated_at
    BEFORE UPDATE ON ad_groups
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_ad_groups_updated_at ON ad_groups');
  await knex.schema.dropTableIfExists('ad_groups');
}
