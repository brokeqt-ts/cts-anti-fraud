import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TYPE account_status AS ENUM ('active', 'suspended', 'banned', 'under_review');
    CREATE TYPE verification_status AS ENUM ('not_started', 'pending', 'verified', 'failed');
  `);

  await knex.schema.createTable('accounts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('google_account_id').notNullable().unique();
    table.string('display_name');
    table.string('country', 2);
    table.integer('account_age_days');
    table.specificType('status', 'account_status').notNullable().defaultTo('active');
    table.string('verification_type');
    table.specificType('verification_status', 'verification_status').notNullable().defaultTo('not_started');
    table.decimal('total_spend', 14, 2).notNullable().defaultTo(0);
    table.string('payment_bin', 6);
    table.string('payment_bank');
    table.string('payment_card_country', 2);
    table.integer('campaign_count').notNullable().defaultTo(0);
    table.integer('domain_count').notNullable().defaultTo(0);
    table.jsonb('pre_ban_warnings');
    table.jsonb('raw_payload');
    table.timestamps(true, true);
  });

  await knex.raw(`
    CREATE INDEX idx_accounts_google_account_id ON accounts (google_account_id);
    CREATE INDEX idx_accounts_status ON accounts (status);
    CREATE INDEX idx_accounts_country ON accounts (country);
  `);

  await knex.raw(`
    CREATE TRIGGER update_accounts_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_accounts_updated_at ON accounts');
  await knex.schema.dropTableIfExists('accounts');
  await knex.raw('DROP TYPE IF EXISTS verification_status');
  await knex.raw('DROP TYPE IF EXISTS account_status');
}
