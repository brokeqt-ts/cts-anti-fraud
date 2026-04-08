import type pg from 'pg';

export interface ExpertRule {
  id: string;
  name: string;
  description: string | null;
  category: string;
  condition: unknown;
  severity: 'block' | 'warning' | 'info';
  message_template: string;
  is_active: boolean;
  priority: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRuleInput {
  name: string;
  description?: string | null;
  category: string;
  condition: unknown;
  severity: 'block' | 'warning' | 'info';
  message_template: string;
  is_active?: boolean;
  priority?: number;
  created_by?: string | null;
}

export interface UpdateRuleInput {
  name?: string;
  description?: string | null;
  category?: string;
  condition?: unknown;
  severity?: 'block' | 'warning' | 'info';
  message_template?: string;
  is_active?: boolean;
  priority?: number;
}

export async function listRules(pool: pg.Pool): Promise<ExpertRule[]> {
  const result = await pool.query<ExpertRule>(
    `SELECT id, name, description, category, condition, severity, message_template,
            is_active, priority, created_by, created_at, updated_at
     FROM expert_rules
     ORDER BY priority DESC, created_at ASC`,
  );
  return result.rows;
}

export async function getRuleById(pool: pg.Pool, id: string): Promise<ExpertRule | null> {
  const result = await pool.query<ExpertRule>(
    `SELECT id, name, description, category, condition, severity, message_template,
            is_active, priority, created_by, created_at, updated_at
     FROM expert_rules WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function createRule(pool: pg.Pool, input: CreateRuleInput): Promise<ExpertRule> {
  const result = await pool.query<ExpertRule>(
    `INSERT INTO expert_rules (name, description, category, condition, severity, message_template, is_active, priority, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.name,
      input.description ?? null,
      input.category,
      JSON.stringify(input.condition),
      input.severity,
      input.message_template,
      input.is_active ?? true,
      input.priority ?? 0,
      input.created_by ?? null,
    ],
  );
  return result.rows[0];
}

export async function updateRule(pool: pg.Pool, id: string, input: UpdateRuleInput): Promise<ExpertRule | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) { fields.push(`name = $${idx++}`); values.push(input.name); }
  if (input.description !== undefined) { fields.push(`description = $${idx++}`); values.push(input.description); }
  if (input.category !== undefined) { fields.push(`category = $${idx++}`); values.push(input.category); }
  if (input.condition !== undefined) { fields.push(`condition = $${idx++}`); values.push(JSON.stringify(input.condition)); }
  if (input.severity !== undefined) { fields.push(`severity = $${idx++}`); values.push(input.severity); }
  if (input.message_template !== undefined) { fields.push(`message_template = $${idx++}`); values.push(input.message_template); }
  if (input.is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(input.is_active); }
  if (input.priority !== undefined) { fields.push(`priority = $${idx++}`); values.push(input.priority); }

  if (fields.length === 0) return getRuleById(pool, id);

  values.push(id);
  const result = await pool.query<ExpertRule>(
    `UPDATE expert_rules SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

export async function deleteRule(pool: pg.Pool, id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM expert_rules WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function toggleRule(pool: pg.Pool, id: string, isActive: boolean): Promise<ExpertRule | null> {
  const result = await pool.query<ExpertRule>(
    'UPDATE expert_rules SET is_active = $1 WHERE id = $2 RETURNING *',
    [isActive, id],
  );
  return result.rows[0] ?? null;
}

export async function updatePriorities(pool: pg.Pool, updates: { id: string; priority: number }[]): Promise<void> {
  if (updates.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { id, priority } of updates) {
      await client.query('UPDATE expert_rules SET priority = $1 WHERE id = $2', [priority, id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
