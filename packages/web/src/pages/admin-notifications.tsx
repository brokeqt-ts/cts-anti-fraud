import { useState, useEffect, useCallback, type FormEvent } from 'react';
import {
  BellRing,
  Settings2,
  Send,
  History,
  Loader2,
  AlertCircle,
  CheckCircle,
  X,
  ToggleLeft,
  ToggleRight,
  Clock,
  Users,
  User,
  Shield,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  fetchNotificationSettings,
  updateNotificationSetting,
  sendAdminNotification,
  sendTelegramTest,
  fetchNotificationHistory,
  fetchUsers,
  timeAgo,
  type NotificationSettingRow,
  type NotificationHistoryEntry,
  type AdminUser,
} from '../api.js';
import { StaggerContainer, StaggerItem, BlurFade } from '../components/ui/animations.js';

type Tab = 'settings' | 'send' | 'history';

const SEVERITY_COLORS: Record<string, { bg: string; color: string }> = {
  critical: { bg: 'rgba(239,68,68,0.12)', color: '#f87171' },
  warning: { bg: 'rgba(251,191,36,0.12)', color: '#fbbf24' },
  info: { bg: 'rgba(96,165,250,0.12)', color: '#60a5fa' },
  success: { bg: 'rgba(34,197,94,0.12)', color: '#4ade80' },
};

const SEVERITY_OPTIONS = ['info', 'warning', 'critical', 'success'] as const;

// ─── Settings Tab ────────────────────────────────────────────────────────────

