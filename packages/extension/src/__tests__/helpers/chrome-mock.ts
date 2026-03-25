/**
 * Mock chrome.* APIs for extension unit tests.
 */
import { vi } from 'vitest';

interface StorageData {
  [key: string]: unknown;
}

const storage: StorageData = {};

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const keyList = typeof keys === 'string' ? [keys] : keys;
        const result: StorageData = {};
        for (const key of keyList) {
          if (key in storage) result[key] = storage[key];
        }
        return result;
      }),
      set: vi.fn(async (items: StorageData) => {
        Object.assign(storage, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const keyList = typeof keys === 'string' ? [keys] : keys;
        for (const key of keyList) {
          delete storage[key];
        }
      }),
      clear: vi.fn(async () => {
        for (const key of Object.keys(storage)) {
          delete storage[key];
        }
      }),
    },
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
    onAlarm: { addListener: vi.fn() },
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn() },
    onInstalled: { addListener: vi.fn() },
    getManifest: vi.fn(() => ({ version: '0.1.0' })),
  },
  tabs: {
    query: vi.fn(async () => []),
    onRemoved: { addListener: vi.fn() },
  },
  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
  },
};

export function setupChromeMock(): void {
  (globalThis as Record<string, unknown>)['chrome'] = chromeMock;
}

export function clearStorage(): void {
  for (const key of Object.keys(storage)) {
    delete storage[key];
  }
}

export { chromeMock };
