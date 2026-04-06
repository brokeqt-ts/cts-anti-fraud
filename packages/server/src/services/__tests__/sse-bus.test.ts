import { describe, it, expect, vi } from 'vitest';
import { addSseClient, broadcastToUser, broadcastToAll, getConnectedCount } from '../sse-bus.js';

function createMockReply() {
  const written: string[] = [];
  const onHandlers: Record<string, Array<() => void>> = {};
  return {
    raw: {
      write: vi.fn((chunk: string) => { written.push(chunk); return true; }),
      on: vi.fn((event: string, handler: () => void) => {
        if (!onHandlers[event]) onHandlers[event] = [];
        onHandlers[event].push(handler);
      }),
    },
    written,
    simulateClose() {
      for (const h of (onHandlers['close'] ?? [])) h();
    },
  };
}

describe('SSE Bus', () => {
  // Note: the module keeps global state — tests may interact.
  // We test the core flows.

  it('tracks connected clients', () => {
    const initialCount = getConnectedCount();
    const reply = createMockReply();
    addSseClient('user-1', reply as never);
    expect(getConnectedCount()).toBe(initialCount + 1);
  });

  it('removes client on close', () => {
    const reply = createMockReply();
    const before = getConnectedCount();
    addSseClient('user-close-test', reply as never);
    expect(getConnectedCount()).toBe(before + 1);
    reply.simulateClose();
    expect(getConnectedCount()).toBe(before);
  });

  it('broadcastToUser sends only to matching userId', () => {
    const reply1 = createMockReply();
    const reply2 = createMockReply();
    addSseClient('user-a', reply1 as never);
    addSseClient('user-b', reply2 as never);

    broadcastToUser('user-a', 'test', { hello: 'world' });

    expect(reply1.raw.write).toHaveBeenCalled();
    const lastCall = reply1.written[reply1.written.length - 1];
    expect(lastCall).toContain('event: test');
    expect(lastCall).toContain('"hello":"world"');

    // user-b should NOT have received anything from this broadcast
    const bCalls = reply2.written.filter(w => w.includes('event: test'));
    expect(bCalls).toHaveLength(0);
  });

  it('broadcastToAll sends to all clients', () => {
    const reply1 = createMockReply();
    const reply2 = createMockReply();
    addSseClient('user-all-1', reply1 as never);
    addSseClient('user-all-2', reply2 as never);

    broadcastToAll('global', { msg: 'hi' });

    expect(reply1.written.some(w => w.includes('event: global'))).toBe(true);
    expect(reply2.written.some(w => w.includes('event: global'))).toBe(true);
  });

  it('handles write errors gracefully (removes broken client)', () => {
    const reply = createMockReply();
    addSseClient('user-broken', reply as never);

    // Make write throw
    reply.raw.write.mockImplementation(() => { throw new Error('broken pipe'); });
    const before = getConnectedCount();

    // Should not throw
    broadcastToUser('user-broken', 'fail', {});
    expect(getConnectedCount()).toBe(before - 1);
  });

  it('SSE message format is correct', () => {
    const reply = createMockReply();
    addSseClient('user-format', reply as never);

    broadcastToUser('user-format', 'notification', { id: '123', title: 'Test' });

    const msg = reply.written[reply.written.length - 1];
    expect(msg).toBe('event: notification\ndata: {"id":"123","title":"Test"}\n\n');
  });
});
