import { describe, it, expect } from 'vitest';
import { extractQualityScores } from './quality-score-parser.js';
import type { RpcContext } from './rpc-router.js';
import type pg from 'pg';

/** Helper: build a minimal RpcContext for testing extraction (no DB calls). */
function makeCtx(overrides?: Partial<RpcContext>): RpcContext {
  return {
    pool: {} as pg.Pool,
    rawPayloadId: 'test-payload-id',
    sourceUrl: 'https://ads.google.com/aw_do/rpc/BatchService/Batch?ocid=1234567890',
    accountGoogleId: '1234567890',
    profileId: null,
    body: {},
    ...overrides,
  };
}

describe('quality-score-parser: extractQualityScores', () => {
  it('extracts full QS components from a batch payload', () => {
    const body = {
      '2': [
        JSON.stringify({
          '1': [
            {
              '1': '1234567890',
              '4': 'kw-001',
              '13': 'buy shoes online',
              '105': 7,
              '28': 3, // ABOVE_AVERAGE
              '29': 2, // AVERAGE
              '30': 3, // ABOVE_AVERAGE
            },
          ],
        }),
      ],
    };

    const ctx = makeCtx({ body });
    const results = extractQualityScores(body, ctx);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      accountGoogleId: '1234567890',
      keywordId: 'kw-001',
      qualityScore: 7,
      expectedCtr: 3,
      adRelevance: 2,
      landingPageExperience: 3,
    });
  });

  it('extracts partial QS data (only overall score)', () => {
    const body = {
      '2': [
        JSON.stringify({
          '1': [
            {
              '1': '1234567890',
              '4': 'kw-002',
              '13': 'cheap flights',
              '105': 4,
              // No component fields
            },
          ],
        }),
      ],
    };

    const ctx = makeCtx({ body });
    const results = extractQualityScores(body, ctx);

    expect(results).toHaveLength(1);
    expect(results[0]!.qualityScore).toBe(4);
    expect(results[0]!.expectedCtr).toBeNull();
    expect(results[0]!.adRelevance).toBeNull();
    expect(results[0]!.landingPageExperience).toBeNull();
  });

  it('skips keywords with no QS data (new keyword)', () => {
    const body = {
      '2': [
        JSON.stringify({
          '1': [
            {
              '1': '1234567890',
              '4': 'kw-003',
              '13': 'new keyword no qs',
              // No QS fields at all
            },
          ],
        }),
      ],
    };

    const ctx = makeCtx({ body });
    const results = extractQualityScores(body, ctx);

    expect(results).toHaveLength(0);
  });

  it('extracts multiple keywords from a single payload', () => {
    const body = {
      '2': [
        JSON.stringify({
          '1': [
            { '1': '1234567890', '4': 'kw-a', '105': 8, '28': 3, '29': 3, '30': 3 },
            { '1': '1234567890', '4': 'kw-b', '105': 3, '28': 1, '29': 1, '30': 2 },
            { '1': '1234567890', '4': 'kw-c', '105': 10, '28': 3, '29': 3, '30': 3 },
          ],
        }),
      ],
    };

    const ctx = makeCtx({ body });
    const results = extractQualityScores(body, ctx);

    expect(results).toHaveLength(3);
    expect(results[0]!.qualityScore).toBe(8);
    expect(results[1]!.qualityScore).toBe(3);
    expect(results[2]!.qualityScore).toBe(10);
  });

  it('handles malformed/unexpected payload structure', () => {
    // Null body
    expect(extractQualityScores(null, makeCtx())).toEqual([]);

    // Empty object
    expect(extractQualityScores({}, makeCtx())).toEqual([]);

    // body.2 is not an array
    expect(extractQualityScores({ '2': 'not-array' }, makeCtx())).toEqual([]);

    // body.2 contains invalid JSON strings
    expect(extractQualityScores({ '2': ['not valid json', 42] }, makeCtx())).toEqual([]);

    // body.1 items missing keyword_id
    expect(extractQualityScores({
      '1': [{ '105': 5 }], // No field "4" (keyword_id)
    }, makeCtx())).toEqual([]);
  });

  it('handles direct list response (body.1[])', () => {
    const body = {
      '1': [
        { '1': '1234567890', '4': 'kw-direct', '105': 6, '28': 2, '29': 2, '30': 2 },
      ],
    };

    const ctx = makeCtx({ body });
    const results = extractQualityScores(body, ctx);

    expect(results).toHaveLength(1);
    expect(results[0]!.keywordId).toBe('kw-direct');
    expect(results[0]!.qualityScore).toBe(6);
  });

  it('validates quality score range (1-10)', () => {
    const body = {
      '1': [
        { '1': '1234567890', '4': 'kw-valid', '105': 5, '28': 2 },
        { '1': '1234567890', '4': 'kw-range', '105': 0, '28': 2 }, // 0 is below range
        { '1': '1234567890', '4': 'kw-range2', '105': 11, '29': 3 }, // 11 is above range
      ],
    };

    const ctx = makeCtx({ body });
    const results = extractQualityScores(body, ctx);

    expect(results).toHaveLength(3);
    // Valid score preserved
    expect(results[0]!.qualityScore).toBe(5);
    // Out-of-range scores become null (but entry kept because other components exist)
    expect(results[1]!.qualityScore).toBeNull();
    expect(results[2]!.qualityScore).toBeNull();
  });

  it('uses CID from URL when body customer_id is missing', () => {
    const body = {
      '1': [
        { '4': 'kw-no-cid', '105': 5, '28': 2 },
      ],
    };

    const ctx = makeCtx({
      body,
      accountGoogleId: '9999999999',
    });
    const results = extractQualityScores(body, ctx);

    expect(results).toHaveLength(1);
    expect(results[0]!.accountGoogleId).toBe('9999999999');
  });
});
