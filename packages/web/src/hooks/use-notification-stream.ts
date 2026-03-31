import { useEffect, useRef, useCallback, useState } from 'react';
import { getApiUrl } from '../api.js';
import { getStoredAccessToken } from '../contexts/auth-context.js';

const API_PREFIX = '/api/v1';

export interface SseNotification {
  id: string;
  title: string;
  message: string | null;
  type: string;
  severity: string;
}

interface UseNotificationStreamResult {
  unreadCount: number;
  lastNotification: SseNotification | null;
  connected: boolean;
}

export function useNotificationStream(): UseNotificationStreamResult {
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastNotification, setLastNotification] = useState<SseNotification | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    const token = getStoredAccessToken();
    if (!token) return;

    // EventSource doesn't support custom headers, pass token as query param
    const url = `${getApiUrl()}${API_PREFIX}/notifications/stream?token=${encodeURIComponent(token)}`;

    try {
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => setConnected(true);

      es.addEventListener('unread_count', (e) => {
        try {
          const data = JSON.parse(e.data) as { count: number };
          setUnreadCount(data.count);
        } catch { /* ignore */ }
      });

      es.addEventListener('notification', (e) => {
        try {
          const data = JSON.parse(e.data) as SseNotification;
          setLastNotification(data);
        } catch { /* ignore */ }
      });

      es.onerror = () => {
        setConnected(false);
        es.close();
        esRef.current = null;
        // Retry in 5s
        retryRef.current = setTimeout(connect, 5000);
      };
    } catch {
      retryRef.current = setTimeout(connect, 5000);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [connect]);

  return { unreadCount, lastNotification, connected };
}
