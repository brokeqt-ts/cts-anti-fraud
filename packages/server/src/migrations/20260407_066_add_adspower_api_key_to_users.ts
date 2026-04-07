import type { Knex } from 'knex';

// Migration was rolled back — kept as empty stub so knex doesn't report corrupt directory.
export async function up(_knex: Knex): Promise<void> {}
export async function down(_knex: Knex): Promise<void> {}
