import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(connectionString: string): pg.Pool {
  if (!pool) {
    const isProduction = process.env['NODE_ENV'] === 'production';
    pool = new Pool({
      connectionString,
      ssl: isProduction ? { rejectUnauthorized: false } : false,
      // Prevent stale connections on cloud platforms (Saturn, Railway)
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      max: 20,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });

    pool.on('error', (err) => {
      console.error('[pg-pool] Unexpected idle client error:', err.message);
    });
  }
  return pool;
}

export async function checkConnection(connectionString: string): Promise<{
  connected: boolean;
  latency_ms: number | null;
}> {
  const start = Date.now();
  try {
    const p = getPool(connectionString);
    await p.query('SELECT 1');
    return {
      connected: true,
      latency_ms: Date.now() - start,
    };
  } catch {
    return {
      connected: false,
      latency_ms: null,
    };
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
