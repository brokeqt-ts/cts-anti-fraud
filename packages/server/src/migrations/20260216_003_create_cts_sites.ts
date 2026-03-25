import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('cts_sites', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('domain').notNullable();
    table.string('external_cts_id');
    table.timestamps(true, true);
  });

  await knex.raw(`
    CREATE INDEX idx_cts_sites_domain ON cts_sites (domain);
    CREATE INDEX idx_cts_sites_external_cts_id ON cts_sites (external_cts_id);
  `);

  await knex.raw(`
    CREATE TRIGGER update_cts_sites_updated_at
    BEFORE UPDATE ON cts_sites
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_cts_sites_updated_at ON cts_sites');
  await knex.schema.dropTableIfExists('cts_sites');
}
