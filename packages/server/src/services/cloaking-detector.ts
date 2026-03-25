import type pg from 'pg';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface CloakingSignal {
  signal: string;
  detected: boolean;
  detail: string;
}

export type CloakingType = 'none' | 'ip_based' | 'user_agent_based' | 'javascript_redirect' | 'server_side' | 'unknown';
export type SafePageType = 'clean' | 'redirect' | 'cloaked' | 'unknown';

export interface CloakingAnalysis {
  is_cloaked: boolean;
  confidence: number;
  cloaking_type: CloakingType;
  signals: CloakingSignal[];
  safe_page_type: SafePageType;
}

// ─── Known Cloaking Patterns ────────────────────────────────────────────────

const CLOAKING_JS_PATTERNS = [
  { pattern: /navigator\.userAgent\s*\.(?:includes|indexOf|match|test)\s*\(\s*['"](?:Googlebot|AdsBot|Mediapartners)/i, name: 'ua_check_googlebot' },
  { pattern: /navigator\.userAgent\s*\.(?:includes|indexOf|match|test)\s*\(\s*(?:['"]|\/)[^)]*(?:bot|crawl|spider)/i, name: 'ua_check_generic_bot' },
  { pattern: /document\.referrer\s*\.(?:includes|indexOf|match)\s*\(\s*['"]google/i, name: 'referrer_check' },
  { pattern: /window\.location\s*(?:\.href)?\s*=\s*['"][^'"]+['"]/i, name: 'js_redirect' },
  { pattern: /setTimeout\s*\(\s*(?:function|\(\))\s*(?:=>)?\s*\{[^}]*(?:window\.location|document\.location)/i, name: 'delayed_redirect' },
  { pattern: /eval\s*\(\s*(?:atob|unescape|decodeURIComponent)/i, name: 'obfuscated_eval' },
];

const CLOAKING_SERVICE_DOMAINS = [
  'keitaro.io', 'binom.org', 'tds.', 'tracker.', 'cloaking.', 'cloak.',
];

const GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 10_000;

// ─── HTTP Helpers ───────────────────────────────────────────────────────────

async function fetchWithUA(url: string, userAgent: string): Promise<{ status: number; body: string; finalUrl: string; redirectCount: number } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': userAgent },
      signal: controller.signal,
      redirect: 'follow',
    });

    const body = await response.text();
    return {
      status: response.status,
      body: body.slice(0, 100_000), // Limit to 100KB
      finalUrl: response.url,
      redirectCount: response.redirected ? 1 : 0,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Analysis Functions ─────────────────────────────────────────────────────

function extractTextContent(html: string): string {
  // Strip HTML tags for content comparison
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compare content between two HTML responses. Returns similarity ratio 0-1.
 */
export function compareContent(html1: string, html2: string): number {
  const text1 = extractTextContent(html1);
  const text2 = extractTextContent(html2);

  if (text1.length === 0 && text2.length === 0) return 1;
  if (text1.length === 0 || text2.length === 0) return 0;

  // Length-based comparison (quick heuristic)
  const minLen = Math.min(text1.length, text2.length);
  const maxLen = Math.max(text1.length, text2.length);
  const lengthRatio = minLen / maxLen;

  // Shared words ratio
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 3));

  if (words1.size === 0 && words2.size === 0) return lengthRatio;

  let shared = 0;
  for (const w of words1) {
    if (words2.has(w)) shared++;
  }

  const totalUnique = new Set([...words1, ...words2]).size;
  const wordRatio = totalUnique > 0 ? shared / totalUnique : 0;

  return (lengthRatio * 0.3 + wordRatio * 0.7);
}

/**
 * Detect suspicious JavaScript patterns in HTML source.
 */
export function detectSuspiciousJS(html: string): CloakingSignal[] {
  const signals: CloakingSignal[] = [];

  for (const { pattern, name } of CLOAKING_JS_PATTERNS) {
    const match = pattern.test(html);
    signals.push({
      signal: `js_pattern_${name}`,
      detected: match,
      detail: match ? `Suspicious JS pattern found: ${name}` : `Pattern ${name} not found`,
    });
  }

  return signals;
}

/**
 * Check for meta refresh or JS redirect tags.
 */
export function detectRedirectTags(html: string): CloakingSignal[] {
  const signals: CloakingSignal[] = [];

  // Meta refresh
  const metaRefresh = /<meta\s+http-equiv\s*=\s*["']refresh["'][^>]*content\s*=\s*["']\s*\d+\s*;\s*url=/i.test(html);
  signals.push({
    signal: 'meta_refresh',
    detected: metaRefresh,
    detail: metaRefresh ? 'Meta refresh redirect found' : 'No meta refresh',
  });

  return signals;
}

/**
 * Check for known cloaking service references in page source.
 */
export function detectKnownServices(html: string): CloakingSignal[] {
  const signals: CloakingSignal[] = [];
  const htmlLower = html.toLowerCase();

  for (const domain of CLOAKING_SERVICE_DOMAINS) {
    const found = htmlLower.includes(domain);
    if (found) {
      signals.push({
        signal: `known_service_${domain.replace(/\./g, '_')}`,
        detected: true,
        detail: `Known cloaking/TDS service domain: ${domain}`,
      });
    }
  }

  return signals;
}

// ─── Main Cloaking Detector ─────────────────────────────────────────────────

/**
 * Analyze a domain for cloaking by comparing Googlebot vs Chrome responses.
 */
export async function analyzeCloaking(domainName: string): Promise<CloakingAnalysis> {
  const url = `https://${domainName}`;
  const allSignals: CloakingSignal[] = [];

  // Fetch with both user agents
  const [googlebotResult, chromeResult] = await Promise.all([
    fetchWithUA(url, GOOGLEBOT_UA),
    fetchWithUA(url, CHROME_UA),
  ]);

  // If either fetch failed, we can't determine cloaking
  if (!googlebotResult || !chromeResult) {
    return {
      is_cloaked: false,
      confidence: 0,
      cloaking_type: 'none',
      signals: [{ signal: 'fetch_failed', detected: true, detail: 'Could not fetch page for comparison' }],
      safe_page_type: 'unknown',
    };
  }

  // 1. Redirect comparison
  const differentFinalUrls = googlebotResult.finalUrl !== chromeResult.finalUrl;
  allSignals.push({
    signal: 'different_final_urls',
    detected: differentFinalUrls,
    detail: differentFinalUrls
      ? `Googlebot→${googlebotResult.finalUrl}, Chrome→${chromeResult.finalUrl}`
      : 'Same final URL for both UAs',
  });

  // 2. Status code comparison
  const differentStatus = googlebotResult.status !== chromeResult.status;
  allSignals.push({
    signal: 'different_status_codes',
    detected: differentStatus,
    detail: differentStatus
      ? `Googlebot=${googlebotResult.status}, Chrome=${chromeResult.status}`
      : `Both returned ${googlebotResult.status}`,
  });

  // 3. Content comparison
  const similarity = compareContent(googlebotResult.body, chromeResult.body);
  const contentDifferent = similarity < 0.7;
  allSignals.push({
    signal: 'content_difference',
    detected: contentDifferent,
    detail: `Content similarity: ${Math.round(similarity * 100)}%`,
  });

  // 4. JS pattern analysis (Chrome version — the one users see)
  allSignals.push(...detectSuspiciousJS(chromeResult.body));

  // 5. Redirect tags
  allSignals.push(...detectRedirectTags(chromeResult.body));

  // 6. Known services
  allSignals.push(...detectKnownServices(chromeResult.body));

  // Calculate confidence
  const detectedSignals = allSignals.filter(s => s.detected);
  const criticalSignals = detectedSignals.filter(s =>
    ['different_final_urls', 'content_difference', 'different_status_codes',
     'js_pattern_ua_check_googlebot', 'js_pattern_obfuscated_eval'].includes(s.signal)
  );

  let confidence = 0;
  if (criticalSignals.length >= 2) confidence = 0.9;
  else if (criticalSignals.length === 1) confidence = 0.6;
  else if (detectedSignals.length >= 3) confidence = 0.5;
  else if (detectedSignals.length >= 1) confidence = 0.3;

  const isCloaked = confidence >= 0.6;

  // Determine cloaking type
  let cloakingType: CloakingType = 'none';
  if (isCloaked) {
    if (detectedSignals.some(s => s.signal.includes('ua_check'))) {
      cloakingType = 'user_agent_based';
    } else if (differentFinalUrls) {
      cloakingType = 'server_side';
    } else if (detectedSignals.some(s => s.signal.includes('redirect') || s.signal === 'meta_refresh')) {
      cloakingType = 'javascript_redirect';
    } else {
      cloakingType = 'unknown';
    }
  }

  // Determine safe page type
  let safePageType: SafePageType = 'clean';
  if (isCloaked) {
    safePageType = 'cloaked';
  } else if (differentFinalUrls || detectedSignals.some(s => s.signal === 'meta_refresh' && s.detected)) {
    safePageType = 'redirect';
  }

  return {
    is_cloaked: isCloaked,
    confidence: Math.round(confidence * 100) / 100,
    cloaking_type: cloakingType,
    signals: allSignals,
    safe_page_type: safePageType,
  };
}

// ─── Repository Integration ─────────────────────────────────────────────────

/**
 * Save cloaking analysis results to domain record.
 */
export async function saveCloakingAnalysis(
  pool: pg.Pool,
  domainName: string,
  analysis: CloakingAnalysis,
): Promise<void> {
  // Update safe_page_quality_score penalty for cloaked domains
  const scorePenalty = analysis.is_cloaked ? 30 : 0;

  await pool.query(
    `UPDATE domains
     SET cloaking_detected = $1,
         cloaking_type = $2,
         cloaking_signals = $3,
         cloaking_checked_at = NOW(),
         safe_page_type = $4,
         safe_page_quality_score = GREATEST(0, COALESCE(safe_page_quality_score, 50) - $5),
         updated_at = NOW()
     WHERE domain_name = $6`,
    [analysis.is_cloaked, analysis.cloaking_type, JSON.stringify(analysis.signals), analysis.safe_page_type, scorePenalty, domainName],
  );
}

/**
 * Check if domain needs cloaking re-check (>24h since last check or never checked).
 */
export async function needsCloakingCheck(pool: pg.Pool, domainName: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT cloaking_checked_at FROM domains WHERE domain_name = $1`,
    [domainName],
  );

  if (result.rowCount === 0) return false; // Domain not in DB
  const checkedAt = result.rows[0]!['cloaking_checked_at'] as string | null;
  if (!checkedAt) return true;

  const hoursSince = (Date.now() - new Date(checkedAt).getTime()) / (1000 * 60 * 60);
  return hoursSince >= 24;
}
