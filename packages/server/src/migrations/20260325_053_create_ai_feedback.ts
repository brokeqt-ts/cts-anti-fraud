import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('ai_feedback');
  if (exists) return;

  await knex.schema.createTable('ai_feedback', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('prediction_id').notNullable().references('id').inTable('ai_model_predictions').onDelete('CASCADE');
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.integer('rating').notNullable();
    table.text('feedback_type').notNullable().defaultTo('rating');
    table.text('comment').nullable();
    table.text('correct_outcome').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE ai_feedback ADD CONSTRAINT ai_feedback_rating_check CHECK (rating BETWEEN -1 AND 1);
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX idx_ai_feedback_unique_vote ON ai_feedback (prediction_id, user_id);
    CREATE INDEX idx_ai_feedback_prediction ON ai_feedback (prediction_id);
    CREATE INDEX idx_ai_feedback_user ON ai_feedback (user_id);
    CREATE INDEX idx_ai_feedback_rating ON ai_feedback (rating);
  `);

  await knex.raw(`
    CREATE TRIGGER update_ai_feedback_updated_at
      BEFORE UPDATE ON ai_feedback
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_ai_feedback_updated_at ON ai_feedback');
  await knex.schema.dropTableIfExists('ai_feedback');
}
