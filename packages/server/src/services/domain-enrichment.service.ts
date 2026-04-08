import dns from 'node:dns/promises';
import tls from 'node:tls';
import type pg from 'pg';
import { analyzeCloaking, saveCloakingAnalysis, needsCloakingCheck } from './cloaking-detector.js';
import { analyzeAndSave } from './domain-content-analyzer.js';

/** Rate-limit helper: sleep ms */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface EnrichmentResult {
  domain: string;
  registrar: string | null;
  created_date: string | null;
  expires_date: string | null;
  domain_age_days: number | null;
  whois_privacy: boolean | null;
  hosting_ip: string | null;
  asn: string | null;
  hosting_provider: string | null;
  hosting_country: string | null;
  nameservers: string[] | null;
  has_cloudflare: boolean | null;
  dns_provider: string | null;
  ssl_type: string | null;
  ssl_issuer: string | null;
  ssl_expires: string | null;
  http_status: number | null;
  site_status: string | null;
  meta_title: string | null;
  meta_description: string | null;
  page_word_count: number | null;
  has_google_analytics: boolean | null;
  has_gtm: boolean | null;
  has_facebook_pixel: boolean | null;
  has_privacy_page: boolean | null;
  has_terms_page: boolean | null;
  has_contact_page: boolean | null;
  has_blog: boolean | null;
  pagespeed_score: number | null;
  content_quality_score: number | null;
  safe_page_quality_score: number;
}

/**
 * Domain Enrichment Service.
 *
 * Collects domains from ads/keywords final_urls, upserts into domains table,
 * and enriches each domain with DNS, WHOIS, SSL, HTTP, and page analysis data.
 */
export class DomainEnrichmentService {
  constructor(private pool: pg.Pool) {}

  /** Step 1: Extract unique domains from ALL sources, upsert into domains. */
  async collectDomains(): Promise<string[]> {
    const result = await this.pool.query(`
      WITH all_urls AS (
        -- 1. ads.final_urls
        SELECT jsonb_array_elements_text(final_urls) AS url
        FROM ads WHERE final_urls IS NOT NULL AND jsonb_typeof(final_urls) = 'array'
        UNION
        -- 2. keywords.final_urls
        SELECT jsonb_array_elements_text(final_urls::jsonb) AS url
        FROM keywords WHERE final_urls IS NOT NULL AND final_urls != 'null'
      ),
      extracted AS (
        SELECT DISTINCT
          regexp_replace(regexp_replace(url, '^https?://', ''), '/.*$', '') AS domain
        FROM all_urls
        WHERE url ~ '^https?://'
      ),
      -- 3. Domains from ads display_url (direct column, no subquery needed)
      ad_display_domains AS (
        SELECT DISTINCT display_url AS domain FROM ads
        WHERE display_url IS NOT NULL AND display_url != ''
      ),
      combined AS (
        SELECT domain FROM extracted
        UNION
        SELECT domain FROM ad_display_domains
      )
      SELECT domain FROM combined WHERE domain != '' AND domain NOT LIKE '%localhost%' AND domain NOT LIKE '%google%'
    `);

    const domains: string[] = [];
    for (const row of result.rows) {
      const domain = row['domain'] as string;
      domains.push(domain);

      await this.pool.query(
        `INSERT INTO domains (domain_name)
         VALUES ($1)
         ON CONFLICT (domain_name) DO NOTHING`,
        [domain],
      );
    }

    return domains;
  }

