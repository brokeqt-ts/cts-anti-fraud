import type { Knex } from 'knex';

/**
 * Migration 068: Create expert_rules table for configurable risk assessment rules.
 * Replaces hardcoded rules in rules-engine.ts with DB-backed, UI-editable rules.
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('expert_rules');
  if (exists) return;

  await knex.schema.createTable('expert_rules', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('name').notNullable().unique();
    table.text('description').nullable();
    table.text('category').notNullable();
    // category: 'bin' | 'domain' | 'account' | 'geo' | 'vertical' | 'spend'
    table.jsonb('condition').notNullable();
    // Simple: { "field": "binBanRate", "operator": ">", "value": 0.8 }
    // Compound: { "logic": "AND", "conditions": [...] }
    table.text('severity').notNullable().defaultTo('warning');
    // 'block' | 'warning' | 'info'
    table.text('message_template').notNullable();
    // Template with {variable} placeholders, e.g. "BIN {bin} имеет {binBanRate}% бан рейт"
    table.boolean('is_active').notNullable().defaultTo(true);
    table.integer('priority').notNullable().defaultTo(0);
    table.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    table.timestamps(true, true);
  });

  await knex.raw(`
    CREATE TRIGGER set_updated_at_expert_rules
    BEFORE UPDATE ON expert_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
  `);

  // Seed: migrate existing hardcoded rules as defaults
  await knex('expert_rules').insert([
    {
      name: 'Risky BIN prefix',
      description: 'BIN входит в список известных рискованных префиксов (виртуальные/предоплаченные карты)',
      category: 'bin',
      condition: JSON.stringify({
        field: 'bin',
        operator: 'starts_with_any',
        value: ['404038', '431274', '516732', '539860', '555555'],
      }),
      severity: 'warning',
      message_template: 'BIN {bin} входит в список рискованных (виртуальные/предоплаченные карты)',
      is_active: true,
      priority: 10,
    },
    {
      name: 'BIN with high ban rate',
      description: 'BIN ban rate превысил 50% — рекомендуется рассмотреть альтернативу',
      category: 'bin',
      condition: JSON.stringify({ field: 'binBanRate', operator: '>', value: 50 }),
      severity: 'warning',
      message_template: 'BIN {bin} имеет процент банов {binBanRate}% — рассмотрите альтернативу',
      is_active: true,
      priority: 20,
    },
    {
      name: 'BIN with critical ban rate',
      description: 'BIN ban rate превысил 80% — использование заблокировано',
      category: 'bin',
      condition: JSON.stringify({ field: 'binBanRate', operator: '>', value: 80 }),
      severity: 'block',
      message_template: 'BIN {bin} имеет критический процент банов ({binBanRate}%) — НЕ ИСПОЛЬЗОВАТЬ',
      is_active: true,
      priority: 30,
    },
    {
      name: 'Domain below minimum age for vertical',
      description: 'Домен моложе минимального порога для данной вертикали',
      category: 'domain',
      condition: JSON.stringify({ field: 'domainAgeDays', operator: '<', value: 7 }),
      severity: 'warning',
      message_template: 'Домен слишком молодой ({domainAgeDays} дн.) — рекомендуется минимум для вертикали {vertical}',
      is_active: true,
      priority: 10,
    },
    {
      name: 'Low safe page score',
      description: 'Safe Page Score домена ниже 40 — повышенный риск бана',
      category: 'domain',
      condition: JSON.stringify({ field: 'domainSafePageScore', operator: '<', value: 40 }),
      severity: 'warning',
      message_template: 'Низкий Safe Page Score домена ({domainSafePageScore}/100) — высокий риск бана',
      is_active: true,
      priority: 20,
    },
    {
      name: 'Critical safe page score',
      description: 'Safe Page Score домена ниже 20 — запуск не рекомендуется',
      category: 'domain',
      condition: JSON.stringify({ field: 'domainSafePageScore', operator: '<', value: 20 }),
      severity: 'block',
      message_template: 'Критически низкий Safe Page Score ({domainSafePageScore}/100) — запуск не рекомендуется',
      is_active: true,
      priority: 30,
    },
    {
      name: 'Budget recommendation for new accounts',
      description: 'Аккаунт моложе 7 дней — рекомендуемый бюджет до $30/день',
      category: 'spend',
      condition: JSON.stringify({ field: 'accountAgeDays', operator: '<', value: 7 }),
      severity: 'info',
      message_template: 'Рекомендуемый начальный бюджет: не более $30/день (аккаунт моложе 7 дней)',
      is_active: true,
      priority: 10,
    },
    {
      name: 'Budget recommendation for medium accounts',
      description: 'Аккаунт от 7 до 30 дней — рекомендуемый бюджет до $100/день',
      category: 'spend',
      condition: JSON.stringify({
        logic: 'AND',
        conditions: [
          { field: 'accountAgeDays', operator: '>=', value: 7 },
          { field: 'accountAgeDays', operator: '<', value: 30 },
        ],
      }),
      severity: 'info',
      message_template: 'Рекомендуемый бюджет: не более $100/день (аккаунт от 7 до 30 дней)',
      is_active: true,
      priority: 20,
    },
    {
      name: 'Geo with high ban rate',
      description: 'Ban rate по данному ГЕО превысил 40%',
      category: 'geo',
      condition: JSON.stringify({ field: 'geoBanRate', operator: '>', value: 40 }),
      severity: 'warning',
      message_template: 'Гео {geo} имеет процент банов {geoBanRate}%',
      is_active: true,
      priority: 10,
    },
    {
      name: 'Account has active policy violations',
      description: 'На аккаунте есть активные нарушения политики Google Ads',
      category: 'account',
      condition: JSON.stringify({ field: 'accountHasActiveViolations', operator: '==', value: true }),
      severity: 'block',
      message_template: 'Аккаунт имеет активные нарушения политики — запуск заблокирован',
      is_active: true,
      priority: 10,
    },
    {
      name: 'Very new account',
      description: 'Аккаунт моложе 3 дней — высокий риск мгновенного бана',
      category: 'account',
      condition: JSON.stringify({ field: 'accountAgeDays', operator: '<', value: 3 }),
      severity: 'warning',
      message_template: 'Аккаунт очень молодой ({accountAgeDays} дн.) — высокий риск мгновенного бана',
      is_active: true,
      priority: 20,
    },
    {
      name: 'Vertical with high ban rate',
      description: 'Ban rate по вертикали превысил 50%',
      category: 'vertical',
      condition: JSON.stringify({ field: 'verticalBanRate', operator: '>', value: 50 }),
      severity: 'warning',
      message_template: 'Вертикаль {vertical} имеет процент банов {verticalBanRate}% — будьте осторожны',
      is_active: true,
      priority: 10,
    },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('expert_rules');
}
