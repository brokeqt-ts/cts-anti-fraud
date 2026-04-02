import type { CampaignRow, AdRow } from '../../api.js';

export const RISK_LABELS: Record<string, string> = {
  high: 'Высокий риск',
  medium: 'Средний риск',
  low: 'Низкий риск',
  unknown: 'Неизвестен',
};

export const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  '2': 'Search',
  '3': 'Display',
  '9': 'PMax',
  '12': 'DemandGen',
};

export const CAMPAIGN_STATUS_MAP: Record<string, { label: string; color: string }> = {
  '2': { label: 'Paused', color: 'var(--accent-amber)' },
  '3': { label: 'Enabled', color: 'var(--accent-green)' },
};

export const BIDDING_STRATEGY_LABELS: Record<string, string> = {
  '2': 'Manual CPC',
  '3': 'Manual CPV',
  '4': 'Manual CPM',
  '10': 'Max Conversions',
  '11': 'Max Conv. Value',
  '12': 'Target CPA',
  '13': 'Target ROAS',
  '14': 'Target Impr. Share',
};

export const MATCH_TYPE_LABELS: Record<string, string> = {
  '1': 'Broad',
  '2': 'Phrase',
  '3': 'Exact',
};

/** Parse Google Ads date format "YYYYMMDDHHmmss" or "YYYYMMDD" → Date. */
export function parseGadsDate(s: string | null): Date | null {
  if (!s || s.length < 8) return null;
  const y = s.slice(0, 4), m = s.slice(4, 6), d = s.slice(6, 8);
  return new Date(`${y}-${m}-${d}`);
}

export function formatGadsDate(s: string | null): string {
  const d = parseGadsDate(s);
  if (!d || isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export function formatBudget(micros: string | null, currency: string | null): string {
  if (!micros) return '-';
  const amount = Number(micros) / 1_000_000;
  const sym = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'CHF' ? 'CHF ' : (currency ?? '') + ' ';
  return `${sym}${amount.toFixed(2)}/день`;
}

export function formatCostFromMicros(micros: string | null, currency: string | null): string {
  if (!micros) return '-';
  const amount = Number(micros) / 1_000_000;
  const sym = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : (currency ?? '') + ' ';
  return `${sym}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Deduplicate campaigns by campaign_id, keeping the most recent captured_at. */
export function deduplicateCampaigns(campaigns: CampaignRow[]): CampaignRow[] {
  const map = new Map<string, CampaignRow>();
  for (const c of campaigns) {
    const existing = map.get(c.campaign_id);
    if (!existing || c.captured_at > existing.captured_at) {
      map.set(c.campaign_id, c);
    }
  }
  return [...map.values()];
}

/** Deduplicate ads by ad_id, keeping latest. */
export function deduplicateAds(ads: AdRow[]): AdRow[] {
  const map = new Map<string, AdRow>();
  for (const a of ads) {
    const key = a.ad_id ?? `${a.ad_group_id}-${a.headlines?.toString()}`;
    const existing = map.get(key);
    if (!existing || a.captured_at > existing.captured_at) {
      map.set(key, a);
    }
  }
  return [...map.values()];
}

export function adHasContent(ad: AdRow): boolean {
  if (ad.headlines && Array.isArray(ad.headlines) && ad.headlines.length > 0) return true;
  if (ad.descriptions && Array.isArray(ad.descriptions) && ad.descriptions.length > 0) return true;
  if (ad.display_url) return true;
  return false;
}

/** Google Ads UI noise regex for filtering notifications. */
export const UI_NOISE_RE = /_PROMO$|EXPAND_COLLAPSE|HALO_|CREATIVE_BRIEF|FORECASTING|DATA_MANAGER|SEARCH_THEMES|DM_IN_SA360|SCOPING_FEATURE/;