  /** Step 2: Enrich all domains needing update. */
  async enrichAll(maxAge24h = true): Promise<{ enriched: number; errors: number }> {
    // Also re-enrich domains with registrar IS NULL (RDAP not yet populated)
    const condition = maxAge24h
      ? `WHERE last_checked_at IS NULL OR last_checked_at < NOW() - INTERVAL '24 hours' OR registrar IS NULL`
      : `WHERE last_checked_at IS NULL OR registrar IS NULL`;

    const result = await this.pool.query(
      `SELECT domain_name FROM domains ${condition} ORDER BY last_checked_at ASC NULLS FIRST LIMIT 50`,
    );
    console.log(`[domain-enrichment] Found ${result.rowCount} domains to enrich (condition: ${condition})`);

    let enriched = 0;
    let errors = 0;

    for (const row of result.rows) {
      const domain = row['domain_name'] as string;
      try {
        console.log(`[domain-enrichment] Enriching: ${domain}`);
        const data = await this.enrichDomain(domain);
        await this.saveDomainData(domain, data);
        // Run cloaking check if needed
        try {
          if (await needsCloakingCheck(this.pool, domain)) {
            const cloakingResult = await analyzeCloaking(domain);
            await saveCloakingAnalysis(this.pool, domain, cloakingResult);
          }
        } catch (cloakErr) {
          console.warn(`[domain-enrichment] Cloaking check failed for ${domain}:`, cloakErr instanceof Error ? cloakErr.message : cloakErr);
        }
        enriched++;
      } catch (err) {
        console.error(`[domain-enrichment] Failed to enrich ${domain}:`, err instanceof Error ? err.message : err);
        // Mark as checked to avoid retrying immediately
        await this.pool.query(
          `UPDATE domains SET last_checked_at = NOW(), site_status = 'error' WHERE domain_name = $1`,
          [domain],
        );
        errors++;
      }
      // Rate limit: ~5s between domains
      await sleep(2000);
    }

    return { enriched, errors };
  }

  /** Enrich a single domain with all data sources. */
  async enrichDomain(domain: string): Promise<EnrichmentResult> {
    const result: EnrichmentResult = {
      domain,
      registrar: null, created_date: null, expires_date: null,
      domain_age_days: null, whois_privacy: null,
      hosting_ip: null, asn: null, hosting_provider: null, hosting_country: null,
      nameservers: null, has_cloudflare: null, dns_provider: null,
      ssl_type: null, ssl_issuer: null, ssl_expires: null,
      http_status: null, site_status: null,
      meta_title: null, meta_description: null, page_word_count: null,
      has_google_analytics: null, has_gtm: null, has_facebook_pixel: null,
      has_privacy_page: null, has_terms_page: null,
      has_contact_page: null, has_blog: null,
      pagespeed_score: null, content_quality_score: null,
      safe_page_quality_score: 0,
    };

    // a) DNS lookup
    await this.enrichDns(domain, result);
    await sleep(500);

    // b) IP → ASN/Hosting
    if (result.hosting_ip) {
      await this.enrichIpInfo(result.hosting_ip, result);
      await sleep(1000);
    }

    // c) SSL check
    await this.enrichSsl(domain, result);
    await sleep(500);

    // d) HTTP check + page scan
    await this.enrichHttp(domain, result);
    await sleep(500);

    // e) RDAP / WHOIS lookup
    await this.enrichRdap(domain, result);

    // f) Calculate safe page quality score
    result.safe_page_quality_score = this.calculateScore(result);

    return result;
  }

  /** DNS resolution: A records + NS records. */
  private async enrichDns(domain: string, result: EnrichmentResult): Promise<void> {
    try {
      const addresses = await dns.resolve4(domain);
      if (addresses.length > 0) {
        result.hosting_ip = addresses[0]!;
      }
    } catch { /* Domain may not resolve */ }

    try {
      const ns = await dns.resolveNs(domain);
      result.nameservers = ns;
      const nsStr = ns.join(' ').toLowerCase();
      result.has_cloudflare = nsStr.includes('cloudflare');

      if (nsStr.includes('cloudflare')) result.dns_provider = 'cloudflare';
      else if (nsStr.includes('awsdns') || nsStr.includes('route53')) result.dns_provider = 'other';
      else if (nsStr.includes('google') || nsStr.includes('googledomains')) result.dns_provider = 'other';
      else result.dns_provider = 'direct';
    } catch { /* NS may not resolve */ }
  }

