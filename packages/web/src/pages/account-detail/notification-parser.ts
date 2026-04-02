/** Parsed notification card data. */
export interface NotifCard {
  title: string;
  description: string;
  category: 'CRITICAL' | 'WARNING' | 'INFO';
  type: string;
  label: string;
}

export const CATEGORY_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  CRITICAL: { color: '#f87171', bg: 'rgba(239,68,68,0.08)', label: 'CRITICAL' },
  WARNING: { color: '#fbbf24', bg: 'rgba(245,158,11,0.08)', label: 'WARNING' },
  INFO: { color: '#60a5fa', bg: 'rgba(59,130,246,0.08)', label: 'INFO' },
};

/**
 * Parse notification items from the raw nested JSON structure.
 */
export function parseNotificationCards(raw: unknown): NotifCard[] {
  if (raw == null) return [];
  if (typeof raw !== 'object' || Array.isArray(raw)) return [];

  const obj = raw as Record<string, unknown>;
  let items: unknown[] | null = null;

  if (Array.isArray(obj['2'])) {
    items = obj['2'] as unknown[];
  }
  const notifs = obj['notifications'];
  if (!items && notifs && typeof notifs === 'object' && !Array.isArray(notifs)) {
    const inner = notifs as Record<string, unknown>;
    if (Array.isArray(inner['2'])) {
      items = inner['2'] as unknown[];
    }
  }

  if (!items || items.length === 0) {
    const entries = obj['1'];
    if (Array.isArray(entries) && entries.length > 0) {
      return entries.map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        return parseLegacyEntry(entry as Record<string, unknown>);
      }).filter((x): x is NotifCard => x != null);
    }
    return [];
  }

  const cards: NotifCard[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const card = parseNotifItem(item as Record<string, unknown>);
    if (card) cards.push(card);
  }
  return cards;
}

function parseNotifItem(item: Record<string, unknown>): NotifCard | null {
  const field50 = item['50'] as Record<string, unknown> | undefined;
  const title = field50?.['1'] as string | undefined;
  const description = field50?.['2'] as string | undefined;
  const kvPairs = field50?.['5'] as Array<Record<string, string>> | undefined;
  const label = (item['6'] as string) ?? '';

  let category: 'CRITICAL' | 'WARNING' | 'INFO' = 'INFO';
  let type = '';

  if (Array.isArray(kvPairs)) {
    for (const kv of kvPairs) {
      const name = kv['1'];
      const value = kv['2'];
      if (name === 'Category') {
        if (value === 'CRITICAL') category = 'CRITICAL';
        else if (value === 'WARNING') category = 'WARNING';
        else category = 'INFO';
      }
      if (name === 'Type') {
        type = value ?? '';
      }
    }
  }

  if (!kvPairs || kvPairs.length === 0) {
    const allText = `${title ?? ''} ${description ?? ''} ${label}`.toLowerCase();
    if (allText.includes('suspend') || allText.includes('violation') || allText.includes('disapproved')) {
      category = 'CRITICAL';
    } else if (allText.includes('warning') || allText.includes('payment') || allText.includes('billing')) {
      category = 'WARNING';
    }
  }

  if (!title && !description && !label) return null;

  return {
    title: title ?? label ?? 'Уведомление',
    description: description ?? '',
    category,
    type,
    label,
  };
}

function parseLegacyEntry(entry: Record<string, unknown>): NotifCard | null {
  const strings: string[] = [];
  collectStrings(entry, strings, 0, 5);
  const meaningful = strings.filter((s) => s.length > 3 && !/^\d+$/.test(s));
  if (meaningful.length === 0) return null;

  const allText = meaningful.join(' ');
  let category: 'CRITICAL' | 'WARNING' | 'INFO' = 'INFO';
  if (/suspend|violation|disapproved|PolicyViolation/i.test(allText)) category = 'CRITICAL';
  else if (/payment|billing|warning/i.test(allText)) category = 'WARNING';

  return {
    title: meaningful[0] ?? 'Уведомление',
    description: meaningful.slice(1).join(' '),
    category,
    type: '',
    label: '',
  };
}

function collectStrings(obj: unknown, out: string[], depth: number, maxDepth: number): void {
  if (depth > maxDepth || obj == null) return;
  if (typeof obj === 'string' && obj.length > 0) { out.push(obj); return; }
  if (Array.isArray(obj)) { for (const item of obj) collectStrings(item, out, depth + 1, maxDepth); return; }
  if (typeof obj === 'object') { for (const val of Object.values(obj as Record<string, unknown>)) collectStrings(val, out, depth + 1, maxDepth); }
}
