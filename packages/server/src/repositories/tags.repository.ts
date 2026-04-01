import type pg from 'pg';

export interface Tag {
  id: string;
  name: string;
  color: string;
  account_count: number;
  created_at: string;
}

export async function listTags(pool: pg.Pool): Promise<Tag[]> {
  const result = await pool.query(`
    SELECT t.id, t.name, t.color, t.created_at,
           COUNT(at.id)::int AS account_count
    FROM tags t
    LEFT JOIN account_tags at ON at.tag_id = t.id
    GROUP BY t.id
    ORDER BY t.name
  `);
  return result.rows as Tag[];
}

export async function createTag(pool: pg.Pool, name: string, color: string): Promise<Tag> {
  const result = await pool.query(
    `INSERT INTO tags (name, color) VALUES ($1, $2)
     RETURNING id, name, color, created_at`,
    [name.trim(), color],
  );
  return { ...result.rows[0] as Tag, account_count: 0 };
}

export async function deleteTag(pool: pg.Pool, tagId: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM tags WHERE id = $1`, [tagId]);
  return (result.rowCount ?? 0) > 0;
}

export async function updateTag(pool: pg.Pool, tagId: string, name: string, color: string): Promise<Tag | null> {
  const result = await pool.query(
    `UPDATE tags SET name = $2, color = $3, updated_at = now()
     WHERE id = $1 RETURNING id, name, color, created_at`,
    [tagId, name.trim(), color],
  );
  if (result.rows.length === 0) return null;
  // Re-fetch count
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS account_count FROM account_tags WHERE tag_id = $1`,
    [tagId],
  );
  return { ...result.rows[0] as Tag, account_count: (countRes.rows[0] as { account_count: number }).account_count };
}

export async function assignTag(pool: pg.Pool, accountId: string, tagId: string): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO account_tags (account_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [accountId, tagId],
    );
    return true;
  } catch {
    return false;
  }
}

export async function unassignTag(pool: pg.Pool, accountId: string, tagId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM account_tags WHERE account_id = $1 AND tag_id = $2`,
    [accountId, tagId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getTagsForAccount(pool: pg.Pool, accountId: string): Promise<Array<{ id: string; name: string; color: string }>> {
  const result = await pool.query(
    `SELECT t.id, t.name, t.color
     FROM tags t
     JOIN account_tags at ON at.tag_id = t.id
     WHERE at.account_id = $1
     ORDER BY t.name`,
    [accountId],
  );
  return result.rows as Array<{ id: string; name: string; color: string }>;
}

/** Bulk assign a tag to multiple accounts by google_account_id */
export async function bulkAssignTag(
  pool: pg.Pool,
  googleAccountIds: string[],
  tagId: string,
): Promise<number> {
  if (googleAccountIds.length === 0) return 0;
  const result = await pool.query(
    `INSERT INTO account_tags (account_id, tag_id)
     SELECT a.id, $1 FROM accounts a
     WHERE a.google_account_id = ANY($2)
     ON CONFLICT DO NOTHING`,
    [tagId, googleAccountIds],
  );
  return result.rowCount ?? 0;
}
