import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TYPE ban_target AS ENUM ('account', 'domain', 'campaign');
    CREATE TYPE appeal_status AS ENUM ('not_submitted', 'submitted', 'approved', 'rejected');
  `);

  await knex.schema.createTable('ban_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    table.uuid('campaign_id').references('id').inTable('campaigns').onDelete('SET NULL');
    table.uuid('domain_id').references('id').inTable('domains').onDelete('SET NULL');
    table.boolean('is_banned').notNullable().defaultTo(false);
    table.timestamp('banned_at');
    table.text('ban_reason');
    table.specificType('ban_target', 'ban_target').notNullable();
    table.specificType('appeal_status', 'appeal_status').notNullable().defaultTo('not_submitted');
    table.text('appeal_result');
    table.integer('lifetime_hours');
    table.decimal('lifetime_spend', 14, 2);
    table.jsonb('raw_payload');
    table.timestamps(true, true);
  });

  await knex.raw(`
    CREATE INDEX idx_ban_logs_account_id ON ban_logs (account_id);
    CREATE INDEX idx_ban_logs_campaign_id ON ban_logs (campaign_id);
    CREATE INDEX idx_ban_logs_domain_id ON ban_logs (domain_id);
    CREATE INDEX idx_ban_logs_banned_at ON ban_logs (banned_at);
    CREATE INDEX idx_ban_logs_ban_target ON ban_logs (ban_target);
  `);

  await knex.raw(`
    CREATE TRIGGER update_ban_logs_updated_at
    BEFORE UPDATE ON ban_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_ban_logs_updated_at ON ban_logs');
  await knex.schema.dropTableIfExists('ban_logs');
  await knex.raw('DROP TYPE IF EXISTS appeal_status');
  await knex.raw('DROP TYPE IF EXISTS ban_target');
}
