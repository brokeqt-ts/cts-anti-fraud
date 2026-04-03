import { useState, useEffect, useCallback, useMemo, type FormEvent, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users as UsersIcon,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle,
  Trash2,
  KeyRound,
  EyeOff,
  Lock,
  X,
  Copy,
  Check,
  Download,
  XCircle,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  fetchUsers,
  createUser,
  updateUser,
  deleteUser,
  resetUserApiKey,
  changeUserPassword,
  downloadExtensionForUser,
  fetchBuyerPerformance,
  type AdminUser,
  type CreateUserRequest,
  type UpdateUserRequest,
  type BuyerPerformance,
  timeAgo,
} from '../api.js';
import { useAuth } from '../contexts/auth-context.js';
import { StaggerContainer, StaggerItem, BlurFade } from '../components/ui/animations.js';


type ModalMode = 'create' | 'edit' | 'password' | null;

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Buyer performance stats
  const [buyers, setBuyers] = useState<BuyerPerformance[]>([]);
  const [buyersLoading, setBuyersLoading] = useState(true);

  // Expand state
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  // Modal state
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<'admin' | 'buyer'>('buyer');
  const [formActive, setFormActive] = useState(true);
  const [formScope, setFormScope] = useState<'full' | 'collect_only'>('collect_only');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // API key reveal + copy
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [extStates, setExtStates] = useState<Record<string, 'idle' | 'loading' | 'success' | 'error'>>({});

  const load = useCallback(async () => {
    try {
      const data = await fetchUsers();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetchBuyerPerformance()
      .then((d) => setBuyers(d.buyers))
      .catch(() => {})
      .finally(() => setBuyersLoading(false));
  }, []);

  const buyersMap = useMemo(
    () => Object.fromEntries(buyers.map((b) => [b.user_id, b])),
    [buyers],
  );

  // Auto-clear success messages
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(timer);
  }, [success]);

  function openCreate() {
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setFormRole('buyer');
    setFormError(null);
    setModalMode('create');
    setSelectedUser(null);
  }

  function openEdit(u: AdminUser) {
    setFormName(u.name);
    setFormEmail(u.email);
    setFormRole(u.role);
    setFormActive(u.is_active);
    setFormScope(u.api_key_scope);
    setFormError(null);
    setModalMode('edit');
    setSelectedUser(u);
  }

  function openPassword(u: AdminUser) {
    setFormPassword('');
    setFormError(null);
    setModalMode('password');
    setSelectedUser(u);
  }

  function closeModal() {
    setModalMode(null);
    setSelectedUser(null);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormLoading(true);
    setFormError(null);
    try {
      const payload: CreateUserRequest = { name: formName, email: formEmail, password: formPassword, role: formRole };
      const { user: newUser } = await createUser(payload);
      setRevealedKeys((prev) => ({ ...prev, [newUser.id]: newUser.api_key ?? '' }));
      setSuccess(`Пользователь ${newUser.name} создан. API ключ показан в таблице.`);
      closeModal();
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Ошибка создания');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault();
    if (!selectedUser) return;
    setFormLoading(true);
    setFormError(null);
    try {
      const payload: UpdateUserRequest = {
        name: formName,
        email: formEmail,
        role: formRole,
        is_active: formActive,
        api_key_scope: formScope,
      };
      await updateUser(selectedUser.id, payload);
      setSuccess(`Пользователь ${formName} обновлён`);
      closeModal();
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Ошибка обновления');
    } finally {
      setFormLoading(false);
    }
  }

  async function handlePasswordChange(e: FormEvent) {
    e.preventDefault();
    if (!selectedUser) return;
    setFormLoading(true);
    setFormError(null);
    try {
      await changeUserPassword(selectedUser.id, formPassword);
      setSuccess(`Пароль для ${selectedUser.name} изменён`);
      closeModal();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Ошибка смены пароля');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDelete(u: AdminUser) {
    if (!confirm(`Деактивировать пользователя ${u.name}?`)) return;
    try {
      await deleteUser(u.id);
      setSuccess(`${u.name} деактивирован`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления');
    }
  }

  async function handleResetKey(u: AdminUser) {
    if (!confirm(`Сбросить API ключ для ${u.name}? Старый ключ перестанет работать.`)) return;
    try {
      const result = await resetUserApiKey(u.id);
      setRevealedKeys((prev) => ({ ...prev, [u.id]: result.api_key }));
      setSuccess(`API ключ для ${u.name} сброшен. Новый ключ показан в таблице.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сброса ключа');
    }
  }

  function toggleKeyReveal(userId: string) {
    setRevealedKeys((prev) => {
      const copy = { ...prev };
      if (copy[userId]) {
        delete copy[userId];
      }
      return copy;
    });
  }

  async function handleDownloadExt(u: AdminUser) {
    const current = extStates[u.id];
    if (current === 'loading') return;
    setExtStates((prev) => ({ ...prev, [u.id]: 'loading' }));
    try {
      await downloadExtensionForUser(u.id);
      setExtStates((prev) => ({ ...prev, [u.id]: 'success' }));
      setTimeout(() => setExtStates((prev) => ({ ...prev, [u.id]: 'idle' })), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка скачивания расширения');
      setExtStates((prev) => ({ ...prev, [u.id]: 'error' }));
      setTimeout(() => setExtStates((prev) => ({ ...prev, [u.id]: 'idle' })), 2000);
    }
  }

  const isSelf = (u: AdminUser) => u.id === currentUser?.id;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    );
  }

  return (
    <StaggerContainer className="py-5 px-6 space-y-4" staggerDelay={0.06}>
      {/* Header */}
      <StaggerItem>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Пользователи
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Управление учётными записями и API ключами
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={openCreate} className="btn-ghost-green flex items-center gap-2 py-2 px-3 text-sm">
              <Plus className="w-4 h-4" />
              Добавить
            </button>
          </div>
        </div>
      </StaggerItem>

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

      {/* Table */}
      <StaggerItem>
        <div className="card-static overflow-hidden">
          <table className="w-full text-sm" style={{ color: 'var(--text-secondary)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th className="w-8 px-3 py-2.5"></th>
                <th className="text-left px-4 py-2.5 label-xs font-medium">Имя</th>
                <th className="text-left px-4 py-2.5 label-xs font-medium">Email</th>
                <th className="text-left px-4 py-2.5 label-xs font-medium">Роль</th>
                <th className="text-left px-4 py-2.5 label-xs font-medium">Scope</th>
                <th className="text-left px-4 py-2.5 label-xs font-medium">Статус</th>
                <th className="text-left px-4 py-2.5 label-xs font-medium">API ключ</th>
                <th className="text-right px-4 py-2.5 label-xs font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isExpanded = expandedUserId === u.id;
                const b = buyersMap[u.id];
                return (
                  <Fragment key={u.id}>
                    <tr
                      className="transition-colors cursor-pointer"
                      style={{ borderBottom: isExpanded ? 'none' : '1px solid var(--border-subtle)' }}
                      onClick={() => setExpandedUserId(isExpanded ? null : u.id)}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = isExpanded ? 'var(--bg-hover)' : 'transparent')}
                    >
                      <td className="px-3 py-2.5 text-center">
                        <motion.div
                          animate={{ rotate: isExpanded ? 90 : 0 }}
                          transition={{ duration: 0.15 }}
                          style={{ display: 'inline-flex' }}
                        >
                          <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                        </motion.div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span style={{ color: 'var(--text-primary)' }} className="font-medium">{u.name}</span>
                        {isSelf(u) && (
                          <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.1)', color: '#4ade80' }}>
                            вы
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">{u.email}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            background: u.role === 'admin' ? 'rgba(251,191,36,0.12)' : 'rgba(96,165,250,0.12)',
                            color: u.role === 'admin' ? '#fbbf24' : '#60a5fa',
                          }}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono">{u.api_key_scope}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            background: u.is_active ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                            color: u.is_active ? '#4ade80' : '#f87171',
                          }}
                        >
                          {u.is_active ? 'активен' : 'отключён'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {revealedKeys[u.id] ? (
                          <div className="flex items-center gap-1.5">
                            <code className="text-xs font-mono break-all" style={{ color: '#4ade80', maxWidth: 180 }}>
                              {revealedKeys[u.id]}
                            </code>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(revealedKeys[u.id]).then(() => {
                                  setCopiedKey(u.id);
                                  setTimeout(() => setCopiedKey(null), 2000);
                                });
                              }}
                              title="Скопировать"
                              className="p-0.5 rounded transition-colors"
                              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                            >
                              {copiedKey === u.id
                                ? <Check className="w-3.5 h-3.5" style={{ color: '#4ade80' }} />
                                : <Copy className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleKeyReveal(u.id); }}
                              title="Скрыть"
                            >
                              <EyeOff className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs font-mono" style={{ color: 'var(--text-ghost)' }}>••••••••</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => openEdit(u)}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: 'var(--text-muted)' }}
                            title="Редактировать"
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <UsersIcon className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => openPassword(u)}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: 'var(--text-muted)' }}
                            title="Сменить пароль"
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <Lock className="w-3.5 h-3.5" />
                          </button>
                          <motion.button
                            onClick={() => handleDownloadExt(u)}
                            disabled={(extStates[u.id] ?? 'idle') === 'loading' || !u.is_active}
                            className="p-1.5 rounded-lg transition-colors relative"
                            title="Скачать расширение"
                            animate={{
                              color:
                                (extStates[u.id] ?? 'idle') === 'success'
                                  ? '#4ade80'
                                  : (extStates[u.id] ?? 'idle') === 'error'
                                    ? '#f87171'
                                    : undefined,
                              background:
                                (extStates[u.id] ?? 'idle') === 'success'
                                  ? 'rgba(34,197,94,0.1)'
                                  : (extStates[u.id] ?? 'idle') === 'error'
                                    ? 'rgba(239,68,68,0.1)'
                                    : 'transparent',
                            }}
                            transition={{ duration: 0.3 }}
                            style={{ color: 'var(--text-muted)' }}
                            onMouseEnter={(e) => {
                              const st = extStates[u.id] ?? 'idle';
                              if (st === 'idle') e.currentTarget.style.background = 'var(--bg-hover)';
                            }}
                            onMouseLeave={(e) => {
                              const st = extStates[u.id] ?? 'idle';
                              if (st === 'idle') e.currentTarget.style.background = 'transparent';
                            }}
                          >
                            {(extStates[u.id] ?? 'idle') === 'loading' && (
                              <motion.div
                                className="absolute inset-0 rounded-lg"
                                style={{ border: '1.5px solid rgba(34,197,94,0.5)' }}
                                animate={{ opacity: [0.3, 1, 0.3] }}
                                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                              />
                            )}
                            <AnimatePresence mode="wait">
                              <motion.span
                                key={extStates[u.id] ?? 'idle'}
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.8 }}
                                transition={{ duration: 0.15 }}
                              >
                                {(extStates[u.id] ?? 'idle') === 'loading' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                {(extStates[u.id] ?? 'idle') === 'success' && <CheckCircle className="w-3.5 h-3.5" />}
                                {(extStates[u.id] ?? 'idle') === 'error' && <XCircle className="w-3.5 h-3.5" />}
                                {(extStates[u.id] ?? 'idle') === 'idle' && <Download className="w-3.5 h-3.5" />}
                              </motion.span>
                            </AnimatePresence>
                          </motion.button>
                          <button
                            onClick={() => handleResetKey(u)}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: 'var(--text-muted)' }}
                            title="Сбросить API ключ"
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>
                          {!isSelf(u) && (
                            <button
                              onClick={() => handleDelete(u)}
                              className="p-1.5 rounded-lg transition-colors"
                              style={{ color: 'var(--text-muted)' }}
                              title="Деактивировать"
                              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.1)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.tr
                          key={`${u.id}-expanded`}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          style={{ borderBottom: '1px solid var(--border-subtle)' }}
                        >
                          <td colSpan={8} style={{ padding: 0 }}>
                            <motion.div
                              initial={{ height: 0 }}
                              animate={{ height: 'auto' }}
                              exit={{ height: 0 }}
                              transition={{ duration: 0.2, ease: 'easeInOut' }}
                              style={{ overflow: 'hidden' }}
                            >
                              <div
                                className="px-6 py-4"
                                style={{ background: 'var(--bg-hover)', borderTop: '1px solid var(--border-subtle)' }}
                              >
                                {buyersLoading ? (
                                  <div className="flex items-center gap-2">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--text-muted)' }} />
                                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Загрузка статистики...</span>
                                  </div>
                                ) : !b ? (
                                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Нет данных по байеру</span>
                                ) : (
                                  <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                                    <ExpandStat label="Аккаунты" value={String(b.total_accounts)} />
                                    <ExpandStat label="Активные" value={String(b.active_accounts)} color="#4ade80" />
                                    <ExpandStat label="Забанено" value={String(b.suspended_accounts)} color="#f87171" />
                                    <ExpandStat label="Баны" value={String(b.total_bans)} color={b.total_bans > 0 ? '#f87171' : undefined} />
                                    <ExpandStat
                                      label="Ban rate"
                                      value={`${parseFloat(b.ban_rate || '0').toFixed(1)}%`}
                                      color={parseFloat(b.ban_rate || '0') > 50 ? '#ef4444' : parseFloat(b.ban_rate || '0') > 20 ? '#f59e0b' : '#22c55e'}
                                    />
                                    <ExpandStat
                                      label="Avg Lifetime"
                                      value={(() => { const h = parseFloat(b.avg_lifetime_hours || '0'); return h > 24 ? `${(h / 24).toFixed(1)}д` : `${h.toFixed(0)}ч`; })()}
                                    />
                                    <ExpandStat
                                      label="Spend"
                                      value={`$${parseFloat(b.total_spend || '0').toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                                      color="#60a5fa"
                                    />
                                    <div className="ml-auto flex items-center gap-4">
                                      {b.last_activity && (
                                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                          Активность: {timeAgo(b.last_activity)}
                                        </span>
                                      )}
                                      <button
                                        onClick={() => navigate(`/admin/buyers/${u.id}`)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                                        style={{
                                          background: 'rgba(99,102,241,0.1)',
                                          color: '#818cf8',
                                          border: '1px solid rgba(99,102,241,0.2)',
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(99,102,241,0.2)')}
                                        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(99,102,241,0.1)')}
                                      >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                        Открыть подробнее
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          </td>
                        </motion.tr>
                      )}
                    </AnimatePresence>
                  </Fragment>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                    Нет пользователей
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </StaggerItem>

      {/* Modal overlay */}
      {modalMode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="card-static w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            {/* Create */}
            {modalMode === 'create' && (
              <form onSubmit={handleCreate} className="space-y-4">
                <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Новый пользователь
                </h2>

                <div>
                  <label className="block label-xs mb-1.5">Имя</label>
                  <input
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="input-field text-sm"
                    placeholder="Иван Иванов"
                  />
                </div>
                <div>
                  <label className="block label-xs mb-1.5">Email</label>
                  <input
                    required
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="input-field text-sm"
                    placeholder="user@example.com"
                  />
                </div>
                <div>
                  <label className="block label-xs mb-1.5">Пароль</label>
                  <input
                    required
                    type="password"
                    minLength={8}
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    className="input-field text-sm"
                    placeholder="Минимум 8 символов"
                  />
                </div>
                <div>
                  <label className="block label-xs mb-1.5">Роль</label>
                  <select
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value as 'admin' | 'buyer')}
                    className="w-full px-3 py-2.5 rounded-lg text-sm"
                    style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
                  >
                    <option value="buyer">Buyer</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>

                {formError && (
                  <div className="flex items-center gap-2 text-xs" style={{ color: '#f87171' }}>
                    <AlertCircle className="w-3.5 h-3.5" /> {formError}
                  </div>
                )}

                <div className="flex gap-3 pt-1">
                  <button type="submit" disabled={formLoading} className="btn-ghost-green flex-1 py-2.5 flex items-center justify-center gap-2">
                    {formLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                    Создать
                  </button>
                  <button type="button" onClick={closeModal} className="px-4 py-2.5 rounded-lg text-sm" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)' }}>
                    Отмена
                  </button>
                </div>
              </form>
            )}

            {/* Edit */}
            {modalMode === 'edit' && selectedUser && (
              <form onSubmit={handleEdit} className="space-y-4">
                <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Редактирование: {selectedUser.name}
                </h2>

                <div>
                  <label className="block label-xs mb-1.5">Имя</label>
                  <input required value={formName} onChange={(e) => setFormName(e.target.value)} className="input-field text-sm" />
                </div>
                <div>
                  <label className="block label-xs mb-1.5">Email</label>
                  <input required type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} className="input-field text-sm" />
                </div>
                <div>
                  <label className="block label-xs mb-1.5">Роль</label>
                  <select
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value as 'admin' | 'buyer')}
                    className="w-full px-3 py-2.5 rounded-lg text-sm"
                    style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
                    disabled={isSelf(selectedUser)}
                  >
                    <option value="buyer">Buyer</option>
                    <option value="admin">Admin</option>
                  </select>
                  {isSelf(selectedUser) && (
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Нельзя менять свою роль</p>
                  )}
                </div>
                <div>
                  <label className="block label-xs mb-1.5">API Key Scope</label>
                  <select
                    value={formScope}
                    onChange={(e) => setFormScope(e.target.value as 'full' | 'collect_only')}
                    className="w-full px-3 py-2.5 rounded-lg text-sm"
                    style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
                  >
                    <option value="full">full</option>
                    <option value="collect_only">collect_only</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formActive}
                    onChange={(e) => setFormActive(e.target.checked)}
                    id="is_active"
                    disabled={isSelf(selectedUser)}
                  />
                  <label htmlFor="is_active" className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Активен
                  </label>
                  {isSelf(selectedUser) && (
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>(нельзя деактивировать себя)</span>
                  )}
                </div>

                {formError && (
                  <div className="flex items-center gap-2 text-xs" style={{ color: '#f87171' }}>
                    <AlertCircle className="w-3.5 h-3.5" /> {formError}
                  </div>
                )}

                <div className="flex gap-3 pt-1">
                  <button type="submit" disabled={formLoading} className="btn-ghost-green flex-1 py-2.5 flex items-center justify-center gap-2">
                    {formLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                    Сохранить
                  </button>
                  <button type="button" onClick={closeModal} className="px-4 py-2.5 rounded-lg text-sm" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)' }}>
                    Отмена
                  </button>
                </div>
              </form>
            )}

            {/* Password */}
            {modalMode === 'password' && selectedUser && (
              <form onSubmit={handlePasswordChange} className="space-y-4">
                <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Сменить пароль: {selectedUser.name}
                </h2>

                <div>
                  <label className="block label-xs mb-1.5">Новый пароль</label>
                  <input
                    required
                    type="password"
                    minLength={8}
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    className="input-field text-sm"
                    placeholder="Минимум 8 символов"
                  />
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  После смены пароля все сессии пользователя будут завершены.
                </p>

                {formError && (
                  <div className="flex items-center gap-2 text-xs" style={{ color: '#f87171' }}>
                    <AlertCircle className="w-3.5 h-3.5" /> {formError}
                  </div>
                )}

                <div className="flex gap-3 pt-1">
                  <button type="submit" disabled={formLoading} className="btn-ghost-green flex-1 py-2.5 flex items-center justify-center gap-2">
                    {formLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                    Сменить
                  </button>
                  <button type="button" onClick={closeModal} className="px-4 py-2.5 rounded-lg text-sm" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)' }}>
                    Отмена
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </StaggerContainer>
  );
}

function ExpandStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="text-sm font-bold font-mono mt-0.5" style={{ color: color ?? 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}
