/**
 * Domain External API Analyzers — free third-party API integrations.
 *
 * All APIs are free (some require API keys with generous limits).
 * Each function returns a result with `checked: boolean` — false if
 * API key not set or request failed.
 */

import dns from 'node:dns/promises';

// ─── Helper ──────────────────────────────────────────────────────────────────

async function safeFetch(url: string, opts?: RequestInit & { timeout?: number }): Promise<Response | null> {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(opts?.timeout ?? 5000) });
  } catch {
    return null;
  }
}

// ─── 1. crt.sh — Certificate Transparency ───────────────────────────────────

export interface CrtShResult {
  checked: boolean;
  totalCerts: number;
  subdomains: string[];
  oldestCert: string | null; // date
  newestCert: string | null;
  issuers: string[];
}

export async function checkCrtSh(domain: string): Promise<CrtShResult> {
  const empty: CrtShResult = { checked: false, totalCerts: 0, subdomains: [], oldestCert: null, newestCert: null, issuers: [] };
  try {
    const res = await safeFetch(`https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`, { timeout: 8000 });
    if (!res?.ok) return empty;
    const data = await res.json() as Array<{ name_value: string; not_before: string; not_after: string; issuer_name: string }>;
    if (!Array.isArray(data)) return empty;

    const subdomains = new Set<string>();
    const issuers = new Set<string>();
    let oldest: string | null = null;
    let newest: string | null = null;

    for (const cert of data) {
      for (const name of cert.name_value.split('\n')) {
        const clean = name.replace(/^\*\./, '').toLowerCase().trim();
        if (clean && clean !== domain) subdomains.add(clean);
      }
      if (!oldest || cert.not_before < oldest) oldest = cert.not_before;
      if (!newest || cert.not_before > newest) newest = cert.not_before;
      const issuerCn = cert.issuer_name.match(/CN=([^,]+)/)?.[1];
      if (issuerCn) issuers.add(issuerCn);
    }

    return {
      checked: true,
      totalCerts: data.length,
      subdomains: Array.from(subdomains).slice(0, 20),
      oldestCert: oldest?.slice(0, 10) ?? null,
      newestCert: newest?.slice(0, 10) ?? null,
      issuers: Array.from(issuers),
    };
  } catch (err) {
    console.error('[ext-api] crt.sh error:', err instanceof Error ? err.message : err);
    return empty;
  }
}

// ─── 2. Shodan InternetDB ────────────────────────────────────────────────────

export interface ShodanResult {
  checked: boolean;
  ports: number[];
  hostnames: string[];
  vulns: string[];
  tags: string[];
  cpes: string[];
}

export async function checkShodan(ip: string): Promise<ShodanResult> {
  const empty: ShodanResult = { checked: false, ports: [], hostnames: [], vulns: [], tags: [], cpes: [] };
  if (!ip || ip.includes(':')) return empty; // skip IPv6
  try {
    const res = await safeFetch(`https://internetdb.shodan.io/${ip}`);
    if (!res?.ok) return empty;
    const data = await res.json() as { ports?: number[]; hostnames?: string[]; vulns?: string[]; tags?: string[]; cpes?: string[] };
    return {
      checked: true,
      ports: data.ports ?? [],
      hostnames: data.hostnames ?? [],
      vulns: data.vulns ?? [],
      tags: data.tags ?? [],
      cpes: data.cpes ?? [],
    };
  } catch (err) {
    console.error('[ext-api] Shodan error:', err instanceof Error ? err.message : err);
    return empty;
  }
}

// ─── 3. DNS Analysis (SPF, DKIM, DMARC, MX, CAA) ────────────────────────────

export interface DnsAnalysisResult {
  checked: boolean;
  hasSpf: boolean;
  spfRecord: string | null;
  hasDmarc: boolean;
  dmarcRecord: string | null;
  hasMx: boolean;
  mxRecords: string[];
  hasCaa: boolean;
  caaRecords: string[];
  aRecords: string[];
  aaaaRecords: string[];
  nsRecords: string[];
}

