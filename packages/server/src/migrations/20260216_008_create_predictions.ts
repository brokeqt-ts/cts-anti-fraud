import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TYPE ai_prediction_model AS ENUM ('claude', 'gemini', 'openai');
    CREATE TYPE prediction_type AS ENUM ('ban_probability', 'lifetime_prediction', 'risk_score');
  `);

  await knex.schema.createTable('predictions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('account_id').references('id').inTable('accounts').onDelete('SET NULL');
    table.uuid('campaign_id').references('id').inTable('campaigns').onDelete('SET NULL');
    table.specificType('model', 'ai_prediction_model').notNullable();
    table.specificType('prediction_type', 'prediction_type').notNullable();
    table.string('input_hash').notNullable();
    table.decimal('ban_probability', 5, 4);
    table.integer('predicted_lifetime_days');
    table.jsonb('actual_result');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('ai_leaderboard', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.specificType('model', 'ai_prediction_model').notNullable();
    table.string('metric_type').notNullable();
    table.decimal('score', 10, 4).notNullable();
    table.string('period').notNullable();
    table.timestamp('calculated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE INDEX idx_predictions_account_id ON predictions (account_id);
    CREATE INDEX idx_predictions_campaign_id ON predictions (campaign_id);
    CREATE INDEX idx_predictions_model ON predictions (model);
    CREATE INDEX idx_predictions_input_hash ON predictions (input_hash);
    CREATE INDEX idx_ai_leaderboard_model ON ai_leaderboard (model);
    CREATE INDEX idx_ai_leaderboard_period ON ai_leaderboard (period);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ai_leaderboard');
  await knex.schema.dropTableIfExists('predictions');
  await knex.raw('DROP TYPE IF EXISTS prediction_type');
  await knex.raw('DROP TYPE IF EXISTS ai_prediction_model');
}
