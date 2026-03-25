import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('ai_model_predictions');
  if (exists) return;

  await knex.schema.createTable('ai_model_predictions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    // What was predicted
    // No FK to accounts — predictions must survive account deletion for leaderboard accuracy.
    // Accounts may be removed from the system while historical prediction outcomes
    // are still needed to calculate model accuracy, precision, and recall.
    table.text('account_google_id').notNullable();
    table.text('model_id').notNullable();
    table.text('strategy').nullable();
    table.decimal('predicted_ban_prob', 5, 4).nullable();
    table.text('predicted_risk_level').nullable();
    table.integer('predicted_lifetime_days').nullable();
    table.text('analysis_type').notNullable().defaultTo('account');

    // Meta
    table.integer('latency_ms').notNullable().defaultTo(0);
    table.integer('tokens_used').notNullable().defaultTo(0);
    table.decimal('cost_usd', 10, 6).notNullable().defaultTo(0);
    table.jsonb('raw_result').nullable();

    // Outcome (filled later when ban detected or account survives 90 days)
    table.text('actual_outcome').nullable();
    table.timestamp('actual_outcome_at', { useTz: true }).nullable();
    table.integer('actual_lifetime_days').nullable();
    table.boolean('ban_prediction_correct').nullable();
    table.integer('lifetime_error_days').nullable();
    table.timestamp('scored_at', { useTz: true }).nullable();

    // Timestamps
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE TRIGGER update_ai_model_predictions_updated_at
      BEFORE UPDATE ON ai_model_predictions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);

  await knex.raw(`
    CREATE INDEX idx_amp_account ON ai_model_predictions (account_google_id);
    CREATE INDEX idx_amp_model ON ai_model_predictions (model_id);
    CREATE INDEX idx_amp_outcome ON ai_model_predictions (actual_outcome) WHERE actual_outcome IS NOT NULL;
    CREATE INDEX idx_amp_created ON ai_model_predictions (created_at);
    CREATE INDEX idx_amp_pending ON ai_model_predictions (account_google_id, actual_outcome)
      WHERE actual_outcome IS NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_ai_model_predictions_updated_at ON ai_model_predictions');
  await knex.schema.dropTableIfExists('ai_model_predictions');
}
