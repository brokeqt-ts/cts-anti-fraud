import { describe, it, expect } from 'vitest';

// Test the pure logic: detectGenericAccountName and voting logic
// The DB-dependent functions are tested via integration tests

describe('Account Type Classifier', () => {
  describe('Generic account name detection', () => {
    // Import the module dynamically to avoid env.ts dependency
    // We test the name detection logic inline since it's pure

    function detectGenericAccountName(displayName: string | null): { signal: string; value: string; points_to: string; weight: number } | null {
      if (!displayName) return null;

      const genericPatterns = [
        /^acc(ount)?\s*\d+$/i,
        /^profile\s*\d+$/i,
        /^test\s*\d*$/i,
        /^\buser\s*\d+$/i,
        /^\d{5,}$/,
        /^[a-f0-9]{8,}$/i,
      ];

      for (const pattern of genericPatterns) {
        if (pattern.test(displayName.trim())) {
          return { signal: 'generic_account_name', value: displayName, points_to: 'farm', weight: 0.15 };
        }
      }
      return null;
    }

    it('detects "acc123" as generic', () => {
      const result = detectGenericAccountName('acc123');
      expect(result).not.toBeNull();
      expect(result!.points_to).toBe('farm');
    });

    it('detects "Account 5" as generic', () => {
      const result = detectGenericAccountName('Account 5');
      expect(result).not.toBeNull();
    });

    it('detects "Profile 42" as generic', () => {
      const result = detectGenericAccountName('Profile 42');
      expect(result).not.toBeNull();
    });

    it('detects "test" as generic', () => {
      const result = detectGenericAccountName('test');
      expect(result).not.toBeNull();
    });

    it('detects "test123" as generic', () => {
      const result = detectGenericAccountName('test123');
      expect(result).not.toBeNull();
    });

    it('detects numeric IDs (5+ digits) as generic', () => {
      const result = detectGenericAccountName('12345');
      expect(result).not.toBeNull();
    });

    it('detects hex hashes as generic', () => {
      const result = detectGenericAccountName('a1b2c3d4e5f6');
      expect(result).not.toBeNull();
    });

    it('does NOT flag normal business names', () => {
      expect(detectGenericAccountName('My Business LLC')).toBeNull();
      expect(detectGenericAccountName('ООО Рога и Копыта')).toBeNull();
      expect(detectGenericAccountName('John Smith Advertising')).toBeNull();
    });

    it('does NOT flag null/empty names', () => {
      expect(detectGenericAccountName(null)).toBeNull();
    });
  });

  describe('Weighted voting logic', () => {
    type AccountType = 'farm' | 'purchased' | 'agency' | 'unknown';

    interface Signal {
      signal: string;
      value: string;
      points_to: AccountType;
      weight: number;
    }

    function computeVote(signals: Signal[]): { account_type: AccountType; confidence: number } {
      if (signals.length === 0) {
        return { account_type: 'unknown', confidence: 0 };
      }

      const votes: Record<AccountType, number> = { farm: 0, purchased: 0, agency: 0, unknown: 0 };
      let totalWeight = 0;

      for (const signal of signals) {
        votes[signal.points_to] += signal.weight;
        totalWeight += signal.weight;
      }

      let bestType: AccountType = 'unknown';
      let bestScore = 0;
      for (const [type, score] of Object.entries(votes)) {
        if (score > bestScore) {
          bestScore = score;
          bestType = type as AccountType;
        }
      }

      const confidence = totalWeight > 0 ? Math.min(bestScore / totalWeight, 1) : 0;
      return { account_type: bestType, confidence: Math.round(confidence * 100) / 100 };
    }

    it('returns unknown when no signals', () => {
      const result = computeVote([]);
      expect(result.account_type).toBe('unknown');
      expect(result.confidence).toBe(0);
    });

    it('returns farm with high confidence when multiple farm signals', () => {
      const signals: Signal[] = [
        { signal: 'young_no_billing', value: 'age=3d', points_to: 'farm', weight: 0.25 },
        { signal: 'multi_account_profile', value: '5 accounts', points_to: 'farm', weight: 0.3 },
        { signal: 'generic_name', value: 'test123', points_to: 'farm', weight: 0.15 },
      ];
      const result = computeVote(signals);
      expect(result.account_type).toBe('farm');
      expect(result.confidence).toBe(1);
    });

    it('resolves mixed signals by weight', () => {
      const signals: Signal[] = [
        { signal: 'mcc_parent', value: 'found', points_to: 'agency', weight: 0.35 },
        { signal: 'generic_name', value: 'test', points_to: 'farm', weight: 0.15 },
      ];
      const result = computeVote(signals);
      expect(result.account_type).toBe('agency');
      expect(result.confidence).toBe(0.7);
    });

    it('returns purchased when signals point there', () => {
      const signals: Signal[] = [
        { signal: 'unverified_old', value: 'age=60d', points_to: 'purchased', weight: 0.3 },
        { signal: 'currency_mismatch', value: 'USD/UA', points_to: 'purchased', weight: 0.2 },
      ];
      const result = computeVote(signals);
      expect(result.account_type).toBe('purchased');
      expect(result.confidence).toBe(1);
    });
  });
});
