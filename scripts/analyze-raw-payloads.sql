-- =============================================================
-- CTS Anti-Fraud: Raw Payloads Analysis Script
-- NOT IN ORIGINAL SPEC — developer utility.
--
-- Run against the production database to understand Google Ads
-- internal API response formats before writing parsers. Used to
-- discover new RPC service names, field structures, and payload
-- patterns in raw_payloads JSONB data. Essential for reverse-
-- engineering new intercepted endpoints.
-- =============================================================
-- READ-ONLY — no modifications to any data.
-- =============================================================

-- 1. Total payload count
\echo '=== QUERY 1: Total payload count ==='
SELECT count(*) FROM raw_payloads;

-- 2. URL pattern frequency (top 30)
\echo ''
\echo '=== QUERY 2: URL pattern frequency (top 30) ==='
SELECT
  source_url,
  count(*) as cnt
FROM raw_payloads
GROUP BY source_url
ORDER BY cnt DESC
LIMIT 30;

-- 3. Payload previews for top 5 most common URLs
\echo ''
\echo '=== QUERY 3: Payload previews for top 5 URLs (first 500 chars) ==='
SELECT
  source_url,
  substring(raw_payload::text, 1, 500) as payload_preview
FROM raw_payloads
WHERE source_url IN (
  SELECT source_url
  FROM raw_payloads
  GROUP BY source_url
  ORDER BY count(*) DESC
  LIMIT 5
)
LIMIT 10;

-- 4. Distinct data-relevant URLs (exclude logging/status noise)
\echo ''
\echo '=== QUERY 4: Distinct data-relevant URL patterns ==='
SELECT DISTINCT source_url
FROM raw_payloads
WHERE source_url NOT LIKE '%logging%'
  AND source_url NOT LIKE '%ipl_status%'
ORDER BY source_url;

-- 5. BONUS: item_type distribution
\echo ''
\echo '=== QUERY 5: item_type distribution ==='
SELECT
  item_type,
  count(*) as cnt
FROM raw_payloads
GROUP BY item_type
ORDER BY cnt DESC;

-- 6. BONUS: Timeline of data collection
\echo ''
\echo '=== QUERY 6: Data collection timeline ==='
SELECT
  date_trunc('hour', created_at) as hour,
  count(*) as payloads
FROM raw_payloads
GROUP BY 1
ORDER BY 1;

-- 7. BONUS: Per-profile payload counts
\echo ''
\echo '=== QUERY 7: Payloads per profile ==='
SELECT
  profile_id,
  count(*) as cnt,
  min(created_at) as first_seen,
  max(created_at) as last_seen
FROM raw_payloads
GROUP BY profile_id
ORDER BY cnt DESC;

-- 8. BONUS: Full payload sample (1 per unique source_url) — for deep analysis
\echo ''
\echo '=== QUERY 8: One full payload per unique source_url (first 2000 chars) ==='
SELECT DISTINCT ON (source_url)
  source_url,
  item_type,
  substring(raw_payload::text, 1, 2000) as payload_sample
FROM raw_payloads
ORDER BY source_url, created_at
LIMIT 20;
