import { createHash } from 'node:crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ParsedPaymentMethod {
  bin6: string;
  bin8: string;
  last4: string;
  cardNetwork: string;
  cardTypeCode: number | null;
  panHash: string;
  expiryMonth: number | null;
  expiryYear: number | null;
  cardholderName: string | null;
  billingAddress: {
    street?: string;
    postalCode?: string;
    city?: string;
    state?: string;
    formatted: string;
  } | null;
  countryCode: string | null;
  locale: string | null;
  instrumentDisplay: string | null;
  paymentToken: string | null;
}

// ─── Card type code → network mapping ───────────────────────────────────────

const CARD_TYPE_MAP: Record<number, string> = {
  93: 'visa',
  112: 'visa',
  // Future: add mastercard, amex, etc. as we observe more codes
};

function resolveCardNetwork(pan: string, typeCode: number | null): string {
  if (typeCode != null && CARD_TYPE_MAP[typeCode]) {
    return CARD_TYPE_MAP[typeCode];
  }
  // Fallback: detect by BIN prefix
  const first = pan.charAt(0);
  if (first === '4') return 'visa';
  if (first === '5') return 'mastercard';
  if (first === '3') return 'amex';
  if (first === '6') return 'discover';
  return 'unknown';
}

// ─── Decode helpers ─────────────────────────────────────────────────────────

/** Repeatedly URL-decode until stable (max 5 passes). */
function deepUrlDecode(text: string): string {
  let current = text;
  for (let i = 0; i < 5; i++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      break;
    }
    if (decoded === current) break;
    current = decoded;
  }
  return current;
}

/** Strip JSON escaping layers: \\" → ", \\n → \n, \\/ → /, unicode escapes. */
function unescapeJson(text: string): string {
  let result = text;
  // Unescape doubled backslashes first
  result = result.replace(/\\\\/g, '\\');
  // Unescape escaped quotes
  result = result.replace(/\\"/g, '"');
  // Unescape escaped slashes
  result = result.replace(/\\\//g, '/');
  // Unescape newlines/tabs
  result = result.replace(/\\n/g, '\n');
  result = result.replace(/\\t/g, '\t');
  // Unescape unicode escapes (\uXXXX)
  result = result.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  return result;
}

/**
 * Extract f.req from URL-encoded batchexecute body, deep decode and unescape.
 * Returns the decoded body string suitable for regex extraction.
 */
function decodeBatchexecuteBody(rawPostBody: string): string | null {
  // batchexecute POST body is URL-encoded with f.req=... as the main payload
  let freqValue: string | null = null;

  try {
    const params = new URLSearchParams(rawPostBody);
    freqValue = params.get('f.req');
  } catch {
    // If URLSearchParams fails, try manual extraction
    const match = rawPostBody.match(/f\.req=([^&]*)/);
    if (match?.[1]) {
      freqValue = match[1];
    }
  }

  if (!freqValue) return null;

  // Deep URL-decode
  let decoded = deepUrlDecode(freqValue);

  // Unescape JSON string layers
  decoded = unescapeJson(decoded);

  return decoded;
}

// ─── Service ID extractors ──────────────────────────────────────────────────

/**
 * Extract PAN (card number) from service 254223144.
 * Pattern: "254223144":[" + 13-19 digits + ", + type code]
 * CRITICAL: Returns bin6/bin8/last4 only. Full PAN is hashed then discarded.
 */
function extractPan(body: string): {
  bin6: string;
  bin8: string;
  last4: string;
  cardNetwork: string;
  cardTypeCode: number | null;
  panHash: string;
} | null {
  const re = /"254223144"\s*:\s*\[\s*"(\d{13,19})"\s*,\s*(\d+)\s*\]/;
  const match = body.match(re);
  if (!match?.[1]) return null;

  const pan = match[1];
  const typeCode = match[2] ? parseInt(match[2], 10) : null;

  const panHash = createHash('sha256').update(pan).digest('hex');
  const cardNetwork = resolveCardNetwork(pan, typeCode);

  return {
    bin6: pan.slice(0, 6),
    bin8: pan.slice(0, 8),
    last4: pan.slice(-4),
    cardNetwork,
    cardTypeCode: typeCode,
    panHash,
  };
}

/**
 * Extract expiry from service 238350284.
 * Pattern: "238350284":[ null-or-value, [year, month, 0] ]
 */
function extractExpiry(body: string): { month: number; year: number } | null {
  const re = /"238350284"\s*:\s*\[(?:null|[^,]*),\s*\[(\d{4})\s*,\s*(\d{1,2})\s*,\s*\d{1,2}\]/;
  const match = body.match(re);
  if (!match?.[1] || !match[2]) return null;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);

  if (year < 2020 || year > 2050 || month < 1 || month > 12) return null;

  return { year, month };
}

/**
 * Extract cardholder name from service 235650857.
 * Finds all matches, filters out addresses, prefers values with spaces.
 * DO NOT extract service 235650858 (CVV).
 */
function extractCardholder(body: string): string | null {
  const re = /"235650857"\s*:\s*\[\s*"([^"]+)"\s*\]/g;
  const candidates: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (match[1]) candidates.push(match[1]);
  }

  if (candidates.length === 0) return null;

  // Filter out addresses (contain digits typical of postal codes or street numbers)
  const filtered = candidates.filter((c) => !/\d{4,}/.test(c));

  // Prefer values with spaces (first + last name)
  const withSpace = filtered.filter((c) => c.includes(' '));
  if (withSpace.length > 0) return withSpace[0];

  return filtered[0] ?? candidates[0];
}

/**
 * Extract billing address from service 318513491.
 * Pattern: "318513491":[ then [fieldType, "value"] pairs
 * fieldType: 1=name, 2=street, 4=postal, 5=state, 6=city
 */
