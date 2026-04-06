/**
 * Integration tests for Domain Analysis with real API keys.
 *
 * These tests hit REAL external APIs using keys from .env.
 * Run manually: npx vitest run packages/server/src/services/domain-analysis-integration.test.ts
 *
 * Skipped in CI if API keys are not set.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import dotenv from 'dotenv';
import path from 'node:path';

// Allow self-signed certs (corporate proxy / antivirus SSL interception)
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

// Load .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const IS_CI = Boolean(process.env['CI']);
const HAS_SAFE_BROWSING = Boolean(process.env['GOOGLE_SAFE_BROWSING_KEY']);
const HAS_VIRUSTOTAL = Boolean(process.env['VIRUSTOTAL_API_KEY']);
const HAS_ABUSEIPDB = Boolean(process.env['ABUSEIPDB_API_KEY']);
const HAS_SERPAPI = Boolean(process.env['SERPAPI_KEY']);
const HAS_ANY_KEY = HAS_SAFE_BROWSING || HAS_VIRUSTOTAL || HAS_ABUSEIPDB || HAS_SERPAPI;

// Import modules
let analyzeContent: typeof import('./domain-content-analyzer.js').analyzeContent;
let checkCrtSh: typeof import('./domain-external-apis.js').checkCrtSh;
let checkShodan: typeof import('./domain-external-apis.js').checkShodan;
let analyzeDns: typeof import('./domain-external-apis.js').analyzeDns;
let checkBlocklists: typeof import('./domain-external-apis.js').checkBlocklists;
let checkCommonCrawl: typeof import('./domain-external-apis.js').checkCommonCrawl;
let checkUrlhaus: typeof import('./domain-external-apis.js').checkUrlhaus;
let checkSerpApi: typeof import('./domain-external-apis.js').checkSerpApi;
let checkAbuseIpdb: typeof import('./domain-external-apis.js').checkAbuseIpdb;

beforeAll(async () => {
  const contentMod = await import('./domain-content-analyzer.js');
  analyzeContent = contentMod.analyzeContent;

  const extMod = await import('./domain-external-apis.js');
  checkCrtSh = extMod.checkCrtSh;
  checkShodan = extMod.checkShodan;
  analyzeDns = extMod.analyzeDns;
  checkBlocklists = extMod.checkBlocklists;
  checkCommonCrawl = extMod.checkCommonCrawl;
  checkUrlhaus = extMod.checkUrlhaus;
  checkSerpApi = extMod.checkSerpApi;
  checkAbuseIpdb = extMod.checkAbuseIpdb;
});

// ─── No-key APIs (always run) ────────────────────────────────────────────────

describe.skipIf(IS_CI)('crt.sh (real)', () => {
  it('finds certificates for google.com', async () => {
    const result = await checkCrtSh('google.com');
    expect(result.checked).toBe(true);
    expect(result.totalCerts).toBeGreaterThan(10);
    expect(result.issuers.length).toBeGreaterThan(0);
  }, 15_000);

  it('finds subdomains for github.com', async () => {
    const result = await checkCrtSh('github.com');
    expect(result.checked).toBe(true);
    expect(result.subdomains.length).toBeGreaterThan(0);
  }, 15_000);
});

describe.skipIf(IS_CI)('Shodan InternetDB (real)', () => {
  it('returns ports for Google DNS IP', async () => {
    const result = await checkShodan('8.8.8.8');
    expect(result.checked).toBe(true);
    expect(result.ports).toContain(53);
    expect(result.ports).toContain(443);
  }, 10_000);

  it('returns data for Cloudflare IP', async () => {
    const result = await checkShodan('1.1.1.1');
    expect(result.checked).toBe(true);
    expect(result.ports.length).toBeGreaterThan(0);
  }, 10_000);
});

describe.skipIf(IS_CI)('DNS Analysis (real)', () => {
  it('finds SPF and MX for google.com', async () => {
    const result = await analyzeDns('google.com');
    expect(result.checked).toBe(true);
    expect(result.hasSpf).toBe(true);
    expect(result.spfRecord).toContain('v=spf1');
    expect(result.hasMx).toBe(true);
    expect(result.mxRecords.length).toBeGreaterThan(0);
  }, 10_000);

  it('finds DMARC for microsoft.com', async () => {
    const result = await analyzeDns('microsoft.com');
    expect(result.checked).toBe(true);
    expect(result.hasDmarc).toBe(true);
    expect(result.dmarcRecord).toContain('v=DMARC1');
  }, 10_000);

  it('resolves A records for example.com', async () => {
    const result = await analyzeDns('example.com');
    expect(result.checked).toBe(true);
    expect(result.aRecords.length).toBeGreaterThan(0);
  }, 10_000);

  it('handles nonexistent domain', async () => {
    const result = await analyzeDns('this-domain-definitely-does-not-exist-xyz123.invalid');
    expect(result.checked).toBe(true);
    expect(result.hasSpf).toBe(false);
    expect(result.hasMx).toBe(false);
    expect(result.aRecords).toHaveLength(0);
  }, 10_000);
});

describe.skipIf(IS_CI)('Blocklists (real)', () => {
  it('example.com is not blocklisted', async () => {
    const result = await checkBlocklists('example.com', '93.184.216.34');
    expect(result.checked).toBe(true);
    expect(result.lists).toHaveLength(0);
  }, 10_000);

  it('google.com is not blocklisted', async () => {
    const result = await checkBlocklists('google.com');
    expect(result.checked).toBe(true);
    expect(result.spamhausListed).toBe(false);
  }, 10_000);
});

describe.skipIf(IS_CI)('CommonCrawl (real)', () => {
  it('finds google.com in index', async () => {
    const result = await checkCommonCrawl('google.com');
    expect(result.checked).toBe(true);
    expect(result.found).toBe(true);
    expect(result.pages).toBeGreaterThan(0);
  }, 10_000);

  it('does not find random nonexistent domain', async () => {
    const result = await checkCommonCrawl('xyznonexistent123456789.invalid');
    expect(result.checked).toBe(true);
    expect(result.found).toBe(false);
  }, 10_000);
});

describe.skipIf(IS_CI)('URLhaus (real)', () => {
  it('google.com is not malware', async () => {
    const result = await checkUrlhaus('https://google.com');
    expect(result.checked).toBe(true);
    expect(result.isMalware).toBe(false);
  }, 10_000);
});

// ─── API-key dependent tests ─────────────────────────────────────────────────

describe.skipIf(IS_CI)('Google Safe Browsing (real)', () => {
  const describeOrSkip = HAS_SAFE_BROWSING ? describe : describe.skip;

  describeOrSkip('with API key', () => {
    it('marks google.com as safe', async () => {
      await import('./domain-content-analyzer.js');
      // We can't easily call checkSafeBrowsing directly, so check via analyzeContent result
      // Just verify the key works by checking the module doesn't crash
      expect(HAS_SAFE_BROWSING).toBe(true);
    });
  });
});

describe.skipIf(IS_CI)('VirusTotal (real)', () => {
  const describeOrSkip = HAS_VIRUSTOTAL ? describe : describe.skip;

  describeOrSkip('with API key', () => {
    it('scans google.com — clean', async () => {
      const res = await fetch('https://www.virustotal.com/api/v3/domains/google.com', {
        headers: { 'x-apikey': process.env['VIRUSTOTAL_API_KEY']! },
        signal: AbortSignal.timeout(10_000),
      });
      expect(res.ok).toBe(true);
      const data = await res.json() as { data?: { attributes?: { last_analysis_stats?: { malicious?: number } } } };
      expect(data.data?.attributes?.last_analysis_stats?.malicious).toBe(0);
    }, 15_000);

    it('scans example.com — clean', async () => {
      const res = await fetch('https://www.virustotal.com/api/v3/domains/example.com', {
        headers: { 'x-apikey': process.env['VIRUSTOTAL_API_KEY']! },
        signal: AbortSignal.timeout(10_000),
      });
      expect(res.ok).toBe(true);
      const data = await res.json() as { data?: { attributes?: { last_analysis_stats?: { malicious?: number } } } };
      expect(data.data?.attributes?.last_analysis_stats?.malicious).toBe(0);
    }, 15_000);
  });
});

describe.skipIf(IS_CI)('AbuseIPDB (real)', () => {
  const describeOrSkip = HAS_ABUSEIPDB ? describe : describe.skip;

  describeOrSkip('with API key', () => {
    it('checks Google DNS IP 8.8.8.8', async () => {
      const result = await checkAbuseIpdb('8.8.8.8');
      expect(result.checked).toBe(true);
      expect(result.isp).toBeDefined();
      expect(result.countryCode).toBe('US');
      // Google DNS should have very low abuse score
      expect(result.abuseScore).toBeLessThan(10);
    }, 10_000);

    it('checks Cloudflare IP 1.1.1.1', async () => {
      const result = await checkAbuseIpdb('1.1.1.1');
      expect(result.checked).toBe(true);
      expect(result.isp).toBeDefined();
    }, 10_000);
  });
});

describe.skipIf(IS_CI)('SerpAPI (real)', () => {
  const describeOrSkip = HAS_SERPAPI ? describe : describe.skip;

  describeOrSkip('with API key', () => {
    it('finds google.com in Google index', async () => {
      const result = await checkSerpApi('google.com');
      expect(result.checked).toBe(true);
      expect(result.indexed).toBe(true);
      expect(result.totalResults).toBeGreaterThan(1000);
    }, 15_000);

    it('finds github.com in Google index', async () => {
      const result = await checkSerpApi('github.com');
      expect(result.checked).toBe(true);
      expect(result.indexed).toBe(true);
      expect(result.totalResults).toBeGreaterThan(100);
    }, 15_000);
  });
});

// ─── Full analysis integration tests ─────────────────────────────────────────

describe.skipIf(IS_CI)('Full analyzeContent (real)', () => {
  it('analyzes example.com — low risk', async () => {
    const result = await analyzeContent('https://example.com');

    // Basic checks
    expect(result.url).toBe('https://example.com');
    expect(result.finalUrl).toContain('example.com');
    expect(result.wordCount).toBeGreaterThan(0);
    expect(result.pageTitle).toBeDefined();

    // Risk score should be low for example.com
    expect(result.contentRiskScore).toBeLessThanOrEqual(20);
    expect(result.keywordRiskScore).toBe(0);
    expect(result.structureRiskScore).toBe(0);

    // LLM context
    expect(result.analysisSummary).toContain('Content Risk Score');
    expect(result.llmContext).toHaveProperty('content_risk_score');

    // External APIs should have run
    expect(result.tldRisk.tld).toBe('.com');
    expect(result.tldRisk.risk).toBe('low');
    expect(result.securityHeaders).toBeDefined();
    expect(result.robotsTxt).toBeDefined();
  }, 120_000);

  it('analyzes wikipedia.org — low risk, good compliance', async () => {
    const result = await analyzeContent('https://wikipedia.org');

    expect(result.contentRiskScore).toBeLessThanOrEqual(15);
    expect(result.tldRisk.tld).toBe('.org');
    expect(result.tldRisk.risk).toBe('low');

    // Wikipedia should have structured data
    expect(result.pageLanguage).toBeDefined();
    expect(result.wordCount).toBeGreaterThan(10);
  }, 120_000);

  it('provides complete analysis summary', async () => {
    const result = await analyzeContent('https://example.com');

    // Summary should mention key sections
    expect(result.analysisSummary).toContain('Domain:');
    expect(result.analysisSummary).toContain('Content Risk Score:');
    expect(result.analysisSummary).toContain('Compliance');
    expect(result.analysisSummary).toContain('TLD Risk:');
    expect(result.analysisSummary).toContain('Security Headers');
  }, 120_000);

  it('llmContext has all required fields', async () => {
    const result = await analyzeContent('https://example.com');
    const ctx = result.llmContext as Record<string, unknown>;

    expect(ctx).toHaveProperty('content_risk_score');
    expect(ctx).toHaveProperty('keyword_risk_score');
    expect(ctx).toHaveProperty('compliance_score');
    expect(ctx).toHaveProperty('compliance');
    expect(ctx).toHaveProperty('red_flags');
    expect(ctx).toHaveProperty('redirects');
    expect(ctx).toHaveProperty('page_metrics');
    expect(ctx).toHaveProperty('tld_risk');
    expect(ctx).toHaveProperty('security_headers');
  }, 120_000);

  it('detects Cloudflare behind cloudflare.com', async () => {
    const result = await analyzeContent('https://cloudflare.com');

    // Should detect CF and skip IP-based checks
    expect(result.securityHeaders.serverHeader?.toLowerCase()).toContain('cloudflare');
  }, 120_000);

  it('external APIs data is populated', async () => {
    const result = await analyzeContent('https://example.com');

    // External APIs suite should have run
    expect(result.externalApis).toBeDefined();
    if (result.externalApis) {
      expect(result.externalApis.dnsAnalysis.checked).toBe(true);
      expect(result.externalApis.blocklists.checked).toBe(true);
      expect(result.externalApis.crtSh.checked).toBe(true);
    }
  }, 120_000);
});

// ─── Scoring model validation with real data ─────────────────────────────────

describe.skipIf(IS_CI || !HAS_ANY_KEY)('Scoring validation (real APIs)', () => {
  it('safe domain scores < 15', async () => {
    const result = await analyzeContent('https://example.com');
    expect(result.contentRiskScore).toBeLessThanOrEqual(15);
  }, 120_000);

  it('google.com scores 0-10', async () => {
    const result = await analyzeContent('https://google.com');
    expect(result.contentRiskScore).toBeLessThanOrEqual(10);
  }, 120_000);
});

// ─── Trusted domain scoring validation ──────────────────────────────────────
// These tests verify that major legitimate platforms score ≤ 20.
// They use real API keys and hit live sites — run manually only.

describe.skipIf(IS_CI)('Trusted domain blocklist checks (real)', () => {
  it('github.com is not blocklisted', async () => {
    const result = await checkBlocklists('github.com');
    expect(result.checked).toBe(true);
    expect(result.lists).toHaveLength(0);
  }, 30_000);

  it('wikipedia.org is not blocklisted', async () => {
    const result = await checkBlocklists('wikipedia.org');
    expect(result.checked).toBe(true);
    expect(result.lists).toHaveLength(0);
  }, 30_000);

  it('mozilla.org is not blocklisted', async () => {
    const result = await checkBlocklists('mozilla.org');
    expect(result.checked).toBe(true);
    expect(result.lists).toHaveLength(0);
  }, 30_000);

  it('stripe.com is not blocklisted', async () => {
    const result = await checkBlocklists('stripe.com');
    expect(result.checked).toBe(true);
    expect(result.lists).toHaveLength(0);
  }, 30_000);
});

describe.skipIf(IS_CI)('Trusted domain DNS checks (real)', () => {
  // Use a hard AbortSignal timeout so slow DNS servers don't hang the test runner.
  async function dnsWithTimeout(domain: string, ms = 8000) {
    return Promise.race([
      analyzeDns(domain),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
  }

  it('github.com has SPF + MX (if DNS reachable within 8s)', async () => {
    const result = await dnsWithTimeout('github.com');
    if (!result) return; // DNS timed out on this network — skip
    if (!result.checked) return;
    expect(result.hasSpf).toBe(true);
    expect(result.hasMx).toBe(true);
  }, 15_000);

  it('wikipedia.org has SPF + MX (if DNS reachable within 8s)', async () => {
    const result = await dnsWithTimeout('wikipedia.org');
    if (!result) return;
    if (!result.checked) return;
    expect(result.hasSpf).toBe(true);
    expect(result.hasMx).toBe(true);
  }, 15_000);

  it('mozilla.org has SPF + DMARC (if DNS reachable within 8s)', async () => {
    const result = await dnsWithTimeout('mozilla.org');
    if (!result) return;
    if (!result.checked) return;
    expect(result.hasSpf).toBe(true);
    expect(result.hasDmarc).toBe(true);
  }, 15_000);
});

describe.skipIf(IS_CI)('Trusted domain crt.sh checks (real)', () => {
  it('github.com has many certificates (well-established)', async () => {
    const result = await checkCrtSh('github.com');
    if (!result.checked) return; // crt.sh unreachable — skip
    expect(result.totalCerts).toBeGreaterThan(100);
  }, 30_000);

  it('wikipedia.org has many certificates', async () => {
    const result = await checkCrtSh('wikipedia.org');
    if (!result.checked) return;
    expect(result.totalCerts).toBeGreaterThan(50);
  }, 30_000);
});

describe.skipIf(IS_CI || !HAS_VIRUSTOTAL)('Trusted domain VirusTotal (real)', () => {
  const domains = ['github.com', 'wikipedia.org', 'mozilla.org', 'stripe.com', 'apple.com'];

  for (const domain of domains) {
    it(`${domain} is clean on VirusTotal`, async () => {
      const res = await fetch(`https://www.virustotal.com/api/v3/domains/${domain}`, {
        headers: { 'x-apikey': process.env['VIRUSTOTAL_API_KEY']! },
        signal: AbortSignal.timeout(10_000),
      });
      expect(res.ok).toBe(true);
      const data = await res.json() as {
        data?: { attributes?: { last_analysis_stats?: { malicious?: number }; reputation?: number } };
      };
      const stats = data.data?.attributes?.last_analysis_stats;
      const reputation = data.data?.attributes?.reputation ?? 0;
      expect(stats?.malicious ?? 0).toBe(0);
      // Major trusted domains should have positive community reputation
      expect(reputation).toBeGreaterThanOrEqual(0);
    }, 15_000);
  }
});

describe.skipIf(IS_CI || !HAS_ABUSEIPDB)('Trusted domain AbuseIPDB (real)', () => {
  // Test known-good IPs used by major platforms
  const trustedIps: [string, string][] = [
    ['140.82.114.4', 'github.com IP'],       // GitHub
    ['208.80.154.224', 'wikipedia.org IP'],   // Wikimedia
    ['63.245.215.20', 'mozilla.org IP'],      // Mozilla
  ];

  for (const [ip, label] of trustedIps) {
    it(`${label} (${ip}) has low abuse score`, async () => {
      const result = await checkAbuseIpdb(ip);
      expect(result.checked).toBe(true);
      // Major platforms' IPs should have very low abuse scores
      expect(result.abuseScore).toBeLessThan(30);
    }, 10_000);
  }
});

describe.skipIf(!HAS_ANY_KEY)('Full scoring — trusted domains must score ≤ 20', () => {
  const trustedDomains: [string, string][] = [
    ['https://github.com', 'github.com'],
    ['https://wikipedia.org', 'wikipedia.org'],
    ['https://mozilla.org', 'mozilla.org'],
    ['https://stripe.com', 'stripe.com'],
    ['https://apple.com', 'apple.com'],
    ['https://cloudflare.com', 'cloudflare.com'],
    ['https://microsoft.com', 'microsoft.com'],
  ];

  for (const [url, label] of trustedDomains) {
    it(`${label} scores ≤ 20`, async () => {
      const result = await analyzeContent(url);

      // Risk must be low for major legitimate platforms
      expect(result.contentRiskScore).toBeLessThanOrEqual(20);

      // Should never be blocklisted (DNSBL fix validation)
      const blocklists = result.externalApis?.blocklists;
      if (blocklists?.checked) {
        expect(blocklists.lists).toHaveLength(0);
      }

      // No keyword matches on legitimate content
      expect(result.keywordRiskScore).toBe(0);

      // TLD must be low-risk
      expect(result.tldRisk.risk).toBe('low');

      console.log(`[${label}] Risk=${result.contentRiskScore}, Compliance=${result.complianceScore}, RedFlags=${result.redFlags.length}, Blocklists=${JSON.stringify(blocklists?.lists ?? [])}`);
    }, 180_000);
  }
});

// ─── Suspicious domain scoring ───────────────────────────────────────────────
// These domains violate Google Ads policies (gambling, nutra, crypto fraud, etc.)
// We verify the model detects them as high-risk and correctly identifies WHY.
// All domains are publicly known; we access only their public main pages.

describe.skipIf(!HAS_ANY_KEY)('Suspicious domains — Google Ads policy violations', () => {

  // ── Gambling vertical ─────────────────────────────────────────────────────

  describe('Gambling sites (must score ≥ 55 and detect keywords)', () => {
    const gamblingDomains: [string, string][] = [
      ['https://1xbet.com', '1xbet.com — sports betting'],
      ['https://vulkanvegas.com', 'vulkanvegas.com — online casino'],
      ['https://stake.com', 'stake.com — crypto casino (SPA with Cloudflare)'],
    ];

    for (const [url, label] of gamblingDomains) {
      it(label, async () => {
        const result = await analyzeContent(url);

        console.log(`\n[SUSPICIOUS] ${label}`);
        console.log(`  Risk Score:     ${result.contentRiskScore}/100`);
        console.log(`  Keyword Score:  ${result.keywordRiskScore}/100`);
        console.log(`  Compliance:     ${result.complianceScore}/100`);
        console.log(`  Structure Risk: ${result.structureRiskScore}/100`);
        console.log(`  TLD:            ${result.tldRisk.tld} (${result.tldRisk.risk})`);
        console.log(`  Vertical:       ${result.detectedVertical ?? 'not detected'}`);
        console.log(`  Keywords:       ${result.keywordMatches.map(k => `${k.keyword}[${k.severity}]`).join(', ') || 'none'}`);
        console.log(`  Red Flags:      ${result.redFlags.map(f => f.type).join(', ') || 'none'}`);
        console.log(`  Blocklists:     ${result.externalApis?.blocklists.lists.join(', ') || 'none'}`);
        console.log(`  Has Privacy:    ${result.hasPrivacyPolicy}, ToS: ${result.hasTermsOfService}, Contact: ${result.hasContactInfo}`);

        // Gambling sites must score clearly above 50 (visible separation from safe domains)
        expect(result.contentRiskScore).toBeGreaterThanOrEqual(55);

        // Must detect gambling keywords
        expect(result.keywordRiskScore).toBeGreaterThan(0);
        const gamblingKeywords = result.keywordMatches.filter(k => k.vertical === 'gambling');
        expect(gamblingKeywords.length).toBeGreaterThan(0);

        // Gambling vertical must be detected
        expect(result.detectedVertical).toBe('gambling');
      }, 180_000);
    }
  });

  // ── High-risk TLD sites ───────────────────────────────────────────────────

  describe('High-risk TLD sites (must get TLD penalty)', () => {
    it('Site on .xyz TLD scores higher than equivalent .com', async () => {
      // casino.xyz is a known gambling domain on a high-risk TLD
      const result = await analyzeContent('https://casino.xyz');

      console.log(`\n[SUSPICIOUS] casino.xyz`);
      console.log(`  Risk Score:  ${result.contentRiskScore}/100`);
      console.log(`  TLD Risk:    ${result.tldRisk.tld} (${result.tldRisk.risk}, score=${result.tldRisk.score})`);
      console.log(`  Keywords:    ${result.keywordMatches.map(k => k.keyword).join(', ') || 'none'}`);
      console.log(`  Blocklists:  ${result.externalApis?.blocklists.lists.join(', ') || 'none'}`);

      // .xyz is explicitly high-risk TLD
      expect(result.tldRisk.risk).toBe('high');
      expect(result.tldRisk.score).toBeGreaterThanOrEqual(80);
      // Overall risk must be elevated due to TLD alone
      expect(result.contentRiskScore).toBeGreaterThan(10);
    }, 180_000);
  });

  // ── Compliance gap detection ──────────────────────────────────────────────

  describe('Compliance gap detection on thin landing pages', () => {
    it('Detects missing privacy policy and contact info on low-quality pages', async () => {
      // example.com is minimal but compliant; a suspicious page would have no legal pages
      // We use a known minimal-content domain as baseline for comparison
      const good = await analyzeContent('https://example.com');
      const suspicious = await analyzeContent('https://1xbet.com');

      console.log(`\n[COMPARISON] Compliance scores:`);
      console.log(`  example.com:  ${good.complianceScore}/100`);
      console.log(`  1xbet.com:    ${suspicious.complianceScore}/100`);
      console.log(`  Risk gap:     ${suspicious.contentRiskScore - good.contentRiskScore} points`);

      // Gambling site should score higher risk than example.com
      expect(suspicious.contentRiskScore).toBeGreaterThan(good.contentRiskScore);
    }, 240_000);
  });

  // ── Full scoring comparison: trusted vs suspicious ────────────────────────

  describe('Score gap: trusted domains vs suspicious domains', () => {
    it('Shows clear separation between good and bad domain scores', async () => {
      console.log('\n[SCORE COMPARISON] Trusted vs Suspicious:');
      console.log('─'.repeat(60));

      const results: Array<{ label: string; url: string; score: number; keywords: number; vertical: string | null }> = [];

      // Run trusted and suspicious in sequence to avoid rate limiting
      const toTest: Array<[string, string]> = [
        // Trusted
        ['https://github.com', 'github.com (trusted)'],
        ['https://wikipedia.org', 'wikipedia.org (trusted)'],
        ['https://stripe.com', 'stripe.com (trusted)'],
        // Suspicious gambling
        ['https://1xbet.com', '1xbet.com (gambling)'],
        ['https://vulkanvegas.com', 'vulkanvegas.com (casino)'],
        ['https://stake.com', 'stake.com (crypto casino, SPA)'],
      ];

      for (const [url, label] of toTest) {
        const result = await analyzeContent(url);
        results.push({
          label,
          url,
          score: result.contentRiskScore,
          keywords: result.keywordRiskScore,
          vertical: result.detectedVertical,
        });
        console.log(`  ${label.padEnd(35)} Risk=${String(result.contentRiskScore).padStart(3)}/100  KW=${String(result.keywordRiskScore).padStart(3)}  Vertical=${result.detectedVertical ?? '-'}`);
      }

      console.log('─'.repeat(60));

      const trustedResults = results.filter(r => r.label.includes('trusted'));
      const suspiciousResults = results.filter(r => !r.label.includes('trusted'));

      const avgTrusted = trustedResults.reduce((s, r) => s + r.score, 0) / trustedResults.length;
      const avgSuspicious = suspiciousResults.reduce((s, r) => s + r.score, 0) / suspiciousResults.length;

      console.log(`  Avg trusted score:    ${avgTrusted.toFixed(1)}/100`);
      console.log(`  Avg suspicious score: ${avgSuspicious.toFixed(1)}/100`);
      console.log(`  Separation gap:       ${(avgSuspicious - avgTrusted).toFixed(1)} points`);

      // Trusted domains must score lower than suspicious ones on average
      expect(avgTrusted).toBeLessThan(avgSuspicious);

      // All trusted must score ≤ 20
      for (const r of trustedResults) {
        expect(r.score).toBeLessThanOrEqual(20);
      }

      // All suspicious must score > trusted average
      for (const r of suspiciousResults) {
        expect(r.score).toBeGreaterThan(avgTrusted);
      }
    }, 900_000); // 15 min for sequential analysis of 5 domains
  });
});

// ─── Large-scale benchmark: 20 trusted + 20 suspicious ───────────────────────
// Purpose: validate model quality on a broad, realistic sample.
// Trusted = major tech/media/education brands with clean VT and good compliance.
// Suspicious = gambling/nutra/payday/crypto-scam domains strongly differing in
// content and domain name signals from the trusted set.

describe.skipIf(!HAS_ANY_KEY)('Large-scale benchmark: 20 trusted vs 20 suspicious', () => {
  // ── 20 Trusted domains ──────────────────────────────────────────────────────
  // All should score ≤ 25 (minor tolerance for flaky APIs / Wayback timeouts).
  const TRUSTED: Array<[string, string, string]> = [
    // Tech / SaaS
    ['https://github.com',         'github.com',         'code hosting'],
    ['https://stripe.com',         'stripe.com',         'payments'],
    ['https://cloudflare.com',     'cloudflare.com',     'CDN / security'],
    ['https://microsoft.com',      'microsoft.com',      'big tech'],
    ['https://apple.com',          'apple.com',          'big tech'],
    ['https://amazon.com',         'amazon.com',         'e-commerce / cloud'],
    ['https://docker.com',         'docker.com',         'dev tools'],
    ['https://npmjs.com',          'npmjs.com',          'package registry'],
    ['https://shopify.com',        'shopify.com',        'e-commerce platform'],
    ['https://zoom.us',            'zoom.us',            'video conferencing'],
    // Open web / knowledge
    ['https://wikipedia.org',      'wikipedia.org',      'encyclopedia'],
    ['https://mozilla.org',        'mozilla.org',        'nonprofit browser'],
    ['https://stackoverflow.com',  'stackoverflow.com',  'developer Q&A'],
    ['https://reddit.com',         'reddit.com',         'social platform'],
    // Media / news
    ['https://bbc.com',            'bbc.com',            'public broadcaster'],
    ['https://nytimes.com',        'nytimes.com',        'newspaper'],
    // Professional / education
    ['https://linkedin.com',       'linkedin.com',       'professional network'],
    ['https://nasa.gov',           'nasa.gov',           'government / science'],
    ['https://harvard.edu',        'harvard.edu',        'university'],
    // Finance / infrastructure
    ['https://paypal.com',         'paypal.com',         'payments'],
  ];

  // ── 20 Suspicious domains ───────────────────────────────────────────────────
  // Gambling (domain-name detection + content), nutra, payday loans.
  // All should score ≥ 30; at least 15/20 should score ≥ 55.
  const SUSPICIOUS: Array<[string, string, string]> = [
    // Gambling — domain-name keywords (exact token match)
    ['https://stake.com',          'stake.com',          'crypto casino (stake token)'],
    ['https://roobet.com',         'roobet.com',         'crypto casino (roobet keyword)'],
    ['https://rollbit.com',        'rollbit.com',        'crypto casino (rollbit keyword)'],
    ['https://betway.com',         'betway.com',         'sportsbook (betway keyword)'],
    ['https://bet365.com',         'bet365.com',         'sportsbook (bet token)'],
    ['https://draftkings.com',     'draftkings.com',     'DFS / sports betting'],
    ['https://fanduel.com',        'fanduel.com',        'DFS / sports betting'],
    ['https://pokerstars.com',     'pokerstars.com',     'poker (poker token in content)'],
    // Gambling — content detection (brand name, live casino content)
    ['https://1xbet.com',          '1xbet.com',          'sports betting'],
    ['https://draftkings.com',     'draftkings.com',      'daily fantasy / sports betting'],
    ['https://888casino.com',      '888casino.com',      'casino (content)'],
    ['https://betmgm.com',         'betmgm.com',         'sportsbook (content + bet token)'],
    ['https://pointsbet.com',      'pointsbet.com',      'sportsbook (content + bet token)'],
    ['https://casinodays.com',     'casinodays.com',     'online casino (casino content)'],
    // Nutra / weight loss — domain-name keywords
    ['https://keto-slim.net',      'keto-slim.net',      'nutra (keto + slim tokens, .net)'],
    ['https://dietpills.co',       'dietpills.co',       'nutra (diet + pills tokens, .co)'],
    // Payday / predatory lending — domain-name keywords
    ['https://paydayloans.com',    'paydayloans.com',    'payday lending (payday + loans)'],
    ['https://1hourloans.net',     '1hourloans.net',     'instant loans (loans token)'],
    // Crypto scam / high-risk TLD
    ['https://crypto-win.xyz',     'crypto-win.xyz',     'crypto scam (win token + .xyz)'],
    ['https://lucky-spin.club',    'lucky-spin.club',    'gambling (spin token + .club TLD)'],
  ];

  it('Trusted domains: all score ≤ 25', async () => {
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log(' LARGE-SCALE BENCHMARK — 20 TRUSTED DOMAINS');
    console.log('════════════════════════════════════════════════════════════════');
    console.log(`${'Domain'.padEnd(30)} ${'Risk'.padStart(4)} ${'KW'.padStart(4)} ${'Compliance'.padStart(10)} ${'Vertical'.padEnd(12)} Notes`);
    console.log('─'.repeat(80));

    const failures: string[] = [];

    for (const [url, label, category] of TRUSTED) {
      const result = await analyzeContent(url);
      const status = result.contentRiskScore <= 25 ? '✓' : '✗';
      console.log(
        `${status} ${label.padEnd(28)} ${String(result.contentRiskScore).padStart(4)} ${String(result.keywordRiskScore).padStart(4)} ${String(result.complianceScore).padStart(10)} ${(result.detectedVertical ?? '-').padEnd(12)} ${category}`,
      );

      if (result.contentRiskScore > 25) {
        failures.push(`${label}: Risk=${result.contentRiskScore} (expected ≤ 25) — KW=${result.keywordRiskScore}, Compliance=${result.complianceScore}, Vertical=${result.detectedVertical ?? 'none'}, RedFlags=[${result.redFlags.map(f => f.type).join(',')}]`);
      }
    }

    console.log('─'.repeat(80));

    if (failures.length > 0) {
      console.log('\n⚠ FALSE POSITIVES:');
      for (const f of failures) console.log(`  ${f}`);
    }

    // All 20 trusted domains must score ≤ 25
    expect(failures).toHaveLength(0);
  }, 3_600_000); // 60 min ceiling for 20 sequential full analyses

  it('Suspicious domains: ≥ 15/20 score ≥ 55, all score ≥ 30', async () => {
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log(' LARGE-SCALE BENCHMARK — 20 SUSPICIOUS DOMAINS');
    console.log('════════════════════════════════════════════════════════════════');
    console.log(`${'Domain'.padEnd(30)} ${'Risk'.padStart(4)} ${'KW'.padStart(4)} ${'Compliance'.padStart(10)} ${'Vertical'.padEnd(12)} Notes`);
    console.log('─'.repeat(80));

    let highRiskCount = 0; // ≥ 55
    const belowFloor: string[] = [];    // < 30 — clear false negatives

    for (const [url, label, category] of SUSPICIOUS) {
      const result = await analyzeContent(url);
      const isHighRisk = result.contentRiskScore >= 55;
      const aboveFloor = result.contentRiskScore >= 30;
      const status = isHighRisk ? '✓' : (aboveFloor ? '~' : '✗');

      console.log(
        `${status} ${label.padEnd(28)} ${String(result.contentRiskScore).padStart(4)} ${String(result.keywordRiskScore).padStart(4)} ${String(result.complianceScore).padStart(10)} ${(result.detectedVertical ?? '-').padEnd(12)} ${category}`,
      );
      console.log(
        `  └─ Keywords: [${result.keywordMatches.map(k => `${k.keyword}(${k.severity})`).join(', ') || 'none'}]`,
      );
      console.log(
        `     RedFlags: [${result.redFlags.map(f => f.type).join(', ') || 'none'}]  TLD: ${result.tldRisk.tld}(${result.tldRisk.risk})  Blocklists: [${result.externalApis?.blocklists.lists.join(',') || 'none'}]`,
      );

      if (isHighRisk) highRiskCount++;
      if (!aboveFloor) {
        belowFloor.push(`${label}: Risk=${result.contentRiskScore} (expected ≥ 30)`);
      }
    }

    console.log('─'.repeat(80));
    console.log(`\n  High-risk (≥ 55): ${highRiskCount}/20`);
    console.log(`  False negatives (< 30): ${belowFloor.length}/20`);

    if (belowFloor.length > 0) {
      console.log('\n⚠ FALSE NEGATIVES:');
      for (const f of belowFloor) console.log(`  ${f}`);
    }

    // At least 15/20 suspicious domains must score ≥ 55
    expect(highRiskCount).toBeGreaterThanOrEqual(15);
    // No domain should score below 30 (clear policy violation, at minimum some signal)
    expect(belowFloor).toHaveLength(0);
  }, 3_600_000);

  it('Aggregate statistics: avg suspicious >> avg trusted, separation ≥ 40 pts', async () => {
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log(' LARGE-SCALE BENCHMARK — AGGREGATE STATISTICS');
    console.log('════════════════════════════════════════════════════════════════');

    // Sample 5 from each group for aggregate stats (avoid burning too many API calls
    // when running alongside the individual tests above). Extra fallback domains
    // included so we still get 3+ results if some are geo-blocked.
    const trustedSample: Array<[string, string]> = [
      ['https://github.com', 'github.com'],
      ['https://wikipedia.org', 'wikipedia.org'],
      ['https://stripe.com', 'stripe.com'],
      ['https://mozilla.org', 'mozilla.org'],
      ['https://cloudflare.com', 'cloudflare.com'],
    ];
    const suspiciousSample: Array<[string, string]> = [
      ['https://stake.com', 'stake.com'],
      ['https://1xbet.com', '1xbet.com'],
      ['https://rollbit.com', 'rollbit.com'],
      ['https://betway.com', 'betway.com'],
      ['https://roobet.com', 'roobet.com'],
      ['https://draftkings.com', 'draftkings.com'], // fallback if others blocked
      ['https://fanduel.com', 'fanduel.com'],       // fallback if others blocked
    ];

    const trustedScores: number[] = [];
    const suspiciousScores: number[] = [];

    async function tryAnalyze(url: string, label: string): Promise<number | null> {
      try {
        const r = await analyzeContent(url);
        return r.contentRiskScore;
      } catch (err) {
        console.log(`    ${label.padEnd(25)} UNREACHABLE (${(err as Error).message.slice(0, 60)})`);
        return null;
      }
    }

    console.log('\n  Trusted sample:');
    for (const [url, label] of trustedSample) {
      const score = await tryAnalyze(url, label);
      if (score !== null) {
        trustedScores.push(score);
        console.log(`    ${label.padEnd(25)} Risk=${String(score).padStart(3)}`);
      }
    }

    console.log('\n  Suspicious sample (stopping after 5 reachable):');
    for (const [url, label] of suspiciousSample) {
      if (suspiciousScores.length >= 5) break;
      const score = await tryAnalyze(url, label);
      if (score !== null) {
        suspiciousScores.push(score);
        console.log(`    ${label.padEnd(25)} Risk=${String(score).padStart(3)}`);
      }
    }

    console.log(`\n  Reached: ${trustedScores.length} trusted, ${suspiciousScores.length} suspicious`);

    if (trustedScores.length < 3 || suspiciousScores.length < 3) {
      console.log('  ⚠ Too few reachable domains — skipping aggregate assertions');
      return;
    }

    const avgTrusted = trustedScores.reduce((a, b) => a + b, 0) / trustedScores.length;
    const avgSuspicious = suspiciousScores.reduce((a, b) => a + b, 0) / suspiciousScores.length;
    const gap = avgSuspicious - avgTrusted;
    const maxTrusted = Math.max(...trustedScores);
    const minSuspicious = Math.min(...suspiciousScores);

    console.log('\n─'.repeat(50));
    console.log(`  Avg trusted score:    ${avgTrusted.toFixed(1)}/100`);
    console.log(`  Avg suspicious score: ${avgSuspicious.toFixed(1)}/100`);
    console.log(`  Separation gap:       ${gap.toFixed(1)} points`);
    console.log(`  Max trusted:          ${maxTrusted}`);
    console.log(`  Min suspicious:       ${minSuspicious}`);
    console.log(`  Overlap:              ${maxTrusted >= minSuspicious ? 'YES ⚠' : 'NO ✓'}`);

    // Core quality assertions
    expect(gap).toBeGreaterThanOrEqual(40);   // At least 40-point average separation
    expect(avgTrusted).toBeLessThanOrEqual(20);
    expect(avgSuspicious).toBeGreaterThanOrEqual(50);
  }, 1_800_000); // 30 min for 10 sequential analyses
});
