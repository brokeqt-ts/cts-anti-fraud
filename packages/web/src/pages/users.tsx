import { useState, useEffect, useCallback, type FormEvent } from 'react';
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
  TrendingUp,
  TrendingDown,
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
import { TableSkeleton } from '../components/skeleton.js';
import { StaggerContainer, StaggerItem, BlurFade, AnimatedRow } from '../components/ui/animations.js';


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
  const [sortBy, setSortBy] = useState<keyof BuyerPerformance>('total_accounts');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

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

  const handleSort = (col: keyof BuyerPerformance) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const sortedBuyers = [...buyers].sort((a, b) => {
    const av = a[sortBy], bv = b[sortBy];
    const an = typeof av === 'number' ? av : parseFloat(String(av) || '0');
    const bn = typeof bv === 'number' ? bv : parseFloat(String(bv) || '0');
    return sortDir === 'desc' ? bn - an : an - bn;
  });

  const totals = buyers.reduce((t, b) => ({
    accounts: t.accounts + b.total_accounts,
    bans: t.bans + b.total_bans,
    spend: t.spend + parseFloat(b.total_spend || '0'),
    active: t.active + b.active_accounts,
  }), { accounts: 0, bans: 0, spend: 0, active: 0 });

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
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="transition-colors"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
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
                          onClick={() => {
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
                        <button onClick={() => toggleKeyReveal(u.id)} title="Скрыть">
                          <EyeOff className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs font-mono" style={{ color: 'var(--text-ghost)' }}>••••••••</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
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
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                    Нет пользователей
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </StaggerItem>

      {/* Buyer Performance Stats */}
      <StaggerItem>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>Статистика байеров</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Аккаунты, баны и активность по каждому пользователю</p>
          </div>
        </div>

        {/* Summary cards */}
        {!buyersLoading && buyers.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <div className="card-static px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Всего аккаунтов</div>
              <div className="text-lg font-bold font-mono mt-1" style={{ color: 'var(--text-primary)' }}>{totals.accounts}</div>
            </div>
            <div className="card-static px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Активных</div>
              <div className="text-lg font-bold font-mono mt-1" style={{ color: '#4ade80' }}>{totals.active}</div>
            </div>
            <div className="card-static px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Всего банов</div>
              <div className="text-lg font-bold font-mono mt-1" style={{ color: '#f87171' }}>{totals.bans}</div>
            </div>
            <div className="card-static px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Общий spend</div>
              <div className="text-lg font-bold font-mono mt-1" style={{ color: '#60a5fa' }}>${totals.spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>
          </div>
        )}

        <div className="card-static overflow-visible">
          <div className="overflow-x-auto overflow-y-visible">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {([
                    { label: 'Байер', col: 'name', align: 'left' },
                    { label: 'Аккаунты', col: 'total_accounts', align: 'center' },
                    { label: 'Активные', col: 'active_accounts', align: 'center' },
                    { label: 'Баны', col: 'total_bans', align: 'center' },
                    { label: 'Ban rate', col: 'ban_rate', align: 'center' },
                    { label: 'Avg Lifetime', col: 'avg_lifetime_hours', align: 'right' },
                    { label: 'Spend', col: 'total_spend', align: 'right' },
                  ] as Array<{ label: string; col: keyof BuyerPerformance; align: string }>).map(({ label, col, align }) => (
                    <th
                      key={col}
                      className={`px-3 py-2 font-medium label-xs cursor-pointer select-none transition-colors text-${align}`}
                      style={{ color: sortBy === col ? 'var(--text-primary)' : 'var(--text-muted)' }}
                      onClick={() => handleSort(col)}
                    >
                      {label}{sortBy === col && <span className="ml-0.5">{sortDir === 'desc' ? '↓' : '↑'}</span>}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium label-xs" style={{ color: 'var(--text-muted)' }}>Активность</th>
                </tr>
              </thead>
              {buyersLoading ? (
                <tbody><tr><td colSpan={8}><TableSkeleton rows={4} cols={7} /></td></tr></tbody>
              ) : sortedBuyers.length === 0 ? (
                <tbody><tr><td colSpan={8} className="py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</td></tr></tbody>
              ) : (
                <tbody>
                  {sortedBuyers.map((b) => {
                    const banRate = parseFloat(b.ban_rate || '0');
                    const lifetime = parseFloat(b.avg_lifetime_hours || '0');
                    return (
                      <AnimatedRow key={b.user_id} className="cursor-pointer" onClick={() => navigate(`/admin/buyers/${b.user_id}`)}>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col">
                            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{b.name}</span>
                            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{b.email}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="font-mono text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{b.total_accounts}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="font-mono text-xs" style={{ color: '#4ade80' }}>{b.active_accounts}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {b.total_bans > 0
                            ? <span className="font-mono text-xs font-semibold" style={{ color: '#f87171' }}>{b.total_bans}</span>
                            : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>0</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              background: banRate > 50 ? 'rgba(239,68,68,0.1)' : banRate > 20 ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)',
                              color: banRate > 50 ? '#ef4444' : banRate > 20 ? '#f59e0b' : '#22c55e',
                            }}
                          >
                            {banRate > 50 ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                            {banRate}%
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {lifetime > 24 ? `${(lifetime / 24).toFixed(1)}д` : `${lifetime.toFixed(0)}ч`}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                            ${parseFloat(b.total_spend || '0').toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                          {timeAgo(b.last_activity)}
                        </td>
                      </AnimatedRow>
                    );
                  })}
                </tbody>
              )}
            </table>
          </div>
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