export async function analyzeDns(domain: string): Promise<DnsAnalysisResult> {
  const empty: DnsAnalysisResult = {
    checked: false, hasSpf: false, spfRecord: null, hasDmarc: false, dmarcRecord: null,
    hasMx: false, mxRecords: [], hasCaa: false, caaRecords: [], aRecords: [], aaaaRecords: [], nsRecords: [],
  };
  try {
    const [txtRes, mxRes, caaRes, aRes, aaaaRes, nsRes] = await Promise.allSettled([
      dns.resolveTxt(domain),
      dns.resolveMx(domain),
      dns.resolveCaa(domain),
      dns.resolve4(domain),
      dns.resolve6(domain),
      dns.resolveNs(domain),
    ]);

    // SPF
    const txtRecords = txtRes.status === 'fulfilled' ? txtRes.value.map(r => r.join('')) : [];
    const spfRecord = txtRecords.find(r => r.startsWith('v=spf1')) ?? null;

    // DMARC
    let dmarcRecord: string | null = null;
    try {
      const dmarcTxt = await dns.resolveTxt(`_dmarc.${domain}`);
      dmarcRecord = dmarcTxt.map(r => r.join('')).find(r => r.startsWith('v=DMARC1')) ?? null;
    } catch { /* no DMARC */ }

    // MX
    const mxRecords = mxRes.status === 'fulfilled' ? mxRes.value.sort((a, b) => a.priority - b.priority).map(r => r.exchange) : [];

    // CAA
    const caaRecords = caaRes.status === 'fulfilled' ? caaRes.value.map(r => `${(r as unknown as Record<string, string>).tag ?? ''} ${(r as unknown as Record<string, string>).value ?? ''}`.trim()) : [];

    return {
      checked: true,
      hasSpf: spfRecord != null,
      spfRecord,
      hasDmarc: dmarcRecord != null,
      dmarcRecord,
      hasMx: mxRecords.length > 0,
      mxRecords,
      hasCaa: caaRecords.length > 0,
      caaRecords,
      aRecords: aRes.status === 'fulfilled' ? aRes.value : [],
      aaaaRecords: aaaaRes.status === 'fulfilled' ? aaaaRes.value : [],
      nsRecords: nsRes.status === 'fulfilled' ? nsRes.value : [],
    };
  } catch (err) {
    console.error('[ext-api] DNS error:', err instanceof Error ? err.message : err);
    return empty;
  }
}

// ─── 4. Spamhaus + SURBL DNS blocklist check ─────────────────────────────────

export interface BlocklistResult {
  checked: boolean;
  spamhausListed: boolean;
  surblListed: boolean;
  uriblListed: boolean;
  lists: string[]; // which lists flagged it
}

async function dnsblCheck(query: string): Promise<boolean> {
  try {
    await dns.resolve4(query);
    return true; // resolved = listed
  } catch {
    return false; // NXDOMAIN = not listed
  }
}

export async function checkBlocklists(domain: string, ip?: string): Promise<BlocklistResult> {
  try {
    const [spamhausDbl, surbl, uribl] = await Promise.all([
      dnsblCheck(`${domain}.dbl.spamhaus.org`),
      dnsblCheck(`${domain}.multi.surbl.org`),
      dnsblCheck(`${domain}.multi.uribl.com`),
    ]);

    // IP-based Spamhaus check
    let spamhausIp = false;
    if (ip) {
      const reversed = ip.split('.').reverse().join('.');
      spamhausIp = await dnsblCheck(`${reversed}.zen.spamhaus.org`);
    }

    const lists: string[] = [];
    if (spamhausDbl) lists.push('Spamhaus DBL');
    if (spamhausIp) lists.push('Spamhaus ZEN (IP)');
    if (surbl) lists.push('SURBL');
    if (uribl) lists.push('URIBL');

    return {
      checked: true,
      spamhausListed: spamhausDbl || spamhausIp,
      surblListed: surbl,
      uriblListed: uribl,
      lists,
    };
  } catch (err) {
    console.error('[ext-api] Blocklist error:', err instanceof Error ? err.message : err);
    return { checked: false, spamhausListed: false, surblListed: false, uriblListed: false, lists: [] };
  }
}

