import type pg from 'pg';

/**
 * Auto-generate a meaningful display_name for an account.
 *
 * Pattern: "{domain}-{currency}" (e.g. "shoes-store.com-EUR")
 * If duplicate among same user's accounts: append "-2", "-3", etc.
 * Falls back to formatted CID: "783-835-3802"
 *
 * Only updates if current display_name is still the raw CID
 * (i.e. not manually renamed by the user).
 */
export async function autoNameAccount(
  pool: pg.Pool,
  googleAccountId: string,
): Promise<string | null> {
  // 1. Get current account data
  const accResult = await pool.query(
    `SELECT id, user_id, display_name, currency,
            (SELECT d.domain_name
               FROM domains d
               JOIN account_consumables ac ON ac.domain_id = d.id
              WHERE ac.account_id = a.id AND ac.unlinked_at IS NULL
              ORDER BY ac.linked_at DESC LIMIT 1
            ) AS domain
       FROM accounts a
      WHERE google_account_id = $1`,
    [googleAccountId],
  );

  const acc = accResult.rows[0] as {
    id: string;
    user_id: string | null;
    display_name: string | null;
    currency: string | null;
    domain: string | null;
  } | undefined;

  if (!acc) return null;

  // 2. Only auto-name if display_name is still the raw CID or null
  const currentName = acc.display_name?.trim() ?? '';
  const isCidName = /^\d{7,10}$/.test(currentName) || currentName === '';
  if (!isCidName) return acc.display_name;

  // 3. Build base name from available data
  const domain = acc.domain ?? null;
  const currency = acc.currency ?? null;

  let baseName: string;
  if (domain && currency) {
    baseName = `${domain}-${currency}`;
  } else if (domain) {
    baseName = domain;
  } else if (currency) {
    // Format CID: 7828353802 → 782-835-3802
    const cid = googleAccountId.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
    baseName = `${cid}-${currency}`;
  } else {
    // No domain or currency yet — use formatted CID
    return null; // Don't rename yet, wait for more data
  }

  // 4. Deduplicate among same user's accounts
  let finalName = baseName;
  if (acc.user_id) {
    const dupeResult = await pool.query(
      `SELECT display_name FROM accounts
        WHERE user_id = $1
          AND google_account_id != $2
          AND display_name LIKE $3`,
      [acc.user_id, googleAccountId, `${baseName}%`],
    );
    const existingNames = new Set(
      dupeResult.rows.map((r: { display_name: string }) => r.display_name),
    );
    if (existingNames.has(baseName)) {
      let n = 2;
      while (existingNames.has(`${baseName}-${n}`)) n++;
      finalName = `${baseName}-${n}`;
    }
  }

  // 5. Update
  await pool.query(
    `UPDATE accounts SET display_name = $1, updated_at = NOW()
      WHERE google_account_id = $2 AND (display_name IS NULL OR display_name ~ '^\\d{7,10}$')`,
    [finalName, googleAccountId],
  );

  return finalName;
}