  /** IP info from ipapi.co (free, no key needed for moderate usage). */
  private async enrichIpInfo(ip: string, result: EnrichmentResult): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`https://ipapi.co/${ip}/json/`, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        result.hosting_provider = (data['org'] as string) ?? null;
        result.asn = (data['asn'] as string) ?? null;
        result.hosting_country = (data['country_code'] as string) ?? null;
      }
    } catch { /* API may be unreachable */ }
  }

  /** SSL certificate check via TLS connection. */
  private async enrichSsl(domain: string, result: EnrichmentResult): Promise<void> {
    try {
      const cert = await new Promise<{
        issuer: { O?: string };
        valid_to: string;
      } | null>((resolve) => {
        const socket = tls.connect(
          { host: domain, port: 443, servername: domain, timeout: 5000 },
          () => {
            const peerCert = socket.getPeerCertificate();
            socket.destroy();
            if (peerCert && peerCert.issuer) {
              resolve({
                issuer: peerCert.issuer as { O?: string },
                valid_to: peerCert.valid_to,
              });
            } else {
              resolve(null);
            }
          },
        );
        socket.on('error', () => { socket.destroy(); resolve(null); });
        socket.on('timeout', () => { socket.destroy(); resolve(null); });
      });

      if (cert) {
        const issuerOrg = cert.issuer.O ?? '';
        result.ssl_issuer = issuerOrg;

        if (issuerOrg.toLowerCase().includes("let's encrypt") || issuerOrg.toLowerCase().includes('letsencrypt')) {
          result.ssl_type = 'lets_encrypt';
        } else if (issuerOrg.toLowerCase().includes('cloudflare')) {
          result.ssl_type = 'lets_encrypt'; // Cloudflare uses LE-type certs, treat similarly
        } else if (issuerOrg) {
          result.ssl_type = 'paid';
        } else {
          result.ssl_type = 'unknown';
        }

        if (cert.valid_to) {
          try {
            const d = new Date(cert.valid_to);
            if (!isNaN(d.getTime())) result.ssl_expires = d.toISOString().slice(0, 10);
          } catch { /* Invalid date */ }
        }
      } else {
        result.ssl_type = 'none';
      }
    } catch {
      result.ssl_type = 'none';
    }
  }

  /** HTTP fetch + HTML page analysis. */
  private async enrichHttp(domain: string, result: EnrichmentResult): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`https://${domain}/`, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CTSBot/1.0)',
          Accept: 'text/html',
        },
      });
      clearTimeout(timeout);

      result.http_status = res.status;

      if (res.status >= 200 && res.status < 300) {
        result.site_status = 'live';
      } else if (res.status >= 300 && res.status < 400) {
        result.site_status = 'redirect';
      } else if (res.status === 403) {
        result.site_status = 'blocked';
      } else {
        result.site_status = 'down';
      }

      if (res.ok) {
        const html = await res.text();
        this.analyzeHtml(html, result);
      }
    } catch {
      result.site_status = 'down';
    }
  }

  /** Analyze HTML body for trackers, pages, and content quality. */
  private analyzeHtml(html: string, result: EnrichmentResult): void {
    const lower = html.toLowerCase();

    // Meta title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    result.meta_title = titleMatch?.[1]?.trim()?.slice(0, 500) ?? null;

    // Meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    result.meta_description = descMatch?.[1]?.trim()?.slice(0, 500) ?? null;

    // Page word count (strip tags, count words)
    const textOnly = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    result.page_word_count = textOnly.split(' ').filter(w => w.length > 1).length;

    // Trackers
    result.has_google_analytics = lower.includes('google-analytics.com')
      || lower.includes('gtag(') || /\bua-\d+/i.test(lower) || /\bg-[a-z0-9]+/i.test(lower);
    result.has_gtm = lower.includes('googletagmanager.com') || lower.includes('gtm-');
    result.has_facebook_pixel = lower.includes('fbq(') || lower.includes('facebook.net/en_us/fbevents');

    // Important pages — look for links
    result.has_privacy_page = /href=["'][^"']*\/privac/i.test(html) || /href=["'][^"']*\/confidential/i.test(html);
    result.has_terms_page = /href=["'][^"']*\/terms/i.test(html) || /href=["'][^"']*\/tos/i.test(html);
    result.has_contact_page = /href=["'][^"']*\/contact/i.test(html);
    result.has_blog = /href=["'][^"']*\/blog/i.test(html) || /href=["'][^"']*\/news/i.test(html) || /href=["'][^"']*\/article/i.test(html);
  }

  /**
   * RDAP-based WHOIS lookup — replaces traditional WHOIS with the structured
   * RDAP protocol (RFC 7482). Extracts registrar, registration/expiry dates,
   * domain age, and WHOIS privacy status.
   *
   * Not in original spec — added to enrich domain intelligence for ban
   * correlation analysis (young domains and privacy-hidden registrations
   * correlate with higher Google Ads ban rates).
   */
  private async enrichRdap(domain: string, result: EnrichmentResult): Promise<void> {
    const tld = domain.split('.').pop()?.toLowerCase() ?? '';

    const rdapServers: Record<string, string> = {
      com: 'https://rdap.verisign.com/com/v1',
      net: 'https://rdap.verisign.com/net/v1',
      org: 'https://rdap.org/org/v1',
      io: 'https://rdap.nic.io',
      co: 'https://rdap.nic.co',
      me: 'https://rdap.nic.me',
      info: 'https://rdap.afilias.net/rdap/info/v1',
      biz: 'https://rdap.afilias.net/rdap/biz/v1',
      xyz: 'https://rdap.nic.xyz',
    };

    let serverUrl = rdapServers[tld] ?? null;

    // Fallback: IANA bootstrap to discover RDAP server for unknown TLDs
    if (!serverUrl) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch('https://data.iana.org/rdap/dns.json', { signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) {
          const data = (await res.json()) as { services: [string[], string[]][] };
          for (const [tlds, urls] of data.services) {
            if (tlds.includes(tld) && urls[0]) {
              serverUrl = urls[0].replace(/\/+$/, '');
              break;
            }
          }
        }
      } catch { /* bootstrap unreachable */ }
    }

    if (!serverUrl) {
      console.warn(`[enrichRdap] No RDAP server found for TLD "${tld}" (domain: ${domain})`);
      return;
    }

    const rdapUrl = `${serverUrl}/domain/${domain}`;
    console.log(`[enrichRdap] Querying: ${rdapUrl}`);

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(rdapUrl, {
        headers: { Accept: 'application/rdap+json' },
        signal: ctrl.signal,
      });
      clearTimeout(t);

      console.log(`[enrichRdap] ${domain}: HTTP ${res.status} ${res.statusText}`);

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn(`[enrichRdap] ${domain}: Non-OK response, body: ${body.slice(0, 500)}`);
        return;
      }

      const data = (await res.json()) as Record<string, unknown>;
      console.log(`[enrichRdap] ${domain}: Got RDAP data, keys: ${Object.keys(data).join(', ')}`);

      // Registrar entity
      const entities = (data['entities'] ?? []) as Array<Record<string, unknown>>;
      const registrarEntity = entities.find(
        (e) => Array.isArray(e['roles']) && (e['roles'] as string[]).includes('registrar'),
      );
      if (registrarEntity) {
        const vcard = registrarEntity['vcardArray'] as [string, Array<[string, unknown, string, string]>] | undefined;
        const fnEntry = vcard?.[1]?.find((v) => v[0] === 'fn');
        result.registrar = fnEntry?.[3] ?? (registrarEntity['handle'] as string) ?? null;
      }

      // Dates from events
      const events = (data['events'] ?? []) as Array<{ eventAction: string; eventDate: string }>;
      const regEvent = events.find((e) => e.eventAction === 'registration');
      const expEvent = events.find((e) => e.eventAction === 'expiration');

      if (regEvent?.eventDate) {
        const d = new Date(regEvent.eventDate);
        if (!isNaN(d.getTime())) {
          result.created_date = d.toISOString().slice(0, 10);
          result.domain_age_days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
        }
      }
      if (expEvent?.eventDate) {
        const d = new Date(expEvent.eventDate);
        if (!isNaN(d.getTime())) result.expires_date = d.toISOString().slice(0, 10);
      }

      // WHOIS privacy detection from registrant entity
      const registrantEntity = entities.find(
        (e) => Array.isArray(e['roles']) && (e['roles'] as string[]).includes('registrant'),
      );
      const regVcard = registrantEntity?.['vcardArray'] as [string, Array<[string, unknown, string, string]>] | undefined;
      const regName = regVcard?.[1]?.find((v) => v[0] === 'fn')?.[3] ?? '';
      result.whois_privacy = /redacted|private|proxy|withheld|privacy|protect|guard|domains by proxy/i.test(regName) || !regName;

      console.log(`[enrichRdap] ${domain}: registrar=${result.registrar}, created=${result.created_date}, expires=${result.expires_date}, age=${result.domain_age_days}d, privacy=${result.whois_privacy}`);
    } catch (err) {
      console.error(`[enrichRdap] ${domain}: RDAP fetch failed:`, err instanceof Error ? err.message : err);
    }
  }

  /** Calculate Safe Page Quality Score 0-100. */
  private calculateScore(r: EnrichmentResult): number {
    let score = 0;

    // Domain age (from RDAP)
    if (r.domain_age_days != null && r.domain_age_days > 30) score += 15;
    if (r.domain_age_days != null && r.domain_age_days > 180) score += 10;
    if (r.domain_age_days != null && r.domain_age_days > 365) score += 5;
    // Open WHOIS (no privacy) is a legitimacy signal
    if (r.whois_privacy === false) score += 5;
    if (r.ssl_type && r.ssl_type !== 'none') score += 10;
    if (r.ssl_type === 'paid') score += 5;
    if (r.has_cloudflare === false) score += 5;
    if (r.page_word_count != null && r.page_word_count > 300) score += 10;
    if (r.page_word_count != null && r.page_word_count > 1000) score += 5;
    if (r.has_privacy_page) score += 10;
    if (r.has_terms_page) score += 5;
    if (r.has_contact_page) score += 5;
    if (r.has_blog) score += 10;
    if (r.has_google_analytics || r.has_gtm) score += 5;
    if (r.meta_title && r.meta_description) score += 5;

    return Math.min(score, 100);
  }

  /** Save enrichment results to DB. */
  private async saveDomainData(domain: string, data: EnrichmentResult): Promise<void> {
    await this.pool.query(
      `UPDATE domains SET
         registrar = COALESCE($2, registrar),
         created_date = COALESCE($3::date, created_date),
         expires_date = COALESCE($4::date, expires_date),
         domain_age_days = COALESCE($5, domain_age_days),
         whois_privacy = COALESCE($6, whois_privacy),
         hosting_ip = COALESCE($7, hosting_ip),
         asn = COALESCE($8, asn),
         hosting_provider = COALESCE($9, hosting_provider),
         hosting_country = COALESCE($10, hosting_country),
         nameservers = COALESCE($11::jsonb, nameservers),
         has_cloudflare = COALESCE($12, has_cloudflare),
         dns_provider = COALESCE($13::dns_provider, dns_provider),
         ssl_type = COALESCE($14::ssl_type, ssl_type),
         ssl_issuer = COALESCE($15, ssl_issuer),
         ssl_expires = COALESCE($16::date, ssl_expires),
         http_status = COALESCE($17, http_status),
         site_status = COALESCE($18, site_status),
         meta_title = COALESCE($19, meta_title),
         meta_description = COALESCE($20, meta_description),
         page_word_count = COALESCE($21, page_word_count),
         has_google_analytics = COALESCE($22, has_google_analytics),
         has_gtm = COALESCE($23, has_gtm),
         has_facebook_pixel = COALESCE($24, has_facebook_pixel),
         has_privacy_page = COALESCE($25, has_privacy_page),
         has_terms_page = COALESCE($26, has_terms_page),
         has_contact_page = COALESCE($27, has_contact_page),
         has_blog = COALESCE($28, has_blog),
         pagespeed_score = COALESCE($29, pagespeed_score),
         content_quality_score = COALESCE($30, content_quality_score),
         safe_page_quality_score = $31,
         last_checked_at = NOW()
       WHERE domain_name = $1`,
      [
        domain,
        data.registrar,
        data.created_date,
        data.expires_date,
        data.domain_age_days,
        data.whois_privacy,
        data.hosting_ip,
        data.asn,
        data.hosting_provider,
        data.hosting_country,
        data.nameservers ? JSON.stringify(data.nameservers) : null,
        data.has_cloudflare,
        data.dns_provider,
        data.ssl_type,
        data.ssl_issuer,
        data.ssl_expires,
        data.http_status,
        data.site_status,
        data.meta_title,
        data.meta_description,
        data.page_word_count,
        data.has_google_analytics,
        data.has_gtm,
        data.has_facebook_pixel,
        data.has_privacy_page,
        data.has_terms_page,
        data.has_contact_page,
        data.has_blog,
        null, // pagespeed_score — would need PageSpeed API
        null, // content_quality_score — derived later
        data.safe_page_quality_score,
      ],
    );
  }
}

