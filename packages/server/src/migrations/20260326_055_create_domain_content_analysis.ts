import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('domain_content_analysis', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('domain_id').notNullable().references('id').inTable('domains').onDelete('CASCADE');
    table.text('url').notNullable(); // analyzed URL (may differ from domain if redirect)

    // ─── Content risk scoring ────────────────────────────────────────────
    table.integer('content_risk_score').defaultTo(0); // 0-100 overall
    table.integer('keyword_risk_score').defaultTo(0); // 0-100 grey keywords
    table.integer('compliance_score').defaultTo(0);   // 0-100 required pages/disclosures
    table.integer('structure_risk_score').defaultTo(0); // 0-100 suspicious patterns
    table.integer('redirect_risk_score').defaultTo(0);  // 0-100 redirect chain risk

    // ─── Grey keyword matches ────────────────────────────────────────────
    table.jsonb('keyword_matches').defaultTo('[]');
    // [{ keyword: "casino", vertical: "gambling", context: "...surrounding text...", severity: "critical" }]

    table.text('detected_vertical'); // auto-detected vertical from content

    // ─── Compliance checks ───────────────────────────────────────────────
    table.boolean('has_privacy_policy').defaultTo(false);
    table.boolean('has_terms_of_service').defaultTo(false);
    table.boolean('has_contact_info').defaultTo(false);
    table.boolean('has_disclaimer').defaultTo(false);
    table.boolean('has_about_page').defaultTo(false);
    table.boolean('has_cookie_consent').defaultTo(false);
    table.boolean('has_age_verification').defaultTo(false); // for gambling

    // ─── Structure red flags ─────────────────────────────────────────────
    table.jsonb('red_flags').defaultTo('[]');
    // [{ type: "countdown_timer", severity: "warning", detail: "..." }]

    table.boolean('has_countdown_timer').defaultTo(false);
    table.boolean('has_fake_reviews').defaultTo(false);
    table.boolean('has_before_after').defaultTo(false);
    table.boolean('has_hidden_text').defaultTo(false);
    table.boolean('has_aggressive_cta').defaultTo(false);
    table.boolean('has_popup_overlay').defaultTo(false);
    table.boolean('has_auto_play_video').defaultTo(false);
    table.boolean('has_external_redirect').defaultTo(false);

    // ─── Redirect analysis ───────────────────────────────────────────────
    table.integer('redirect_count').defaultTo(0);
    table.jsonb('redirect_chain').defaultTo('[]'); // ["url1", "url2", "final"]
    table.text('final_url');
    table.boolean('url_mismatch').defaultTo(false); // final_url != declared in ad

    // ─── Raw content metrics ─────────────────────────────────────────────
    table.text('page_language'); // detected language (ru, en, etc.)
    table.integer('total_links').defaultTo(0);
    table.integer('external_links').defaultTo(0);
    table.integer('form_count').defaultTo(0);
    table.integer('image_count').defaultTo(0);
    table.integer('script_count').defaultTo(0);
    table.integer('iframe_count').defaultTo(0);
    table.integer('word_count').defaultTo(0);
    table.text('page_title');
    table.text('page_description');
    table.jsonb('og_tags'); // { title, description, image, type }
    table.jsonb('outbound_domains').defaultTo('[]'); // unique external domains linked

    // ─── LLM-ready summary ───────────────────────────────────────────────
    table.text('analysis_summary'); // human-readable summary for LLM prompt injection
    table.jsonb('llm_context'); // structured data block for LLM context

    // ─── Timestamps ──────────────────────────────────────────────────────
    table.timestamp('analyzed_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE INDEX idx_dca_domain ON domain_content_analysis(domain_id);
    CREATE INDEX idx_dca_risk ON domain_content_analysis(content_risk_score DESC);
    CREATE INDEX idx_dca_vertical ON domain_content_analysis(detected_vertical);
    CREATE UNIQUE INDEX idx_dca_domain_unique ON domain_content_analysis(domain_id);
  `);

  await knex.raw(`
    CREATE TRIGGER update_domain_content_analysis_updated_at
    BEFORE UPDATE ON domain_content_analysis
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('domain_content_analysis');
}
