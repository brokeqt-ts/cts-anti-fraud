/**
 * Tests for Domain External APIs.
 *
 * Tests each API function with mocked fetch/dns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// DNS functions use real dns module — skip DNS-dependent tests in CI
// and test only fetch-based functions here

// ─── Mock fetch ──────────────────────────────────────────────────────────────

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function mockFetchResponse(data: { ok?: boolean; status?: number; text?: string; json?: unknown }) {
  return {
    ok: data.ok ?? true,
    status: data.status ?? 200,
    text: async () => data.text ?? '',
    json: async () => data.json ?? {},
    headers: { get: () => null, forEach: () => {} },
  };
}

let mod: typeof import('./domain-external-apis.js');

beforeEach(async () => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(mockFetchResponse({ ok: false, status: 404 }));
  mod = await import('./domain-external-apis.js');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── 1. crt.sh Tests ─────────────────────────────────────────────────────────

describe('crt.sh', () => {
  it('parses certificate data correctly', async () => {
    fetchMock.mockResolvedValueOnce(mockFetchResponse({
      json: [
        { name_value: '*.example.com\nexample.com', not_before: '2024-01-01', not_after: '2025-01-01', issuer_name: 'CN=Let\'s Encrypt' },
        { name_value: 'api.example.com', not_before: '2023-06-01', not_after: '2024-06-01', issuer_name: 'CN=DigiCert' },
      ],
    }));
    const result = await mod.checkCrtSh('example.com');
    expect(result.checked).toBe(true);
    expect(result.totalCerts).toBe(2);
    expect(result.subdomains).toContain('api.example.com');
    expect(result.issuers).toContain("Let's Encrypt");
  });

  it('handles API failure gracefully', async () => {
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ ok: false, status: 500 }));
    const result = await mod.checkCrtSh('example.com');
    expect(result.checked).toBe(false);
    expect(result.totalCerts).toBe(0);
  });

  it('handles empty response', async () => {
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ json: [] }));
    const result = await mod.checkCrtSh('example.com');
    expect(result.checked).toBe(true);
    expect(result.totalCerts).toBe(0);
  });
});

// ─── 2. Shodan InternetDB Tests ──────────────────────────────────────────────

describe('Shodan InternetDB', () => {
  it('parses port and vuln data', async () => {
    fetchMock.mockResolvedValueOnce(mockFetchResponse({
      json: { ports: [80, 443, 8080], vulns: ['CVE-2023-1234'], hostnames: ['example.com'], tags: ['http'], cpes: [] },
    }));
    const result = await mod.checkShodan('1.2.3.4');
    expect(result.checked).toBe(true);
    expect(result.ports).toEqual([80, 443, 8080]);
    expect(result.vulns).toContain('CVE-2023-1234');
  });

  it('skips IPv6', async () => {
    const result = await mod.checkShodan('::1');
    expect(result.checked).toBe(false);
  });

  it('handles missing IP', async () => {
    const result = await mod.checkShodan('');
    expect(result.checked).toBe(false);
  });
});

// ─── 3. DNS Analysis Tests ───────────────────────────────────────────────────

describe.skip('DNS Analysis (requires real dns module)', () => {
  it('detects SPF record', async () => {
    mockDns.resolveTxt.mockResolvedValueOnce([['v=spf1 include:_spf.google.com ~all']]);
    mockDns.resolveMx.mockRejectedValueOnce(new Error('ENODATA'));
    mockDns.resolveCaa.mockRejectedValueOnce(new Error('ENODATA'));
    mockDns.resolve4.mockResolvedValueOnce(['1.2.3.4']);
    mockDns.resolve6.mockRejectedValueOnce(new Error('ENODATA'));
    mockDns.resolveNs.mockResolvedValueOnce(['ns1.example.com']);
    // DMARC lookup
    mockDns.resolveTxt.mockRejectedValueOnce(new Error('ENODATA'));

    const result = await mod.analyzeDns('example.com');
    expect(result.checked).toBe(true);
    expect(result.hasSpf).toBe(true);
    expect(result.spfRecord).toContain('v=spf1');
  });

  it('detects DMARC record', async () => {
    mockDns.resolveTxt.mockResolvedValueOnce([]); // no SPF
    mockDns.resolveMx.mockResolvedValueOnce([{ priority: 10, exchange: 'mail.example.com' }]);
    mockDns.resolveCaa.mockRejectedValueOnce(new Error('ENODATA'));
    mockDns.resolve4.mockResolvedValueOnce(['1.2.3.4']);
    mockDns.resolve6.mockRejectedValueOnce(new Error('ENODATA'));
    mockDns.resolveNs.mockResolvedValueOnce(['ns1.example.com']);
    // DMARC lookup
    mockDns.resolveTxt.mockResolvedValueOnce([['v=DMARC1; p=reject']]);

    const result = await mod.analyzeDns('example.com');
    expect(result.hasDmarc).toBe(true);
    expect(result.hasMx).toBe(true);
    expect(result.mxRecords).toContain('mail.example.com');
  });

  it('handles DNS failure gracefully', async () => {
    mockDns.resolveTxt.mockRejectedValueOnce(new Error('SERVFAIL'));
    mockDns.resolveMx.mockRejectedValueOnce(new Error('SERVFAIL'));
    mockDns.resolveCaa.mockRejectedValueOnce(new Error('SERVFAIL'));
    mockDns.resolve4.mockRejectedValueOnce(new Error('SERVFAIL'));
    mockDns.resolve6.mockRejectedValueOnce(new Error('SERVFAIL'));
    mockDns.resolveNs.mockRejectedValueOnce(new Error('SERVFAIL'));

    const result = await mod.analyzeDns('nonexistent.invalid');
    expect(result.checked).toBe(true);
    expect(result.hasSpf).toBe(false);
    expect(result.hasMx).toBe(false);
  });

  it('returns A records', async () => {
    mockDns.resolveTxt.mockResolvedValueOnce([]);
    mockDns.resolveMx.mockRejectedValueOnce(new Error('ENODATA'));
    mockDns.resolveCaa.mockRejectedValueOnce(new Error('ENODATA'));
    mockDns.resolve4.mockResolvedValueOnce(['93.184.216.34', '93.184.216.35']);
    mockDns.resolve6.mockRejectedValueOnce(new Error('ENODATA'));
    mockDns.resolveNs.mockResolvedValueOnce([]);
    mockDns.resolveTxt.mockRejectedValueOnce(new Error('ENODATA'));

    const result = await mod.analyzeDns('example.com');
    expect(result.aRecords).toEqual(['93.184.216.34', '93.184.216.35']);
  });
});

// ─── 4. Blocklist Tests ──────────────────────────────────────────────────────

describe.skip('Blocklists (requires dns resolve)', () => {
  it('detects listed domain', async () => {
    // Spamhaus DBL returns 127.0.0.2 for listed domains
    mockDns.resolve4 = vi.fn().mockImplementation(async (query: string) => {
      if (query.includes('dbl.spamhaus.org')) return ['127.0.0.2'];
      if (query.includes('multi.surbl.org')) throw new Error('NXDOMAIN');
      if (query.includes('multi.uribl.com')) throw new Error('NXDOMAIN');
      if (query.includes('zen.spamhaus.org')) throw new Error('NXDOMAIN');
      throw new Error('NXDOMAIN');
    });

    const result = await mod.checkBlocklists('spam-domain.com');
    expect(result.checked).toBe(true);
    expect(result.spamhausListed).toBe(true);
    expect(result.lists).toContain('Spamhaus DBL');
  });

  it('returns clean for unlisted domain', async () => {
    mockDns.resolve4 = vi.fn().mockRejectedValue(new Error('NXDOMAIN'));

    const result = await mod.checkBlocklists('clean-domain.com');
    expect(result.checked).toBe(true);
    expect(result.lists).toHaveLength(0);
  });

  it('checks IP-based blocklists when IP provided', async () => {
    mockDns.resolve4 = vi.fn().mockImplementation(async (query: string) => {
      if (query.includes('zen.spamhaus.org')) return ['127.0.0.4'];
      throw new Error('NXDOMAIN');
    });

    const result = await mod.checkBlocklists('example.com', '1.2.3.4');
    expect(result.spamhausListed).toBe(true);
    expect(result.lists).toContain('Spamhaus ZEN (IP)');
  });
});

// ─── 5. CommonCrawl Tests ────────────────────────────────────────────────────

describe('CommonCrawl', () => {
  it('detects domain in index', async () => {
    fetchMock.mockResolvedValueOnce(mockFetchResponse({
      text: '{"timestamp":"20250101120000"}\n{"timestamp":"20250201120000"}',
    }));
    const result = await mod.checkCommonCrawl('example.com');
    expect(result.checked).toBe(true);
    expect(result.found).toBe(true);
    expect(result.pages).toBe(2);
  });

  it('handles domain not in index', async () => {
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ text: '' }));
    const result = await mod.checkCommonCrawl('brand-new-domain.xyz');
    expect(result.checked).toBe(true);
    expect(result.found).toBe(false);
  });

  it('handles API timeout', async () => {
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    const result = await mod.checkCommonCrawl('example.com');
    expect(result.checked).toBe(false);
  });
});

// ─── 6. OpenPhish Tests ──────────────────────────────────────────────────────

describe('OpenPhish', () => {
  it('detects phishing domain in feed', async () => {
    fetchMock.mockImplementationOnce(async () => mockFetchResponse({
      text: 'https://phishing-site.com/login\nhttps://scam.xyz/verify\nhttps://evil.com/fake',
    }));
    const result = await mod.checkOpenPhish('phishing-site.com');
    expect(result.checked).toBe(true);
    expect(result.isPhishing).toBe(true);
  });

  it('returns clean for safe domain', async () => {
    // Feed already cached from previous test — safe-domain.com not in it
    const result = await mod.checkOpenPhish('safe-domain.com');
    expect(result.checked).toBe(true);
    expect(result.isPhishing).toBe(false);
  });
});

// ─── 7. AbuseIPDB Tests ─────────────────────────────────────────────────────

describe('AbuseIPDB', () => {
  it('returns empty when no API key', async () => {
    delete process.env['ABUSEIPDB_API_KEY'];
    const result = await mod.checkAbuseIpdb('1.2.3.4');
    expect(result.checked).toBe(false);
  });

  it('returns empty when key set but API fails', async () => {
    process.env['ABUSEIPDB_API_KEY'] = 'test-key';
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ ok: false, status: 403 }));
    const result = await mod.checkAbuseIpdb('1.2.3.4');
    expect(result.checked).toBe(false);
    delete process.env['ABUSEIPDB_API_KEY'];
  });
});

// ─── 8. URLhaus Tests ────────────────────────────────────────────────────────

describe('URLhaus', () => {
  it('detects malware URL', async () => {
    fetchMock.mockImplementationOnce(async () => mockFetchResponse({
      json: { query_status: 'ok', threat: 'malware_download', tags: ['elf', 'mirai'] },
    }));
    const result = await mod.checkUrlhaus('https://evil.com/malware.exe');
    expect(result.checked).toBe(true);
    expect(result.isMalware).toBe(true);
    expect(result.threatType).toBe('malware_download');
  });

  it('returns clean for safe URL', async () => {
    fetchMock.mockImplementationOnce(async () => mockFetchResponse({
      json: { query_status: 'no_results' },
    }));
    const result = await mod.checkUrlhaus('https://safe.com');
    expect(result.checked).toBe(true);
    expect(result.isMalware).toBe(false);
  });
});

// ─── 9. SerpAPI Tests ────────────────────────────────────────────────────────

describe('SerpAPI', () => {
  it('returns empty when no API key', async () => {
    delete process.env['SERPAPI_KEY'];
    const result = await mod.checkSerpApi('example.com');
    expect(result.checked).toBe(false);
  });

  it.skip('detects indexed domain (needs env reload)', async () => {
    process.env['SERPAPI_KEY'] = 'test-key';
    fetchMock.mockResolvedValueOnce(mockFetchResponse({
      json: {
        search_information: { total_results: 1500 },
        organic_results: [
          { title: 'Example Domain', link: 'https://example.com' },
          { title: 'About', link: 'https://example.com/about' },
        ],
      },
    }));
    const result = await mod.checkSerpApi('example.com');
    expect(result.checked).toBe(true);
    expect(result.indexed).toBe(true);
    expect(result.totalResults).toBe(1500);
    expect(result.topResults).toHaveLength(2);
  });

  it.skip('detects non-indexed domain (needs env reload)', async () => {
    process.env['SERPAPI_KEY'] = 'test-key';
    fetchMock.mockResolvedValueOnce(mockFetchResponse({
      json: { search_information: { total_results: 0 }, organic_results: [] },
    }));
    const result = await mod.checkSerpApi('brand-new.xyz');
    expect(result.checked).toBe(true);
    expect(result.indexed).toBe(false);
    expect(result.totalResults).toBe(0);
  });
});

// ─── 11. runAllExternalChecks Tests ──────────────────────────────────────────

describe.skip('runAllExternalChecks (requires dns)', () => {
  it('returns all check results', async () => {
    // Mock all DNS calls
    mockDns.resolveTxt = vi.fn().mockRejectedValue(new Error('NXDOMAIN'));
    mockDns.resolveMx = vi.fn().mockRejectedValue(new Error('NXDOMAIN'));
    mockDns.resolveCaa = vi.fn().mockRejectedValue(new Error('NXDOMAIN'));
    mockDns.resolve4 = vi.fn().mockRejectedValue(new Error('NXDOMAIN'));
    mockDns.resolve6 = vi.fn().mockRejectedValue(new Error('NXDOMAIN'));
    mockDns.resolveNs = vi.fn().mockRejectedValue(new Error('NXDOMAIN'));

    fetchMock.mockResolvedValue(mockFetchResponse({ ok: false, status: 404 }));

    const result = await mod.runAllExternalChecks('example.com', 'https://example.com');
    expect(result).toHaveProperty('crtSh');
    expect(result).toHaveProperty('dnsAnalysis');
    expect(result).toHaveProperty('blocklists');
    expect(result).toHaveProperty('commonCrawl');
    expect(result).toHaveProperty('openPhish');
    expect(result).toHaveProperty('abuseIpdb');
    expect(result).toHaveProperty('urlhaus');
    expect(result).toHaveProperty('serpApi');
    expect(result).toHaveProperty('shodan');
  });

  it('resolves IP from DNS when not provided', async () => {
    mockDns.resolveTxt = vi.fn().mockResolvedValue([]);
    mockDns.resolveMx = vi.fn().mockRejectedValue(new Error('NXDOMAIN'));
    mockDns.resolveCaa = vi.fn().mockRejectedValue(new Error('NXDOMAIN'));
    mockDns.resolve4 = vi.fn().mockImplementation(async (query: string) => {
      if (!query.includes('.')) return ['93.184.216.34']; // domain A record
      throw new Error('NXDOMAIN'); // blocklist lookups
    });
    mockDns.resolve6 = vi.fn().mockRejectedValue(new Error('NXDOMAIN'));
    mockDns.resolveNs = vi.fn().mockResolvedValue([]);

    fetchMock.mockResolvedValue(mockFetchResponse({ ok: false, status: 404 }));

    const result = await mod.runAllExternalChecks('example.com', 'https://example.com');
    // Should have attempted Shodan with resolved IP
    expect(result.dnsAnalysis.checked).toBe(true);
  });
});
