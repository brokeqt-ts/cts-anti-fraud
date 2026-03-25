import type { Knex } from 'knex';

/**
 * Migration 030: Create change_history table.
 *
 * Placeholder infrastructure for capturing Google Ads change history data.
 * Stores raw payloads from ChangeEvent/ChangeHistory/MutateLog RPC services,
 * plus any partially-parsed fields we can extract.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('change_history', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('account_google_id').notNullable().index();
    table.text('rpc_service');             // e.g. "ChangeEventService/List"
    table.text('change_type');             // e.g. "CAMPAIGN_BUDGET", "AD_GROUP_CRITERION"
    table.text('resource_type');           // e.g. "campaign", "ad_group", "ad"
    table.text('resource_id');             // e.g. campaign_id, ad_group_id
    table.text('action');                  // e.g. "CREATE", "UPDATE", "REMOVE"
    table.text('changed_fields');          // comma-separated field names if available
    table.jsonb('old_value');              // previous value snapshot
    table.jsonb('new_value');              // new value snapshot
    table.text('user_email');              // who made the change if available
    table.timestamp('changed_at');         // when the change occurred
    table.jsonb('raw_entry');              // full raw entry from the payload
    table.text('raw_payload_id').index();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('change_history');
}