function extractAddress(body: string): {
  street?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  formatted: string;
} | null {
  // Find the service block
  const blockRe = /"318513491"\s*:\s*\[/;
  const blockMatch = blockRe.exec(body);
  if (!blockMatch) return null;

  // Extract field pairs from the block region (search a reasonable window after the match)
  const region = body.slice(blockMatch.index, blockMatch.index + 2000);
  const fieldRe = /\[\s*(\d+)\s*,\s*"([^"]*?)"\s*\]/g;

  const fields: Record<number, string> = {};
  let fieldMatch: RegExpExecArray | null;
  while ((fieldMatch = fieldRe.exec(region)) !== null) {
    if (fieldMatch[1] && fieldMatch[2]) {
      fields[parseInt(fieldMatch[1], 10)] = fieldMatch[2];
    }
  }

  if (Object.keys(fields).length === 0) return null;

  const street = fields[2];
  const postalCode = fields[4];
  const state = fields[5];
  const city = fields[6];

  const parts = [street, city, state, postalCode].filter(Boolean);
  if (parts.length === 0) return null;

  return {
    ...(street ? { street } : {}),
    ...(postalCode ? { postalCode } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    formatted: parts.join(', '),
  };
}

/**
 * Extract country code and locale from service 323869557.
 * Looks for 2-letter country code and locale string.
 */
function extractCountry(body: string): { code: string; locale: string | null } | null {
  const re = /"323869557"\s*:\s*\[[\s\S]*?"([A-Z]{2})"\s*,\s*"([a-z]{2,5})"/;
  const match = body.match(re);
  if (!match?.[1]) return null;

  return {
    code: match[1],
    locale: match[2] ?? null,
  };
}

/**
 * Extract instrument display string from service 223344552.
 * Looks for masked card patterns like "Visa •••• 9899".
 */
function extractInstrumentDisplay(body: string): string | null {
  const blockRe = /"223344552"\s*:\s*\[/;
  const blockMatch = blockRe.exec(body);
  if (!blockMatch) return null;

  const region = body.slice(blockMatch.index, blockMatch.index + 500);
  // Look for masked card pattern: "Network •••• NNNN" or "Network ···· NNNN"
  const displayRe = /"([A-Za-z]+\s*[•·]{2,4}\s*\d{4})"/;
  const displayMatch = region.match(displayRe);

  return displayMatch?.[1] ?? null;
}

/**
 * Extract payment token from service 239872231.
 */
function extractPaymentToken(body: string): string | null {
  const re = /"239872231"\s*:\s*\[\s*"([^"]+)"\s*\]/;
  const match = body.match(re);
  return match?.[1] ?? null;
}

// ─── Main export ────────────────────────────────────────────────────────────

/**
 * Parse a POST body from Google Payments to extract payment method data.
 * Supports two formats:
 *   1. batchexecute body — f.req=... URL-encoded with nested JSON
 *   2. fix_instrument/submit — plain form data with service IDs in values
 *
 * Flow:
 * 1. Try batchexecute f.req decode
 * 2. If that fails, deep URL-decode the entire body (fix_instrument form)
 * 3. Extract PAN — if not found, this is not a payment submission
 * 4. Hash full PAN with SHA-256 for dedup, discard the original
 * 5. Extract all other fields from all available body representations
 */
export function parseBillingRequestBody(rawPostBody: string): ParsedPaymentMethod | null {
  if (!rawPostBody || rawPostBody.length < 50) return null;

  // Path 1: batchexecute f.req decode
  const batchDecoded = decodeBatchexecuteBody(rawPostBody);

  // Path 2: deep URL-decode + JSON unescape of the entire body (fix_instrument form)
  const fullDecoded = deepUrlDecode(rawPostBody);
  const fullUnescaped = unescapeJson(fullDecoded);

  // Build candidate bodies ordered by decode depth (most decoded first)
  const candidates: string[] = [];
  if (batchDecoded) candidates.push(batchDecoded);
  if (fullUnescaped !== rawPostBody) candidates.push(fullUnescaped);
  if (fullDecoded !== rawPostBody && fullDecoded !== fullUnescaped) candidates.push(fullDecoded);
  candidates.push(rawPostBody);

  // Try PAN extraction across all candidate bodies
  let pan: ReturnType<typeof extractPan> = null;
  for (const body of candidates) {
    pan = extractPan(body);
    if (pan) break;
  }
  if (!pan) return null; // Not a payment submission

  // Extract remaining fields from all candidate bodies
  let expiry: { month: number; year: number } | null = null;
  let cardholder: string | null = null;
  let address: ParsedPaymentMethod['billingAddress'] = null;
  let country: { code: string; locale: string | null } | null = null;
  let instrumentDisplay: string | null = null;
  let paymentToken: string | null = null;

  for (const body of candidates) {
    if (!expiry) expiry = extractExpiry(body);
    if (!cardholder) cardholder = extractCardholder(body);
    if (!address) address = extractAddress(body);
    if (!country) country = extractCountry(body);
    if (!instrumentDisplay) instrumentDisplay = extractInstrumentDisplay(body);
    if (!paymentToken) paymentToken = extractPaymentToken(body);
  }

  return {
    bin6: pan.bin6,
    bin8: pan.bin8,
    last4: pan.last4,
    cardNetwork: pan.cardNetwork,
    cardTypeCode: pan.cardTypeCode,
    panHash: pan.panHash,
    expiryMonth: expiry?.month ?? null,
    expiryYear: expiry?.year ?? null,
    cardholderName: cardholder,
    billingAddress: address,
    countryCode: country?.code ?? null,
    locale: country?.locale ?? null,
    instrumentDisplay,
    paymentToken,
  };
}
