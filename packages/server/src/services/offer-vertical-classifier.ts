import type pg from 'pg';

// ─── Types ─────────────────────────────────────────────────────────────────

export type OfferVertical = 'gambling' | 'nutra' | 'crypto' | 'dating' | 'sweepstakes' | 'ecom' | 'finance' | 'other';

export interface VerticalSignal {
  source: string;
  vertical: OfferVertical;
  confidence: number;
  detail: string;
}

export interface VerticalClassification {
  vertical: OfferVertical;
  confidence: number;
  signals: VerticalSignal[];
}

// ─── Keyword Patterns per Vertical ─────────────────────────────────────────

const VERTICAL_PATTERNS: Record<OfferVertical, RegExp[]> = {
  gambling: [
    /casino/i, /poker/i, /slot[s ]?/i, /betting/i, /bookmaker/i,
    /roulette/i, /blackjack/i, /gambl/i, /sportsbook/i, /wager/i,
    /bet365|1xbet|betway|pin-?up|mostbet/i,
  ],
  nutra: [
    /weight\s?loss/i, /diet\s?pill/i, /supplement/i, /keto/i,
    /garcinia/i, /slimming/i, /detox/i, /health\s?product/i,
    /pharmacy|pharm/i, /cbd/i, /collagen/i, /anti-?aging/i,
  ],
  crypto: [
    /crypto/i, /bitcoin/i, /ethereum/i, /blockchain/i, /nft/i,
    /defi/i, /token/i, /trading\s?platform/i, /binance|coinbase/i,
    /forex/i, /investment\s?platform/i,
  ],
  dating: [
    /dating/i, /match/i, /singles/i, /relationship/i,
    /hook-?up/i, /chat\s?with/i, /meet\s?(?:women|men|people)/i,
    /love\s?online/i, /partner\s?search/i,
  ],
  sweepstakes: [
    /sweepstake/i, /giveaway/i, /prize/i, /winner/i,
    /lottery/i, /raffle/i, /free\s?iphone/i, /spin\s?(?:the|&)\s?win/i,
    /congratulations.*(?:won|selected)/i,
  ],
  ecom: [
    /shop\s?now/i, /buy\s?(?:now|online)/i, /free\s?shipping/i,
    /discount\s?code/i, /sale\s?%/i, /e-?commerce/i,
    /dropship/i, /aliexpress|shopify|amazon/i,
  ],
  finance: [
    /loan/i, /credit\s?(?:card|score)/i, /mortgage/i, /insurance/i,
    /refinance/i, /debt\s?(?:relief|consolidation)/i, /banking/i,
    /financial\s?advisor/i, /tax\s?(?:return|prep)/i,
  ],
  other: [],
};

// ─── Domain Patterns ───────────────────────────────────────────────────────

const DOMAIN_VERTICAL_HINTS: Array<{ pattern: RegExp; vertical: OfferVertical }> = [
  { pattern: /casino|slot|bet|poker|gambl/i, vertical: 'gambling' },
  { pattern: /diet|slim|health|nutra|pharm|suppl/i, vertical: 'nutra' },
  { pattern: /crypto|coin|trade|token|defi|forex/i, vertical: 'crypto' },
  { pattern: /dating|love|match|singles|flirt/i, vertical: 'dating' },
  { pattern: /sweep|prize|win|lotter/i, vertical: 'sweepstakes' },
  { pattern: /shop|store|buy|deal|sale/i, vertical: 'ecom' },
  { pattern: /loan|credit|insur|bank|financ|mortgage/i, vertical: 'finance' },
];

// ─── Classification Logic ──────────────────────────────────────────────────

/**
 * Classify a text string against vertical patterns.
 * Returns matching verticals with confidence.
 */
export function classifyText(text: string): VerticalSignal[] {
  const signals: VerticalSignal[] = [];

  for (const [vertical, patterns] of Object.entries(VERTICAL_PATTERNS) as Array<[OfferVertical, RegExp[]]>) {
    if (vertical === 'other') continue;

    let matchCount = 0;
    const matchedPatterns: string[] = [];

    for (const pattern of patterns) {
      if (pattern.test(text)) {
        matchCount++;
        matchedPatterns.push(pattern.source);
      }
    }

    if (matchCount > 0) {
      const confidence = Math.min(0.3 + matchCount * 0.2, 0.95);
      signals.push({
        source: 'text_pattern',
        vertical,
        confidence,
        detail: `Matched ${matchCount} pattern(s): ${matchedPatterns.slice(0, 3).join(', ')}`,
      });
    }
  }

  return signals;
}

