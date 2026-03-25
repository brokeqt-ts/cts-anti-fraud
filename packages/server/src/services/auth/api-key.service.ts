import type { Pool } from 'pg';

export interface ApiKeyUser {
  id: string;
  role: 'admin' | 'buyer';
  name: string;
  api_key_scope: string;
}

export async function resolveApiKey(pool: Pool, key: string): Promise<ApiKeyUser | null> {
  const result = await pool.query(
    `SELECT id, role, name, api_key_scope
     FROM users
     WHERE api_key = $1 AND is_active = true`,
    [key],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as ApiKeyUser;
  return row;
}
