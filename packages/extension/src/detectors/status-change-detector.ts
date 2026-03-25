// Detects Google Ads account status changes by comparing current vs previous state.
// Stores previous statuses in chrome.storage.local to survive service worker restarts.

const STATUS_CACHE_KEY = 'cts_account_statuses';

export type AccountStatus = 'active' | 'suspended' | 'canceled' | 'unknown';

interface StatusRecord {
  status: AccountStatus;
  detected_at: string;
}

interface StatusChangeEvent {
  account_id: string;
  previous_status: AccountStatus;
  new_status: AccountStatus;
  detected_at: string;
}

/**
 * Load previously seen account statuses from storage.
 */
async function loadStatuses(): Promise<Map<string, StatusRecord>> {
  const stored = await chrome.storage.local.get(STATUS_CACHE_KEY);
  const data = stored[STATUS_CACHE_KEY] as Record<string, StatusRecord> | undefined;
  return new Map(Object.entries(data ?? {}));
}

/**
 * Save account statuses to storage.
 */
async function saveStatuses(statuses: Map<string, StatusRecord>): Promise<void> {
  const obj: Record<string, StatusRecord> = {};
  for (const [k, v] of statuses) {
    obj[k] = v;
  }
  await chrome.storage.local.set({ [STATUS_CACHE_KEY]: obj });
}

/**
 * Extract account status from intercepted data.
 * Returns null if no status signal found.
 */
export function extractAccountStatus(data: Record<string, unknown>): AccountStatus | null {
  // Check common fields in intercepted responses
  const statusFields = ['status', 'accountStatus', 'account_status', 'suspensionStatus'];

  for (const field of statusFields) {
    const value = data[field];
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (lower.includes('suspend') || lower.includes('banned')) return 'suspended';
      if (lower.includes('cancel') || lower.includes('closed')) return 'canceled';
      if (lower.includes('active') || lower.includes('enabled')) return 'active';
    }
  }

  // Check nested signal structures (from signals parser)
  const signals = data['signals'] as Record<string, unknown>[] | undefined;
  if (Array.isArray(signals)) {
    for (const signal of signals) {
      if (signal['name'] === 'account_suspended' || signal['signal_name'] === 'account_suspended') {
        const val = signal['value'] as Record<string, unknown> | undefined;
        if (val && (val['1'] === true || val['1'] === 'true')) return 'suspended';
      }
    }
  }

  return null;
}

/**
 * Check for status changes and return events if detected.
 */
export async function checkForStatusChange(
  accountId: string,
  currentStatus: AccountStatus,
): Promise<StatusChangeEvent | null> {
  const statuses = await loadStatuses();
  const previous = statuses.get(accountId);
  const now = new Date().toISOString();

  // Update stored status
  statuses.set(accountId, { status: currentStatus, detected_at: now });
  await saveStatuses(statuses);

  // Detect change
  if (previous && previous.status !== currentStatus) {
    return {
      account_id: accountId,
      previous_status: previous.status,
      new_status: currentStatus,
      detected_at: now,
    };
  }

  return null;
}
