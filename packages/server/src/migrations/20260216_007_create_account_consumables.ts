import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('account_consumables', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    table.uuid('proxy_id').references('id').inTable('proxies').onDelete('SET NULL');
    table.uuid('antidetect_profile_id').references('id').inTable('antidetect_profiles').onDelete('SET NULL');
    table.uuid('payment_method_id').references('id').inTable('payment_methods').onDelete('SET NULL');
    table.timestamp('linked_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('unlinked_at');
    table.timestamps(true, true);
  });

  await knex.raw(`
    CREATE INDEX idx_account_consumables_account_id ON account_consumables (account_id);
    CREATE INDEX idx_account_consumables_proxy_id ON account_consumables (proxy_id);
    CREATE INDEX idx_account_consumables_antidetect_profile_id ON account_consumables (antidetect_profile_id);
    CREATE INDEX idx_account_consumables_payment_method_id ON account_consumables (payment_method_id);
  `);

  await knex.raw(`
    CREATE TRIGGER update_account_consumables_updated_at
    BEFORE UPDATE ON account_consumables
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_account_consumables_updated_at ON account_consumables');
  await knex.schema.dropTableIfExists('account_consumables');
}
