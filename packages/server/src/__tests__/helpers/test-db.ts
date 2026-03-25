/**
 * Test database setup/teardown utilities.
 *
 * Usage:
 *   - Set TEST_DATABASE_URL env var to a test PostgreSQL database
 *   - Tests auto-skip if TEST_DATABASE_URL is not set
 *   - Before suite: runs migrations
 *   - After each file: truncates all user tables
 *   - After suite: closes pool
 */
import pg from 'pg';
import path from 'node:path';
import knexLib from 'knex';

const { Pool } = pg;

let testPool: pg.Pool | null = null;

export function getTestDatabaseUrl(): string | undefined {
  return process.env['TEST_DATABASE_URL'];
}

export function hasTestDatabase(): boolean {
  return !!getTestDatabaseUrl();
}

export function getTestPool(): pg.Pool {
  if (!testPool) {
    const url = getTestDatabaseUrl();
    if (!url) throw new Error('TEST_DATABASE_URL not set');
    testPool = new Pool({ connectionString: url });
  }
  return testPool;
}

export async function runMigrations(): Promise<void> {
  const url = getTestDatabaseUrl();
  if (!url) return;

  const knex = knexLib({
    client: 'pg',
    connection: url,
    migrations: {
      directory: path.resolve(__dirname, '../../migrations'),
    },
  });

  try {
    await knex.migrate.latest();
  } finally {
    await knex.destroy();
  }
}

/**
 * Truncate all user-created tables (not system tables).
 */
export async function truncateAll(): Promise<void> {
  const pool = getTestPool();
  const result = await pool.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE 'knex_%'
      AND tablename NOT LIKE 'pg_%'
    ORDER BY tablename
  `);

  const tables = result.rows.map(r => r['tablename'] as string);
  if (tables.length > 0) {
    await pool.query(`TRUNCATE ${tables.map(t => `"${t}"`).join(', ')} CASCADE`);
  }
}

export async function closeTestPool(): Promise<void> {
  if (testPool) {
    await testPool.end();
    testPool = null;
  }
}

export const TEST_API_KEY = 'test-api-key-12345';