// --- Standalone helpers for automation ---

/**
 * Upsert a domain and trigger async enrichment if it's new.
 * Called from parsers when they discover a URL in final_urls.
 * Non-blocking: enrichment runs in background, errors are logged.
 */
export function upsertDomainAndEnrich(pool: pg.Pool, url: string): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }
  if (!hostname || hostname.includes('localhost') || hostname.includes('google.com')) return;

  pool.query(
    `INSERT INTO domains (domain_name) VALUES ($1) ON CONFLICT (domain_name) DO NOTHING RETURNING id`,
    [hostname],
  ).then(async (result) => {
    if (!result.rowCount || result.rowCount === 0) return;

    const domainId = result.rows[0]?.id as string | undefined;
    console.log(`[auto-enrich] New domain discovered: ${hostname}, running full check pipeline`);

    // Small delay to not block the request that triggered discovery
    await sleep(2000);

    const service = new DomainEnrichmentService(pool);

    // Step 1: Basic enrichment (DNS, SSL, HTTP, RDAP, Safe Page Score)
    try {
      const data = await service.enrichDomain(hostname);
      await service['saveDomainData'](hostname, data);
      console.log(`[auto-enrich] Basic enrichment done: ${hostname} (score=${data.safe_page_quality_score})`);
    } catch (err) {
      console.error(`[auto-enrich] Basic enrichment failed for ${hostname}:`, err instanceof Error ? err.message : err);
      await pool.query(
        `UPDATE domains SET last_checked_at = NOW(), site_status = 'error' WHERE domain_name = $1`,
        [hostname],
      ).catch(() => {});
      return; // No point continuing if we can't reach the site
    }

    // Step 2: Cloaking check
    try {
      if (await needsCloakingCheck(pool, hostname)) {
        const cloakingResult = await analyzeCloaking(hostname);
        await saveCloakingAnalysis(pool, hostname, cloakingResult);
        console.log(`[auto-enrich] Cloaking check done: ${hostname} (cloaked=${cloakingResult.is_cloaked})`);
      }
    } catch (err) {
      console.warn(`[auto-enrich] Cloaking check failed for ${hostname}:`, err instanceof Error ? err.message : err);
    }

    // Step 3: Content analysis (AI-powered page scan)
    try {
      const id = domainId ?? await pool.query(
        `SELECT id FROM domains WHERE domain_name = $1`,
        [hostname],
      ).then(r => r.rows[0]?.id as string | undefined);

      if (id) {
        await analyzeAndSave(pool, id, `https://${hostname}`);
        console.log(`[auto-enrich] Content analysis done: ${hostname}`);
      }
    } catch (err) {
      console.warn(`[auto-enrich] Content analysis failed for ${hostname}:`, err instanceof Error ? err.message : err);
    }
  }).catch((err) => {
    console.error(`[auto-enrich] Domain upsert failed for ${hostname}:`, err instanceof Error ? err.message : err);
  });
}

/**
 * Run full domain collection + enrichment cycle.
 * Designed to be called from cron / startup.
 */
export async function runDomainEnrichmentCycle(pool: pg.Pool): Promise<{ collected: number; enriched: number; errors: number }> {
  const service = new DomainEnrichmentService(pool);
  const domains = await service.collectDomains();
  const result = await service.enrichAll(true);
  return { collected: domains.length, ...result };
}
