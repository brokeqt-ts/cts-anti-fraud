import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';

const pool = getPool(env.DATABASE_URL);

// GET /best-practices
export async function listBestPracticesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { category, vertical, campaign_type } = request.query as {
    category?: string;
    vertical?: string;
    campaign_type?: string;
  };

  const conditions: string[] = ['bp.is_active = true'];
  const params: string[] = [];
  let idx = 1;

  if (category) { conditions.push(`category = $${idx++}`); params.push(category); }
  if (vertical) { conditions.push(`(offer_vertical = $${idx++} OR offer_vertical IS NULL)`); params.push(vertical); }
  if (campaign_type) { conditions.push(`(campaign_type = $${idx++} OR campaign_type IS NULL)`); params.push(campaign_type); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT bp.*, u.name as author_name
     FROM best_practices bp
     LEFT JOIN users u ON u.id = bp.created_by
     ${where}
     ORDER BY priority DESC, created_at DESC`,
    params,
  );

  await reply.send(result.rows);
}

// GET /best-practices/:id
export async function getBestPracticeHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params as { id: string };
  const result = await pool.query(
    `SELECT bp.*, u.name as author_name
     FROM best_practices bp
     LEFT JOIN users u ON u.id = bp.created_by
     WHERE bp.id = $1`,
    [id],
  );

  if (result.rows.length === 0) {
    await reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND' });
    return;
  }
  await reply.send(result.rows[0]);
}

// POST /best-practices (admin)
export async function createBestPracticeHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { category, campaign_type, offer_vertical, title, content, priority } = request.body as {
    category: string;
    campaign_type?: string;
    offer_vertical?: string;
    title: string;
    content: string;
    priority?: number;
  };
  const userId = (request as unknown as { user: { id: string } }).user.id;

  const result = await pool.query(
    `INSERT INTO best_practices (category, campaign_type, offer_vertical, title, content, priority, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [category, campaign_type ?? null, offer_vertical ?? null, title, content, priority ?? 0, userId],
  );

  await reply.status(201).send(result.rows[0]);
}

// PATCH /best-practices/:id (admin)
export async function updateBestPracticeHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params as { id: string };
  const updates = request.body as Record<string, unknown>;

  const allowed = ['category', 'campaign_type', 'offer_vertical', 'title', 'content', 'priority', 'is_active'];
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      setClauses.push(`${key} = $${idx++}`);
      values.push(updates[key]);
    }
  }

  if (setClauses.length === 0) {
    await reply.status(400).send({ error: 'No fields to update', code: 'BAD_REQUEST' });
    return;
  }

  values.push(id);
  const result = await pool.query(
    `UPDATE best_practices SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );

  if (result.rows.length === 0) {
    await reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND' });
    return;
  }
  await reply.send(result.rows[0]);
}

// DELETE /best-practices/:id (admin)
export async function deleteBestPracticeHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params as { id: string };
  const result = await pool.query(
    `UPDATE best_practices SET is_active = false WHERE id = $1 RETURNING id`,
    [id],
  );

  if (result.rows.length === 0) {
    await reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND' });
    return;
  }
  await reply.send({ status: 'ok' });
}

// GET /best-practices/for-prompt — get relevant practices for AI prompt injection
export async function getForPromptHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { vertical, campaign_type } = request.query as {
    vertical?: string;
    campaign_type?: string;
  };

  const result = await pool.query(
    `SELECT title, content, category FROM best_practices
     WHERE is_active = true
       AND (offer_vertical IS NULL OR offer_vertical = $1)
       AND (campaign_type IS NULL OR campaign_type = $2)
     ORDER BY priority DESC
     LIMIT 10`,
    [vertical ?? '', campaign_type ?? ''],
  );

  // Format for prompt injection
  const text = result.rows.map((r) => {
    const row = r as { title: string; content: string; category: string };
    return `### ${row.title} [${row.category}]\n${row.content}`;
  }).join('\n\n---\n\n');

  await reply.send({ practices: result.rows, prompt_text: text });
}
