import type pg from 'pg';

// ─── Result Interfaces ──────────────────────────────────────────────────────

export interface CtsSiteRow {
  id: string;
  domain: string;
  external_cts_id: string | null;
  created_at: string;
  updated_at: string;
  site_status: string | null;
  safe_page_quality_score: number | null;
  ssl_type: string | null;
}

export interface CtsSiteDetailRow {
  [key: string]: unknown;
}

export interface CtsSiteListResult {
  total: number;
  sites: CtsSiteRow[];
}

export interface CtsSiteUpdateFields {
  domain?: string;
  external_cts_id?: string | null;
}

// ─── Repository Functions ───────────────────────────────────────────────────

/**
 * List all CTS site links, enriched with domain data.
 */
export async function listCtsSites(pool: pg.Pool): Promise<CtsSiteListResult> {
  const result = await pool.query(`
    SELECT
      cs.id, cs.domain, cs.external_cts_id, cs.created_at, cs.updated_at,
      d.site_status, d.safe_page_quality_score, d.ssl_type
    FROM cts_sites cs
    LEFT JOIN domains d ON d.domain_name = cs.domain
    ORDER BY cs.updated_at DESC
  `);

  return {
    total: result.rowCount ?? 0,
    sites: result.rows.map(r => ({
      id: r['id'] as string,
      domain: r['domain'] as string,
      external_cts_id: r['external_cts_id'] as string | null,
      created_at: r['created_at'] as string,
      updated_at: r['updated_at'] as string,
      site_status: r['site_status'] as string | null,
      safe_page_quality_score: r['safe_page_quality_score'] != null ? Number(r['safe_page_quality_score']) : null,
      ssl_type: r['ssl_type'] as string | null,
    })),
  };
}

/**
 * Create a new CTS site link.
 */
export async function createCtsSite(
  pool: pg.Pool,
  domain: string,
  externalCtsId: string | null,
): Promise<CtsSiteDetailRow> {
  const result = await pool.query(
    `INSERT INTO cts_sites (domain, external_cts_id)
     VALUES ($1, $2)
     RETURNING *`,
    [domain, externalCtsId],
  );
  return result.rows[0] as CtsSiteDetailRow;
}

/**
 * Update a CTS site link. Returns the updated row, or null if not found.
 */
export async function updateCtsSite(
  pool: pg.Pool,
  id: string,
  fields: CtsSiteUpdateFields,
): Promise<CtsSiteDetailRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (fields.domain !== undefined) {
    sets.push(`domain = $${idx++}`);
    values.push(fields.domain);
  }
  if (fields.external_cts_id !== undefined) {
    sets.push(`external_cts_id = $${idx++}`);
    values.push(fields.external_cts_id);
  }

  if (sets.length === 0) {
    return null;
  }

  values.push(id);
  const result = await pool.query(
    `UPDATE cts_sites SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
    values,
  );

  return (result.rows[0] as CtsSiteDetailRow) ?? null;
}

/**
 * Delete a CTS site link by ID. Returns the deleted ID, or null if not found.
 */
export async function deleteCtsSite(
  pool: pg.Pool,
  id: string,
): Promise<string | null> {
  const result = await pool.query(
    `DELETE FROM cts_sites WHERE id = $1 RETURNING id`,
    [id],
  );
  return (result.rows[0]?.['id'] as string) ?? null;
}