// ─── 5. CommonCrawl Index ────────────────────────────────────────────────────

export interface CommonCrawlResult {
  checked: boolean;
  found: boolean;
  pages: number;
  latestCrawl: string | null;
}

export async function checkCommonCrawl(domain: string): Promise<CommonCrawlResult> {
  const empty: CommonCrawlResult = { checked: false, found: false, pages: 0, latestCrawl: null };
  try {
    const res = await safeFetch(
      `https://index.commoncrawl.org/CC-MAIN-2025-13-index?url=*.${encodeURIComponent(domain)}&output=json&limit=5`,
      { timeout: 5000 },
    );
    if (!res?.ok) return empty;
    const text = await res.text();
    const lines = text.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return { checked: true, found: false, pages: 0, latestCrawl: null };

    let latest: string | null = null;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { timestamp?: string };
        if (entry.timestamp && (!latest || entry.timestamp > latest)) latest = entry.timestamp;
      } catch { /* skip */ }
    }

    return { checked: true, found: true, pages: lines.length, latestCrawl: latest?.slice(0, 8) ?? null };
  } catch (err) {
    console.error('[ext-api] CommonCrawl error:', err instanceof Error ? err.message : err);
    return empty;
  }
}

// ─── 6. OpenPhish Feed ───────────────────────────────────────────────────────

let phishCache: { urls: Set<string>; fetchedAt: number } | null = null;

export interface PhishCheckResult {
  checked: boolean;
  isPhishing: boolean;
}

export async function checkOpenPhish(domain: string): Promise<PhishCheckResult> {
  try {
    // Cache feed for 1 hour
    if (!phishCache || Date.now() - phishCache.fetchedAt > 3600_000) {
      const res = await safeFetch('https://openphish.com/feed.txt', { timeout: 10_000 });
      if (res?.ok) {
        const text = await res.text();
        phishCache = { urls: new Set(text.split('\n').map(u => u.trim().toLowerCase()).filter(Boolean)), fetchedAt: Date.now() };
      }
    }
    if (!phishCache) return { checked: false, isPhishing: false };

    const isPhishing = Array.from(phishCache.urls).some(u => u.includes(domain.toLowerCase()));
    return { checked: true, isPhishing };
  } catch (err) {
    console.error('[ext-api] OpenPhish error:', err instanceof Error ? err.message : err);
    return { checked: false, isPhishing: false };
  }
}

// ─── 7. AbuseIPDB ───────────────────────────────────────────────────────────

export interface AbuseIpdbResult {
  checked: boolean;
  abuseScore: number; // 0-100
  totalReports: number;
  countryCode: string | null;
  isp: string | null;
  usageType: string | null;
  isTor: boolean;
  isWhitelisted: boolean;
}

export async function checkAbuseIpdb(ip: string): Promise<AbuseIpdbResult> {
  const key = process.env['ABUSEIPDB_API_KEY'];
  const empty: AbuseIpdbResult = { checked: false, abuseScore: 0, totalReports: 0, countryCode: null, isp: null, usageType: null, isTor: false, isWhitelisted: false };
  if (!key || !ip) return empty;

  try {
    const res = await safeFetch(`https://api.abuseipdb.com/api/v2/check?ipAddress=${ip}&maxAgeInDays=90`, {
      headers: { 'Key': key, 'Accept': 'application/json' },
      timeout: 5000,
    });
    if (!res?.ok) return empty;
    const data = await res.json() as {
      data?: {
        abuseConfidenceScore?: number; totalReports?: number; countryCode?: string;
        isp?: string; usageType?: string; isTor?: boolean; isWhitelisted?: boolean;
      };
    };
    const d = data.data;
    if (!d) return empty;

    return {
      checked: true,
      abuseScore: d.abuseConfidenceScore ?? 0,
      totalReports: d.totalReports ?? 0,
      countryCode: d.countryCode ?? null,
      isp: d.isp ?? null,
      usageType: d.usageType ?? null,
      isTor: d.isTor ?? false,
      isWhitelisted: d.isWhitelisted ?? false,
    };
  } catch (err) {
    console.error('[ext-api] AbuseIPDB error:', err instanceof Error ? err.message : err);
    return empty;
  }
}

