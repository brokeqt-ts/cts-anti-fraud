import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('raw_payloads', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('profile_id').notNullable();
    table.string('item_type').notNullable(); // 'raw' or 'raw_text'
    table.string('source_url');
    table.jsonb('raw_payload').notNullable();
    table.timestamps(true, true);

    table.index(['profile_id']);
    table.index(['item_type']);
    table.index(['created_at']);
  });

  await knex.raw(`
    CREATE TRIGGER update_raw_payloads_updated_at
    BEFORE UPDATE ON raw_payloads
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_raw_payloads_updated_at ON raw_payloads');
  await knex.schema.dropTableIfExists('raw_payloads');
}
