import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, ShieldAlert, Info, ShieldCheck, X } from 'lucide-react';
import type { SseNotification } from '../hooks/use-notification-stream.js';

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; border: string; icon: typeof Info }> = {
  critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.3)', icon: ShieldAlert },
  warning: { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.3)', icon: AlertTriangle },
  info: { color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.3)', icon: Info },
  success: { color: '#22c55e', bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.3)', icon: ShieldCheck },
};

const AUTO_DISMISS_MS = 6000;

interface Props {
  notification: SseNotification | null;
}

export function ToastNotifications({ notification }: Props) {
  const [toasts, setToasts] = useState<Array<SseNotification & { key: number }>>([]);

  useEffect(() => {
    if (!notification) return;
    const key = Date.now();
    setToasts(prev => [...prev.slice(-4), { ...notification, key }]);

    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.key !== key));
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notification]);

  function dismiss(key: number) {
    setToasts(prev => prev.filter(t => t.key !== key));
  }

  return (
    <div className="fixed top-14 right-4 z-[150] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: 360 }}>
      <AnimatePresence>
        {toasts.map(t => {
          const config = SEVERITY_CONFIG[t.severity] ?? SEVERITY_CONFIG.info;
          const Icon = config.icon;
          return (
            <motion.div
              key={t.key}
              initial={{ opacity: 0, x: 80, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, scale: 0.95 }}
              transition={{ duration: 0.25 }}
              className="pointer-events-auto rounded-xl p-3 shadow-lg flex items-start gap-3"
              style={{
                background: 'var(--bg-base)',
                border: `1px solid ${config.border}`,
                boxShadow: `0 4px 24px rgba(0,0,0,0.3)`,
              }}
            >
              <Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: config.color }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {t.title}
                </div>
                {t.message && (
                  <div className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                    {t.message}
                  </div>
                )}
              </div>
              <button onClick={() => dismiss(t.key)} className="shrink-0 p-0.5 rounded" style={{ color: 'var(--text-muted)' }}>
                <X className="w-3 h-3" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
