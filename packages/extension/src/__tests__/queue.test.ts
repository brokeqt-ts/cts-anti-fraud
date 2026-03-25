import { describe, it, expect, beforeEach } from 'vitest';
import { setupChromeMock, clearStorage } from './helpers/chrome-mock.js';

// Must be set before importing queue module
setupChromeMock();

import { enqueue, getQueue, dequeue, incrementRetries, clearQueue, getQueueSize } from '../transport/queue.js';

describe('Queue', () => {
  beforeEach(() => {
    clearStorage();
  });

  it('enqueues items correctly', async () => {
    await enqueue('account', { accountId: '123' });
    const queue = await getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.type).toBe('account');
    expect(queue[0]!.data).toEqual({ accountId: '123' });
    expect(queue[0]!.retries).toBe(0);
  });

  it('assigns unique IDs to items', async () => {
    await enqueue('account', { id: '1' });
    await enqueue('campaign', { id: '2' });
    const queue = await getQueue();
    expect(queue).toHaveLength(2);
    expect(queue[0]!.id).not.toBe(queue[1]!.id);
  });

  it('maintains FIFO order', async () => {
    await enqueue('account', { order: 1 });
    await enqueue('campaign', { order: 2 });
    await enqueue('billing', { order: 3 });
    const queue = await getQueue();
    expect(queue).toHaveLength(3);
    expect((queue[0]!.data as Record<string, unknown>)['order']).toBe(1);
    expect((queue[1]!.data as Record<string, unknown>)['order']).toBe(2);
    expect((queue[2]!.data as Record<string, unknown>)['order']).toBe(3);
  });

  it('evicts oldest items on overflow (MAX_QUEUE_SIZE = 1000)', async () => {
    // Fill up to 1000
    for (let i = 0; i < 1000; i++) {
      await enqueue('raw', { index: i });
    }
    expect(await getQueueSize()).toBe(1000);

    // Add one more — should evict oldest
    await enqueue('raw', { index: 1000 });
    const queue = await getQueue();
    expect(queue.length).toBeLessThanOrEqual(1000);
    // Newest item should be at the end
    const last = queue[queue.length - 1]!;
    expect((last.data as Record<string, unknown>)['index']).toBe(1000);
  });

  it('dequeues items by ID', async () => {
    await enqueue('account', { id: '1' });
    await enqueue('campaign', { id: '2' });
    const queue = await getQueue();
    const idToRemove = queue[0]!.id;
    await dequeue([idToRemove]);
    const remaining = await getQueue();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.type).toBe('campaign');
  });

  it('increments retry count', async () => {
    await enqueue('account', { id: '1' });
    const queue = await getQueue();
    const id = queue[0]!.id;
    expect(queue[0]!.retries).toBe(0);
    await incrementRetries([id]);
    const updated = await getQueue();
    expect(updated[0]!.retries).toBe(1);
    await incrementRetries([id]);
    const updated2 = await getQueue();
    expect(updated2[0]!.retries).toBe(2);
  });

  it('clears all items', async () => {
    await enqueue('account', { id: '1' });
    await enqueue('campaign', { id: '2' });
    expect(await getQueueSize()).toBe(2);
    await clearQueue();
    expect(await getQueueSize()).toBe(0);
  });

  it('returns empty queue initially', async () => {
    const queue = await getQueue();
    expect(queue).toEqual([]);
    expect(await getQueueSize()).toBe(0);
  });

  it('includes timestamp on enqueued items', async () => {
    const before = new Date().toISOString();
    await enqueue('account', {});
    const queue = await getQueue();
    const after = new Date().toISOString();
    expect(queue[0]!.timestamp).toBeDefined();
    expect(queue[0]!.timestamp >= before).toBe(true);
    expect(queue[0]!.timestamp <= after).toBe(true);
  });
});
