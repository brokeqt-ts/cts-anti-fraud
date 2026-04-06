import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, CheckCheck, AlertTriangle, Info, ShieldAlert, ShieldCheck, Link2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  fetchUnreadCount,
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  timeAgo,
  type Notification,
} from '../api.js';

const POLL_INTERVAL = 30_000;
const DROPDOWN_LIMIT = 10;

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; icon: typeof Bell }> = {
  critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.10)', icon: ShieldAlert },
  warning: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', icon: AlertTriangle },
  info: { color: '#3b82f6', bg: 'rgba(59,130,246,0.10)', icon: Info },
  success: { color: '#22c55e', bg: 'rgba(34,197,94,0.10)', icon: ShieldCheck },
};

const TYPE_ICON: Record<string, typeof Bell> = {
  account_connected: Link2,
};

export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [prevCount, setPrevCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Poll unread count
  useEffect(() => {
    let active = true;
    const poll = () => {
      fetchUnreadCount()
        .then((r) => {
          if (!active) return;
          setPrevCount(unreadCount);
          setUnreadCount(r.count);
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, POLL_INTERVAL);
    return () => { active = false; clearInterval(id); };
  // eslint-disable-next-line
  }, []);

  // Load notifications when dropdown opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchNotifications({ limit: DROPDOWN_LIMIT })
      .then((r) => {
        setNotifications(r.notifications);
        setUnreadCount(r.unread_count);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleMarkRead = useCallback(async (n: Notification) => {
    if (!n.is_read) {
      await markNotificationRead(n.id).catch(() => {});
      setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, is_read: true } : x));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    // Navigate on ban/account notifications
    const gid = n.metadata?.['account_google_id'] as string | undefined;
    if (gid && (n.type === 'ban_detected' || n.type === 'account_connected' || n.type === 'risk_elevated')) {
      setOpen(false);
      navigate(`/accounts/${gid}`);
    }
  }, [navigate]);

  const handleMarkAllRead = useCallback(async () => {
    await markAllNotificationsRead().catch(() => {});
    setNotifications((prev) => prev.map((x) => ({ ...x, is_read: true })));
    setUnreadCount(0);
  }, []);

  const shouldPulse = unreadCount > 0 && unreadCount > prevCount;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center rounded-lg transition-colors"
        style={{
          width: 34,
          height: 34,
          color: 'var(--text-muted)',
          background: open ? 'var(--bg-card-hover)' : 'transparent',
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}
      >
        <motion.div
          animate={shouldPulse ? { rotate: [0, -15, 15, -10, 10, 0] } : {}}
          transition={{ duration: 0.5 }}
        >
          <Bell className="w-[18px] h-[18px]" strokeWidth={1.5} />
        </motion.div>
        {unreadCount > 0 && (
          <span
            className="absolute flex items-center justify-center rounded-full text-white font-bold"
            style={{
              top: 4,
              right: 3,
              minWidth: 16,
              height: 16,
              fontSize: 10,
              padding: '0 4px',
              background: '#ef4444',
              lineHeight: 1,
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 z-50 mt-2 rounded-xl overflow-hidden shadow-2xl"
            style={{
              width: 380,
              background: 'var(--bg-dropdown)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: '1px solid var(--border-subtle)' }}
            >
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Уведомления
              </span>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 text-xs transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Прочитать все
                </button>
              )}
            </div>

            {/* List */}
            <div className="overflow-y-auto" style={{ maxHeight: 400 }}>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div
                    className="w-4 h-4 border-2 rounded-full animate-spin"
                    style={{ borderColor: 'var(--border-subtle)', borderTopColor: 'var(--text-muted)' }}
                  />
                </div>
              ) : notifications.length === 0 ? (
                <div className="py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                  Нет уведомлений
                </div>
              ) : (
                notifications.map((n) => {
                  const config = SEVERITY_CONFIG[n.severity] ?? SEVERITY_CONFIG['info']!;
                  const IconComponent = TYPE_ICON[n.type] ?? config.icon;

                  return (
                    <button
                      key={n.id}
                      onClick={() => handleMarkRead(n)}
                      className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors"
                      style={{
                        background: n.is_read ? 'transparent' : 'var(--bg-hover)',
                        borderBottom: '1px solid var(--border-subtle)',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = n.is_read ? 'transparent' : 'var(--bg-hover)')}
                    >
                      {/* Icon */}
                      <div
                        className="flex items-center justify-center flex-shrink-0 rounded-lg"
                        style={{ width: 32, height: 32, background: config.bg }}
                      >
                        <IconComponent
                          className="w-4 h-4"
                          style={{ color: config.color }}
                          strokeWidth={1.5}
                        />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-xs font-medium truncate"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {n.title}
                          </span>
                          {!n.is_read && (
                            <span
                              className="flex-shrink-0 rounded-full"
                              style={{ width: 6, height: 6, background: config.color }}
                            />
                          )}
                        </div>
                        {n.message && (
                          <p
                            className="text-xs mt-0.5 truncate"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {n.message}
                          </p>
                        )}
                        <span
                          className="text-[10px] mt-1 block"
                          style={{ color: 'var(--text-muted)', opacity: 0.7 }}
                        >
                          {timeAgo(n.created_at)}
                        </span>
                      </div>

                      {/* Read check */}
                      {n.is_read && (
                        <Check
                          className="w-3.5 h-3.5 flex-shrink-0 mt-1"
                          style={{ color: 'var(--text-muted)', opacity: 0.4 }}
                        />
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <button
              onClick={() => { setOpen(false); navigate('/notifications'); }}
              className="w-full py-2.5 text-center text-xs font-medium transition-colors"
              style={{
                color: 'var(--text-muted)',
                borderTop: '1px solid var(--border-subtle)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              Все уведомления
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