// ─── 10. URLhaus ─────────────────────────────────────────────────────────────

export interface UrlhausResult {
  checked: boolean;
  isMalware: boolean;
  threatType: string | null;
  tags: string[];
}

export async function checkUrlhaus(url: string): Promise<UrlhausResult> {
  const empty: UrlhausResult = { checked: false, isMalware: false, threatType: null, tags: [] };
  try {
    const res = await safeFetch('https://urlhaus-api.abuse.ch/v1/url/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `url=${encodeURIComponent(url)}`,
      timeout: 5000,
    });
    if (!res?.ok) return empty;
    const data = await res.json() as { query_status?: string; threat?: string; tags?: string[] };
    return {
      checked: true,
      isMalware: data.query_status === 'ok' && data.threat != null,
      threatType: data.threat ?? null,
      tags: data.tags ?? [],
    };
  } catch (err) {
    console.error('[ext-api] URLhaus error:', err instanceof Error ? err.message : err);
    return empty;
  }
}

// ─── 11. SerpAPI (Google index check) ────────────────────────────────────────

export interface SerpApiResult {
  checked: boolean;
  indexed: boolean;
  totalResults: number;
  topResults: Array<{ title: string; link: string }>;
}

export async function checkSerpApi(domain: string): Promise<SerpApiResult> {
  const key = process.env['SERPAPI_KEY'];
  const empty: SerpApiResult = { checked: false, indexed: false, totalResults: 0, topResults: [] };
  if (!key) return empty;

  try {
    const res = await safeFetch(
      `https://serpapi.com/search.json?q=site:${encodeURIComponent(domain)}&api_key=${key}&num=5`,
      { timeout: 10_000 },
    );
    if (!res?.ok) return empty;
    const data = await res.json() as {
      search_information?: { total_results?: number };
      organic_results?: Array<{ title?: string; link?: string }>;
    };

    const total = data.search_information?.total_results ?? 0;
    const topResults = (data.organic_results ?? []).slice(0, 5).map(r => ({ title: r.title ?? '', link: r.link ?? '' }));

    return { checked: true, indexed: total > 0, totalResults: total, topResults };
  } catch (err) {
    console.error('[ext-api] SerpAPI error:', err instanceof Error ? err.message : err);
    return empty;
  }
}

// ─── Run all external checks in parallel ─────────────────────────────────────

export interface AllExternalResults {
  crtSh: CrtShResult;
  shodan: ShodanResult;
  dnsAnalysis: DnsAnalysisResult;
  blocklists: BlocklistResult;
  commonCrawl: CommonCrawlResult;
  openPhish: PhishCheckResult;
  abuseIpdb: AbuseIpdbResult;
  urlhaus: UrlhausResult;
  serpApi: SerpApiResult;
}

export async function runAllExternalChecks(domain: string, url: string, ip?: string): Promise<AllExternalResults> {
  const [crtSh, dnsAnalysis, commonCrawl, openPhish, urlhaus, serpApi] = await Promise.all([
    checkCrtSh(domain),
    analyzeDns(domain),
    checkCommonCrawl(domain),
    checkOpenPhish(domain),
    checkUrlhaus(url),
    checkSerpApi(domain),
  ]);

  // These need IP — resolve if not provided
  const resolvedIp = ip ?? dnsAnalysis.aRecords[0] ?? null;
  const [shodan, blocklists, abuseIpdb] = await Promise.all([
    resolvedIp ? checkShodan(resolvedIp) : Promise.resolve({ checked: false, ports: [], hostnames: [], vulns: [], tags: [], cpes: [] } as ShodanResult),
    checkBlocklists(domain, resolvedIp ?? undefined),
    resolvedIp ? checkAbuseIpdb(resolvedIp) : Promise.resolve({ checked: false, abuseScore: 0, totalReports: 0, countryCode: null, isp: null, usageType: null, isTor: false, isWhitelisted: false } as AbuseIpdbResult),
  ]);

  return { crtSh, shodan, dnsAnalysis, blocklists, commonCrawl, openPhish, abuseIpdb, urlhaus, serpApi };
}