/**
 * Classify a domain/URL against vertical patterns.
 */
export function classifyDomain(domain: string): VerticalSignal[] {
  const signals: VerticalSignal[] = [];

  for (const { pattern, vertical } of DOMAIN_VERTICAL_HINTS) {
    if (pattern.test(domain)) {
      signals.push({
        source: 'domain_pattern',
        vertical,
        confidence: 0.6,
        detail: `Domain matches ${vertical} pattern: ${pattern.source}`,
      });
    }
  }

  return signals;
}

/**
 * Determine the winning vertical from a set of signals using voting.
 */
export function resolveVertical(signals: VerticalSignal[]): VerticalClassification {
  if (signals.length === 0) {
    return { vertical: 'other', confidence: 0, signals: [] };
  }

  // Sum confidence by vertical
  const scores = new Map<OfferVertical, number>();
  for (const signal of signals) {
    scores.set(signal.vertical, (scores.get(signal.vertical) ?? 0) + signal.confidence);
  }

  // Find max
  let bestVertical: OfferVertical = 'other';
  let bestScore = 0;
  for (const [vertical, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestVertical = vertical;
    }
  }

  // Normalize confidence to 0-1
  const confidence = Math.min(bestScore / 2, 1);

  return {
    vertical: confidence >= 0.3 ? bestVertical : 'other',
    confidence: Math.round(confidence * 100) / 100,
    signals,
  };
}

// ─── Database Integration ──────────────────────────────────────────────────

/**
 * Auto-classify offer vertical for an account based on campaign names + landing pages.
 * Does NOT overwrite manually-set verticals (offer_vertical_source = 'manual').
 */
export async function classifyAndUpdateVertical(
  pool: pg.Pool,
  googleAccountId: string,
): Promise<VerticalClassification | null> {
  // Check if manually set
  const accountResult = await pool.query(
    `SELECT offer_vertical_source FROM accounts WHERE google_account_id = $1`,
    [googleAccountId],
  );

  if (accountResult.rowCount === 0) return null;
  if (accountResult.rows[0]!['offer_vertical_source'] === 'manual') return null;

  // Gather campaign data for classification
  const campaignsResult = await pool.query(
    `SELECT campaign_name, landing_page_url
     FROM campaigns
     WHERE account_google_id = $1
     ORDER BY captured_at DESC
     LIMIT 20`,
    [googleAccountId],
  );

  // Gather ad texts for additional signals
  const adsResult = await pool.query(
    `SELECT headlines, descriptions, final_urls, display_url
     FROM ads
     WHERE account_google_id = $1
     ORDER BY captured_at DESC
     LIMIT 20`,
    [googleAccountId],
  );

  const allSignals: VerticalSignal[] = [];

  // Classify campaign names
  for (const row of campaignsResult.rows) {
    const name = row['campaign_name'] as string | null;
    if (name) {
      allSignals.push(...classifyText(name));
    }

    const url = row['landing_page_url'] as string | null;
    if (url) {
      allSignals.push(...classifyDomain(url));
    }
  }

  // Classify ad content
  for (const row of adsResult.rows) {
    const headlines = row['headlines'] as string[] | null;
    if (Array.isArray(headlines)) {
      for (const h of headlines) {
        allSignals.push(...classifyText(h));
      }
    }

    const descriptions = row['descriptions'] as string[] | null;
    if (Array.isArray(descriptions)) {
      for (const d of descriptions) {
        allSignals.push(...classifyText(d));
      }
    }

    const displayUrl = row['display_url'] as string | null;
    if (displayUrl) {
      allSignals.push(...classifyDomain(displayUrl));
    }

    const finalUrls = row['final_urls'] as string[] | null;
    if (Array.isArray(finalUrls)) {
      for (const url of finalUrls) {
        allSignals.push(...classifyDomain(url));
      }
    }
  }

  const result = resolveVertical(allSignals);

  // Only update if we found something meaningful
  if (result.vertical !== 'other' && result.confidence >= 0.3) {
    await pool.query(
      `UPDATE accounts
       SET offer_vertical = $1,
           offer_vertical_source = 'auto',
           offer_vertical_signals = $2,
           updated_at = NOW()
       WHERE google_account_id = $3
         AND (offer_vertical_source IS NULL OR offer_vertical_source = 'auto')`,
      [result.vertical, JSON.stringify(result.signals), googleAccountId],
    );
  }

  return result;
}
