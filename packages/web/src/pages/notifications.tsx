import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, CheckCheck, AlertTriangle, Info, ShieldAlert, ShieldCheck, Link2, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  timeAgo,
  type Notification,
} from '../api.js';
import { downloadCsv } from '../utils/csv.js';
import { DateRangePicker, type DateRange } from '../components/date-range-picker.js';
import { BlurFade } from '../components/ui/animations.js';

const PAGE_SIZE = 20;

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; icon: typeof Bell; label: string }> = {
  critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.10)', icon: ShieldAlert, label: 'Критичные' },
  warning: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', icon: AlertTriangle, label: 'Предупреждения' },
  info: { color: '#3b82f6', bg: 'rgba(59,130,246,0.10)', icon: Info, label: 'Информация' },
  success: { color: '#22c55e', bg: 'rgba(34,197,94,0.10)', icon: ShieldCheck, label: 'Успешные' },
};

const TYPE_ICON: Record<string, typeof Bell> = {
  account_connected: Link2,
};

const TYPE_LABELS: Record<string, string> = {
  ban_detected: 'Бан',
  ban_resolved: 'Бан снят',
  risk_elevated: 'Риск',
  account_connected: 'Подключение',
  system: 'Система',
};

type FilterMode = 'all' | 'unread' | 'critical' | 'warning' | 'info' | 'success';

export function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null });
  const navigate = useNavigate();

  const load = useCallback(() => {
    setLoading(true);
    fetchNotifications({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      unread_only: filter === 'unread',
      from_date: dateRange.from ?? undefined,
      to_date: dateRange.to ?? undefined,
    })
      .then((r) => {
        let filtered = r.notifications;
        if (filter !== 'all' && filter !== 'unread') {
          filtered = filtered.filter((n) => n.severity === filter);
        }
        setNotifications(filtered);
        setTotal(r.total);
        setUnreadCount(r.unread_count);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, filter, dateRange]);

  useEffect(() => { load(); }, [load]);

  const handleMarkRead = useCallback(async (n: Notification) => {
    if (!n.is_read) {
      await markNotificationRead(n.id).catch(() => {});
      setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, is_read: true } : x));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    const gid = n.metadata?.['account_google_id'] as string | undefined;
    if (gid && (n.type === 'ban_detected' || n.type === 'account_connected' || n.type === 'risk_elevated')) {
      navigate(`/accounts/${gid}`);
    }
  }, [navigate]);

  const handleMarkAllRead = useCallback(async () => {
    await markAllNotificationsRead().catch(() => {});
    setNotifications((prev) => prev.map((x) => ({ ...x, is_read: true })));
    setUnreadCount(0);
  }, []);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const filters: { key: FilterMode; label: string }[] = [
    { key: 'all', label: 'Все' },
    { key: 'unread', label: `Непрочитанные (${unreadCount})` },
    { key: 'critical', label: 'Критичные' },
    { key: 'warning', label: 'Предупреждения' },
    { key: 'info', label: 'Инфо' },
    { key: 'success', label: 'Успешные' },
  ];

  return (
    <div className="px-8 py-8">
      <BlurFade>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center rounded-xl"
              style={{ width: 40, height: 40, background: 'rgba(59,130,246,0.10)' }}
            >
              <Bell className="w-5 h-5" style={{ color: '#3b82f6' }} strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Уведомления
              </h1>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {total} всего, {unreadCount} непрочитанных
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const headers = ['Заголовок', 'Сообщение', 'Тип', 'Важность', 'Прочитана', 'Дата'];
                const rows = notifications.map((n) => [
                  n.title,
                  n.message ?? '',
                  TYPE_LABELS[n.type] ?? n.type,
                  n.severity,
                  n.is_read ? 'да' : 'нет',
                  new Date(n.created_at).toLocaleString('ru-RU'),
                ]);
                downloadCsv(`notifications_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: '#818cf8' }}
              title="Экспорт в CSV"
            >
              <Download className="w-3.5 h-3.5" />
              Скачать CSV
            </button>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ color: 'var(--text-muted)', background: 'var(--bg-hover)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Прочитать все
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1 mb-4 flex-wrap">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => { setFilter(f.key); setPage(0); }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                background: filter === f.key ? 'var(--bg-card-hover)' : 'transparent',
                color: filter === f.key ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
              onMouseEnter={(e) => {
                if (filter !== f.key) e.currentTarget.style.background = 'var(--bg-hover)';
              }}
              onMouseLeave={(e) => {
                if (filter !== f.key) e.currentTarget.style.background = 'transparent';
              }}
            >
              {f.label}
            </button>
          ))}
          <div className="ml-auto">
            <DateRangePicker value={dateRange} onChange={(r) => { setDateRange(r); setPage(0); }} />
          </div>
        </div>

        {/* List */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
        >
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div
                className="w-5 h-5 border-2 rounded-full animate-spin"
                style={{ borderColor: 'var(--border-subtle)', borderTopColor: 'var(--text-muted)' }}
              />
            </div>
          ) : notifications.length === 0 ? (
            <div className="py-16 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Нет уведомлений
            </div>
          ) : (
            notifications.map((n) => {
              const config = SEVERITY_CONFIG[n.severity] ?? SEVERITY_CONFIG['info']!;
              const IconComponent = TYPE_ICON[n.type] ?? config.icon;
              const typeLabel = TYPE_LABELS[n.type] ?? n.type;

              return (
                <button
                  key={n.id}
                  onClick={() => handleMarkRead(n)}
                  className="w-full flex items-start gap-4 px-5 py-4 text-left transition-colors"
                  style={{
                    background: n.is_read ? 'transparent' : 'var(--bg-hover)',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = n.is_read ? 'transparent' : 'var(--bg-hover)')}
                >
                  <div
                    className="flex items-center justify-center flex-shrink-0 rounded-lg mt-0.5"
                    style={{ width: 36, height: 36, background: config.bg }}
                  >
                    <IconComponent className="w-4 h-4" style={{ color: config.color }} strokeWidth={1.5} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {n.title}
                      </span>
                      {!n.is_read && (
                        <span
                          className="flex-shrink-0 rounded-full"
                          style={{ width: 7, height: 7, background: config.color }}
                        />
                      )}
                    </div>
                    {n.message && (
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                        {n.message}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5">
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: config.bg, color: config.color }}
                      >
                        {typeLabel}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>
                        {timeAgo(n.created_at)}
                      </span>
                    </div>
                  </div>

                  {n.is_read && (
                    <Check
                      className="w-4 h-4 flex-shrink-0 mt-1"
                      style={{ color: 'var(--text-muted)', opacity: 0.3 }}
                    />
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1.5 rounded-lg transition-colors disabled:opacity-30"
              style={{ color: 'var(--text-muted)' }}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="p-1.5 rounded-lg transition-colors disabled:opacity-30"
              style={{ color: 'var(--text-muted)' }}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </BlurFade>
    </div>
  );
}