function SettingsTab() {
  const [settings, setSettings] = useState<NotificationSettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testingTelegram, setTestingTelegram] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchNotificationSettings();
      setSettings(data.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(t);
  }, [success]);

  async function handleToggle(s: NotificationSettingRow) {
    setSaving(s.key);
    try {
      const res = await updateNotificationSetting(s.key, { enabled: !s.enabled });
      setSettings((prev) => prev.map((x) => (x.key === s.key ? res.setting : x)));
      setSuccess(`${s.label}: ${res.setting.enabled ? 'включено' : 'выключено'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(null);
    }
  }

  async function handleUpdate(key: string, field: string, value: unknown) {
    setSaving(key);
    try {
      const res = await updateNotificationSetting(key, { [field]: value });
      setSettings((prev) => prev.map((x) => (x.key === key ? res.setting : x)));
      setSuccess('Настройка сохранена');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(null);
    }
  }

  async function handleTestTelegram(key: string) {
    setTestingTelegram(key);
    setError(null);
    try {
      await sendTelegramTest(key);
      setSuccess('Тестовое сообщение отправлено в Telegram');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки в Telegram');
    } finally {
      setTestingTelegram(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {error && (
        <BlurFade>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
          >
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
            <button className="ml-auto" onClick={() => setError(null)}><X className="w-3 h-3" /></button>
          </div>
        </BlurFade>
      )}
      {success && (
        <BlurFade>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', color: '#4ade80' }}
          >
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {success}
          </div>
        </BlurFade>
      )}

      {settings.map((s) => (
        <div key={s.key} className="card-static p-[12px_14px] space-y-3">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {s.label}
                </span>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{
                    background: SEVERITY_COLORS[s.severity]?.bg ?? SEVERITY_COLORS['info'].bg,
                    color: SEVERITY_COLORS[s.severity]?.color ?? SEVERITY_COLORS['info'].color,
                  }}
                >
                  {s.severity}
                </span>
              </div>
              {s.description && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {s.description}
                </p>
              )}
            </div>
            <button
              onClick={() => handleToggle(s)}
              disabled={saving === s.key}
              className="flex-shrink-0 ml-3"
              title={s.enabled ? 'Выключить' : 'Включить'}
            >
              {saving === s.key ? (
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-muted)' }} />
              ) : s.enabled ? (
                <ToggleRight className="w-7 h-7" style={{ color: '#4ade80' }} />
              ) : (
                <ToggleLeft className="w-7 h-7" style={{ color: 'var(--text-ghost)' }} />
              )}
            </button>
          </div>

          {/* Settings row */}
          <div className="flex flex-wrap items-center gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {/* Severity */}
            <div className="flex items-center gap-1.5">
              <span style={{ color: 'var(--text-muted)' }}>Severity:</span>
              <select
                value={s.severity}
                onChange={(e) => handleUpdate(s.key, 'severity', e.target.value)}
                className="input-field text-xs py-0.5 px-1.5"
                style={{ minWidth: 90 }}
              >
                {SEVERITY_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>

            {/* Cooldown */}
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
              <span style={{ color: 'var(--text-muted)' }}>Cooldown:</span>
              <input
                type="number"
                min={0}
                value={s.cooldown_minutes}
                onChange={(e) => handleUpdate(s.key, 'cooldown_minutes', parseInt(e.target.value, 10) || 0)}
                className="input-field text-xs py-0.5 px-1.5 w-16 text-center"
              />
              <span style={{ color: 'var(--text-muted)' }}>мин</span>
            </div>

            {/* Recipients */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleUpdate(s.key, 'notify_owner', !s.notify_owner)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors"
                style={{
                  background: s.notify_owner ? 'rgba(34,197,94,0.1)' : 'var(--bg-hover)',
                  color: s.notify_owner ? '#4ade80' : 'var(--text-muted)',
                  border: `1px solid ${s.notify_owner ? 'rgba(34,197,94,0.3)' : 'var(--border-subtle)'}`,
                }}
              >
                <User className="w-3 h-3" />
                Owner
              </button>
              <button
                onClick={() => handleUpdate(s.key, 'notify_admins', !s.notify_admins)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors"
                style={{
                  background: s.notify_admins ? 'rgba(251,191,36,0.1)' : 'var(--bg-hover)',
                  color: s.notify_admins ? '#fbbf24' : 'var(--text-muted)',
                  border: `1px solid ${s.notify_admins ? 'rgba(251,191,36,0.3)' : 'var(--border-subtle)'}`,
                }}
              >
                <Shield className="w-3 h-3" />
                Admins
              </button>
            </div>
          </div>

          {/* Telegram row */}
          <div className="flex flex-wrap items-center gap-3 pt-2 text-xs" style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
            <button
              onClick={() => handleUpdate(s.key, 'telegram_enabled', !s.telegram_enabled)}
              disabled={saving === s.key}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md transition-colors"
              style={{
                background: s.telegram_enabled ? 'rgba(96,165,250,0.1)' : 'var(--bg-hover)',
                color: s.telegram_enabled ? '#60a5fa' : 'var(--text-muted)',
                border: `1px solid ${s.telegram_enabled ? 'rgba(96,165,250,0.3)' : 'var(--border-subtle)'}`,
              }}
            >
              ✈ Telegram
            </button>

            {s.telegram_enabled && (
              <>
                <input
                  type="text"
                  value={s.telegram_chat_id ?? ''}
                  onChange={(e) => handleUpdate(s.key, 'telegram_chat_id', e.target.value || null)}
                  placeholder="Chat ID (напр. -100123456)"
                  className="input-field text-xs py-0.5 px-2"
                  style={{ minWidth: 180 }}
                />
                <button
                  onClick={() => handleTestTelegram(s.key)}
                  disabled={testingTelegram === s.key}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors"
                  style={{
                    background: 'var(--bg-hover)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  {testingTelegram === s.key ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    'Тест'
                  )}
                </button>
              </>
            )}

            {!s.telegram_enabled && (
              <span style={{ color: 'var(--text-ghost)' }}>Telegram выключен</span>
            )}
          </div>
        </div>
      ))}

      {settings.length === 0 && (
        <div className="text-center py-8 text-xs" style={{ color: 'var(--text-muted)' }}>
          Нет настроек уведомлений
        </div>
      )}
    </div>
  );
}

// ─── Send Tab ────────────────────────────────────────────────────────────────

function SendTab() {
  const [target, setTarget] = useState<'all' | 'buyers' | 'admins' | 'user_id'>('all');
  const [userId, setUserId] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical' | 'success'>('info');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  // Load users for dropdown
  const [users, setUsers] = useState<AdminUser[]>([]);
  useEffect(() => {
    fetchUsers().then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), 4000);
    return () => clearTimeout(t);
  }, [result]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const res = await sendAdminNotification({
        target,
        ...(target === 'user_id' ? { user_id: userId } : {}),
        title,
        message,
        severity,
      });
      setResult(`Отправлено: ${res.sent_to} получатель(ей)`);
      setTitle('');
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSend} className="space-y-1.5">
      {/* Target */}
      <div className="card-static p-[12px_14px] space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Users className="w-4 h-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.5} />
          <span className="label-xs">Получатели</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['all', 'buyers', 'admins', 'user_id'] as const).map((t) => {
            const labels: Record<string, string> = { all: 'Все', buyers: 'Байеры', admins: 'Админы', user_id: 'Конкретный' };
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTarget(t)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: target === t ? 'rgba(34,197,94,0.12)' : 'var(--bg-hover)',
                  color: target === t ? '#4ade80' : 'var(--text-secondary)',
                  border: `1px solid ${target === t ? 'rgba(34,197,94,0.3)' : 'var(--border-subtle)'}`,
                }}
              >
                {labels[t]}
              </button>
            );
          })}
        </div>
        {target === 'user_id' && (
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
            className="input-field text-sm mt-2"
          >
            <option value="">Выберите пользователя...</option>
            {users.filter((u) => u.is_active).map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
            ))}
          </select>
        )}
      </div>

      {/* Content */}
      <div className="card-static p-[12px_14px] space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Send className="w-4 h-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.5} />
          <span className="label-xs">Содержание</span>
        </div>

        <div>
          <label className="block label-xs mb-1.5">Заголовок</label>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={500}
            className="input-field text-sm"
            placeholder="Тема уведомления"
          />
        </div>

        <div>
          <label className="block label-xs mb-1.5">Сообщение</label>
          <textarea
            required
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={5000}
            rows={3}
            className="input-field text-sm resize-none"
            placeholder="Текст уведомления"
          />
        </div>

        <div>
          <label className="block label-xs mb-1.5">Важность</label>
          <div className="flex flex-wrap gap-2">
            {SEVERITY_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeverity(s)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: severity === s ? (SEVERITY_COLORS[s]?.bg ?? '') : 'var(--bg-hover)',
                  color: severity === s ? (SEVERITY_COLORS[s]?.color ?? '') : 'var(--text-secondary)',
                  border: `1px solid ${severity === s ? 'transparent' : 'var(--border-subtle)'}`,
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <BlurFade>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
          >
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
            <button className="ml-auto" onClick={() => setError(null)}><X className="w-3 h-3" /></button>
          </div>
        </BlurFade>
      )}
      {result && (
        <BlurFade>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', color: '#4ade80' }}
          >
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {result}
          </div>
        </BlurFade>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={sending}
        className="btn-ghost-green w-full py-2.5 flex items-center justify-center gap-2 text-sm"
      >
        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        {sending ? 'Отправка...' : 'Отправить'}
      </button>
    </form>
  );
}

// ─── History Tab ─────────────────────────────────────────────────────────────

function HistoryTab() {
  const [history, setHistory] = useState<NotificationHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchNotificationHistory(100)
      .then((data) => setHistory(data.history))
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
      >
        <AlertCircle className="w-3.5 h-3.5" /> {error}
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-8 text-xs" style={{ color: 'var(--text-muted)' }}>
        Нет отправленных уведомлений
      </div>
    );
  }

  return (
    <div className="card-static overflow-hidden">
      <table className="w-full text-sm" style={{ color: 'var(--text-secondary)' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <th className="text-left px-4 py-2.5 label-xs font-medium">Заголовок</th>
            <th className="text-left px-4 py-2.5 label-xs font-medium">Сообщение</th>
            <th className="text-center px-4 py-2.5 label-xs font-medium">Severity</th>
            <th className="text-center px-4 py-2.5 label-xs font-medium">Получателей</th>
            <th className="text-right px-4 py-2.5 label-xs font-medium">Когда</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h, i) => {
            const sc = SEVERITY_COLORS[h.severity] ?? SEVERITY_COLORS['info'];
            return (
              <tr
                key={i}
                className="transition-colors"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <td className="px-4 py-2.5">
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{h.title}</span>
                </td>
                <td className="px-4 py-2.5 text-xs max-w-[300px] truncate">{h.message}</td>
                <td className="px-4 py-2.5 text-center">
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full"
                    style={{ background: sc.bg, color: sc.color }}
                  >
                    {h.severity}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-center font-mono text-xs">{h.target_count}</td>
                <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                  {timeAgo(h.sent_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function AdminNotificationsPage() {
  const [tab, setTab] = useState<Tab>('settings');

  const tabs: { id: Tab; label: string; icon: typeof BellRing }[] = [
    { id: 'settings', label: 'Настройки', icon: Settings2 },
    { id: 'send', label: 'Отправить', icon: Send },
    { id: 'history', label: 'История', icon: History },
  ];

  return (
    <StaggerContainer className="py-5 px-6 max-w-3xl space-y-4" staggerDelay={0.06}>
      <StaggerItem>
        <div>
          <h1
            className="text-lg font-semibold tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            Управление уведомлениями
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Автоматические уведомления, ручная рассылка и история
          </p>
        </div>
      </StaggerItem>

      {/* Tabs */}
      <StaggerItem>
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--bg-card)' }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="relative flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors"
              style={{
                color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {tab === t.id && (
                <motion.div
                  layoutId="admin-notif-tab"
                  className="absolute inset-0 rounded-lg"
                  style={{ background: 'var(--bg-card-hover)' }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                <t.icon className="w-3.5 h-3.5" strokeWidth={1.5} />
                {t.label}
              </span>
            </button>
          ))}
        </div>
      </StaggerItem>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
        >
          {tab === 'settings' && <SettingsTab />}
          {tab === 'send' && <SendTab />}
          {tab === 'history' && <HistoryTab />}
        </motion.div>
      </AnimatePresence>
    </StaggerContainer>
  );
}
