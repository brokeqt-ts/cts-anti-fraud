// Queue management for unsent data. Uses chrome.storage.local for persistence.

export type QueuePriority = 'normal' | 'urgent';

export interface QueueItem {
  id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
  retries: number;
  priority?: QueuePriority;
}

const STORAGE_KEY = 'cts_queue';
const MAX_QUEUE_SIZE = 1000;
const MAX_ITEM_RETRIES = 20;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export async function enqueue(
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  const items = await getQueue();

  if (items.length >= MAX_QUEUE_SIZE) {
    // Remove oldest items to make room
    items.splice(0, items.length - MAX_QUEUE_SIZE + 1);
  }

  items.push({
    id: generateId(),
    type,
    timestamp: new Date().toISOString(),
    data,
    retries: 0,
  });

  await chrome.storage.local.set({ [STORAGE_KEY]: items });
}

/**
 * Enqueue an urgent item (status changes). These should be sent immediately.
 */
export async function enqueueUrgent(
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  const items = await getQueue();

  items.push({
    id: generateId(),
    type,
    timestamp: new Date().toISOString(),
    data,
    retries: 0,
    priority: 'urgent',
  });

  await chrome.storage.local.set({ [STORAGE_KEY]: items });
}

/**
 * Check if there are urgent items in the queue.
 */
export async function hasUrgentItems(): Promise<boolean> {
  const items = await getQueue();
  return items.some(item => item.priority === 'urgent');
}

export async function getQueue(): Promise<QueueItem[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as QueueItem[] | undefined) ?? [];
}

export async function dequeue(ids: string[]): Promise<void> {
  const items = await getQueue();
  const idSet = new Set(ids);
  const remaining = items.filter((item) => !idSet.has(item.id));
  await chrome.storage.local.set({ [STORAGE_KEY]: remaining });
}

export async function incrementRetries(ids: string[]): Promise<void> {
  const items = await getQueue();
  const idSet = new Set(ids);
  const deadIds: string[] = [];
  for (const item of items) {
    if (idSet.has(item.id)) {
      item.retries++;
      if (item.retries >= MAX_ITEM_RETRIES) {
        deadIds.push(item.id);
        console.warn(`[CTS queue] Item ${item.id} (type=${item.type}) exceeded max retries (${MAX_ITEM_RETRIES}), dropping`);
      }
    }
  }
  // Remove dead-letter items that exceeded max retries
  const remaining = deadIds.length > 0
    ? items.filter(item => !deadIds.includes(item.id))
    : items;
  await chrome.storage.local.set({ [STORAGE_KEY]: remaining });
}

export async function clearQueue(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: [] });
}

export async function getQueueSize(): Promise<number> {
  const items = await getQueue();
  return items.length;
}
