import type pg from 'pg';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface QualityScoreSnapshot {
  date: string;
  quality_score: number | null;
  expected_ctr: number | null;
  ad_relevance: number | null;
  landing_page_experience: number | null;
}

export interface QualityDistributionEntry {
  quality_score: number;
  keyword_count: number;
}

export interface KeywordQualityRow {
  keyword_id: string;
  keyword_text: string;
  quality_score: number | null;
  qs_expected_ctr: number | null;
  qs_ad_relevance: number | null;
  qs_landing_page: number | null;
}

// ─── Repository Functions ───────────────────────────────────────────────────

/**
 * Upsert quality score for a keyword (current snapshot in keywords table + history).
 */
export async function upsertKeywordQualityScore(
  pool: pg.Pool,
  accountGoogleId: string,
  keywordId: string,
  scores: {
    qualityScore: number | null;
    expectedCtr: number | null;
    adRelevance: number | null;
    landingPageExperience: number | null;
  },
  rawPayloadId?: string,
): Promise<void> {
  // Update keywords table
  await pool.query(
    `UPDATE keywords SET
       quality_score = COALESCE($1, quality_score),
       qs_expected_ctr = COALESCE($2, qs_expected_ctr),
       qs_ad_relevance = COALESCE($3, qs_ad_relevance),
       qs_landing_page = COALESCE($4, qs_landing_page),
       updated_at = NOW()
     WHERE account_google_id = $5 AND keyword_id = $6`,
    [
      scores.qualityScore,
      scores.expectedCtr,
      scores.adRelevance,
      scores.landingPageExperience,
      accountGoogleId,
      keywordId,
    ],
  );

  // Insert history snapshot (daily dedup)
  await pool.query(
    `INSERT INTO keyword_quality_history (
       account_google_id, keyword_id, date,
       quality_score, expected_ctr, ad_relevance, landing_page_experience,
       raw_payload_id
     ) VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7)
     ON CONFLICT (account_google_id, keyword_id, date) DO UPDATE SET
       quality_score = COALESCE(EXCLUDED.quality_score, keyword_quality_history.quality_score),
       expected_ctr = COALESCE(EXCLUDED.expected_ctr, keyword_quality_history.expected_ctr),
       ad_relevance = COALESCE(EXCLUDED.ad_relevance, keyword_quality_history.ad_relevance),
       landing_page_experience = COALESCE(EXCLUDED.landing_page_experience, keyword_quality_history.landing_page_experience),
       raw_payload_id = COALESCE(EXCLUDED.raw_payload_id, keyword_quality_history.raw_payload_id),
       updated_at = NOW()`,
    [
      accountGoogleId,
      keywordId,
      scores.qualityScore,
      scores.expectedCtr,
      scores.adRelevance,
      scores.landingPageExperience,
      rawPayloadId ?? null,
    ],
  );
}

/**
 * Get quality score history for a keyword within a date range.
 */
export async function getQualityScoreHistory(
  pool: pg.Pool,
  accountGoogleId: string,
  keywordId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<QualityScoreSnapshot[]> {
  const conditions: string[] = ['account_google_id = $1', 'keyword_id = $2'];
  const params: unknown[] = [accountGoogleId, keywordId];
  let idx = 3;

  if (dateFrom) {
    conditions.push(`date >= $${idx++}`);
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push(`date <= $${idx++}`);
    params.push(dateTo);
  }

  const result = await pool.query(
    `SELECT date::text, quality_score, expected_ctr, ad_relevance, landing_page_experience
     FROM keyword_quality_history
     WHERE ${conditions.join(' AND ')}
     ORDER BY date ASC`,
    params,
  );

  return result.rows.map(r => ({
    date: r['date'] as string,
    quality_score: r['quality_score'] != null ? Number(r['quality_score']) : null,
    expected_ctr: r['expected_ctr'] != null ? Number(r['expected_ctr']) : null,
    ad_relevance: r['ad_relevance'] != null ? Number(r['ad_relevance']) : null,
    landing_page_experience: r['landing_page_experience'] != null ? Number(r['landing_page_experience']) : null,
  }));
}

/**
 * Get quality score distribution for an account: count keywords at each QS level (1-10).
 */
export async function getAccountQualityDistribution(
  pool: pg.Pool,
  accountGoogleId: string,
): Promise<QualityDistributionEntry[]> {
  const result = await pool.query(
    `SELECT quality_score, COUNT(*)::int AS keyword_count
     FROM keywords
     WHERE account_google_id = $1 AND quality_score IS NOT NULL
     GROUP BY quality_score
     ORDER BY quality_score ASC`,
    [accountGoogleId],
  );

  return result.rows.map(r => ({
    quality_score: Number(r['quality_score']),
    keyword_count: Number(r['keyword_count']),
  }));
}

/**
 * Get keywords with lowest quality scores for an account (improvement targets).
 */
export async function getLowQualityKeywords(
  pool: pg.Pool,
  accountGoogleId: string,
  limit: number = 20,
): Promise<KeywordQualityRow[]> {
  const result = await pool.query(
    `SELECT keyword_id, keyword_text, quality_score, qs_expected_ctr, qs_ad_relevance, qs_landing_page
     FROM keywords
     WHERE account_google_id = $1 AND quality_score IS NOT NULL
     ORDER BY quality_score ASC, impressions DESC
     LIMIT $2`,
    [accountGoogleId, limit],
  );

  return result.rows.map(r => ({
    keyword_id: r['keyword_id'] as string,
    keyword_text: r['keyword_text'] as string,
    quality_score: r['quality_score'] != null ? Number(r['quality_score']) : null,
    qs_expected_ctr: r['qs_expected_ctr'] != null ? Number(r['qs_expected_ctr']) : null,
    qs_ad_relevance: r['qs_ad_relevance'] != null ? Number(r['qs_ad_relevance']) : null,
    qs_landing_page: r['qs_landing_page'] != null ? Number(r['qs_landing_page']) : null,
  }));
}
