import { useState, useCallback, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle,
  XCircle,
  Loader2,
  Settings2,
  Copy,
  Check,
  Eye,
  EyeOff,
  Lock,
  Download,
  MessageCircle,
  Unlink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getApiUrl,
  getApiKey,
  setApiUrl,
  setApiKey,
  checkHealth,
  downloadExtension,
  changeMyPassword,
  fetchTelegramBotInfo,
  startTelegramConnect,
  fetchTelegramConnectStatus,
  disconnectTelegram,
  type HealthCheck,
  type TelegramConnectStatus,
} from '../api.js';
import { useAuth } from '../contexts/auth-context.js';
import { StaggerContainer, StaggerItem, BlurFade } from '../components/ui/animations.js';

function LegacySettingsForm() {
  const [url, setUrl] = useState(getApiUrl());
  const [key, setKey] = useState(getApiKey());
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const navigate = useNavigate();

  async function handleTest() {
    setChecking(true);
    setError(null);
    setHealth(null);
    setApiUrl(url);
    setApiKey(key);
    try {
      const h = await checkHealth();
      setHealth(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Соединение не удалось');
    } finally {
      setChecking(false);
    }
  }

  function handleSave(e: FormEvent) {
    e.preventDefault();
    setApiUrl(url);
    setApiKey(key);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      navigate('/');
    }, 800);
  }

  return (
    <>
      <StaggerItem>
        <form onSubmit={handleSave} className="card-static p-[12px_14px] space-y-5">
          <div>
            <label className="block label-xs mb-2">URL сервера</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://cts-api.example.com (или пусто для текущего хоста)"
              className="input-field font-mono text-sm"
            />
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Оставьте пустым если фронтенд и API на одном хосте
            </p>
          </div>

          <div>
            <label className="block label-xs mb-2">API ключ</label>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Введите API ключ"
              className="input-field font-mono text-sm"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button type="submit" className="btn-ghost-green flex-1 py-2.5">
              {saved ? 'Сохранено!' : 'Сохранить'}
            </button>
            <button
              type="button"
              onClick={handleTest}
              disabled={checking}
              className="px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                background: 'var(--bg-hover)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-medium)',
              }}
            >
              {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Тест'}
            </button>
          </div>
        </form>
      </StaggerItem>

      {(health || error) && (
        <BlurFade>
          <div className="card-static p-[12px_14px]">
            {health ? (
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <div>
                  <p className="text-sm font-medium" style={{ color: '#4ade80' }}>Подключено</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    БД: {health.database.connected ? 'подключена' : 'отключена'}
                    {health.database.latency_ms != null && ` · ${health.database.latency_ms}мс`}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <XCircle className="w-5 h-5 text-red-500" />
                <div>
                  <p className="text-sm font-medium" style={{ color: '#f87171' }}>Ошибка соединения</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{error}</p>
                </div>
              </div>
            )}
          </div>
        </BlurFade>
      )}
    </>
  );
}

function TelegramConnectCard() {
  const [status, setStatus] = useState<TelegramConnectStatus | null>(null);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [botConfigured, setBotConfigured] = useState<boolean | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load bot info and current status on mount
  useEffect(() => {
    fetchTelegramBotInfo()
      .then((info) => {
        setBotConfigured(info.configured);
        setBotUsername(info.bot_username);
      })
      .catch(() => setBotConfigured(false));

    fetchTelegramConnectStatus()
      .then(setStatus)
      .catch(() => {/* ignore */});

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      const res = await startTelegramConnect();
      setCode(res.code);
      if (res.bot_username) setBotUsername(res.bot_username);

      // Start polling for status every 2 seconds
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const s = await fetchTelegramConnectStatus();
          setStatus(s);
          if (s.connected) {
            setCode(null);
            setConnecting(false);
            if (pollRef.current) clearInterval(pollRef.current);
          }
        } catch {
          // ignore polling errors
        }
      }, 2000);

      // Auto-stop polling after 10 minutes
      setTimeout(() => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setConnecting(false);
        setCode(null);
      }, 600_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка подключения');
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    setError(null);
    try {
      await disconnectTelegram();
      setStatus({ connected: false, telegram_chat_id: null, pending: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отключения');
    } finally {
      setDisconnecting(false);
    }
  }

  // Don't render if bot is not configured
  if (botConfigured === false) return null;
  if (botConfigured === null) return null; // loading

  return (
    <StaggerItem>
      <div className="card-static p-[12px_14px] space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle
              className="w-4 h-4"
              style={{ color: 'var(--text-muted)' }}
              strokeWidth={1.5}
            />
            <span className="label-xs">Telegram</span>
          </div>
          {status?.connected && (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80' }}
            >
              Подключён
            </span>
          )}
        </div>

        {status?.connected ? (
          // Connected state
          <div className="space-y-2">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Chat ID: <code className="font-mono">{status.telegram_chat_id}</code>
            </p>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg transition-colors"
              style={{
                background: 'rgba(239,68,68,0.08)',
                color: '#f87171',
                border: '1px solid rgba(239,68,68,0.2)',
              }}
            >
              {disconnecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Unlink className="w-3.5 h-3.5" />
              )}
              Отключить Telegram
            </button>
          </div>
        ) : code ? (
          // Pending code state
          <div className="space-y-3">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Отправьте этот код боту{' '}
              {botUsername ? (
                <a
                  href={`https://t.me/${botUsername}?start=${code}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium"
                  style={{ color: '#60a5fa' }}
                >
                  @{botUsername}
                </a>
              ) : (
                'в Telegram'
              )}
              :
            </p>
            <div
              className="flex items-center justify-center py-3 rounded-lg font-mono text-2xl tracking-[0.3em] font-bold select-all"
              style={{
                background: 'var(--bg-hover)',
                color: '#4ade80',
                border: '1px solid var(--border-medium)',
              }}
            >
              {code}
            </div>
            <div className="flex items-center gap-2">
              <Loader2
                className="w-3.5 h-3.5 animate-spin"
                style={{ color: 'var(--text-muted)' }}
              />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Ожидание подтверждения... Код действует 10 минут.
              </span>
            </div>
            {botUsername && (
              <a
                href={`https://t.me/${botUsername}?start=${code}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-center py-2 text-sm font-medium rounded-lg transition-colors"
                style={{
                  background: 'rgba(96,165,250,0.08)',
                  color: '#60a5fa',
                  border: '1px solid rgba(96,165,250,0.2)',
                }}
              >
                Открыть @{botUsername}
              </a>
            )}
          </div>
        ) : (
          // Disconnected state
          <div className="space-y-2">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Привяжите Telegram для получения уведомлений о банах и рисках.
            </p>
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg transition-colors"
              style={{
                background: 'rgba(96,165,250,0.08)',
                color: '#60a5fa',
                border: '1px solid rgba(96,165,250,0.2)',
              }}
            >
              {connecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <MessageCircle className="w-3.5 h-3.5" />
              )}
              Подключить Telegram
            </button>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-xs" style={{ color: '#f87171' }}>
            <XCircle className="w-3.5 h-3.5" /> {error}
          </div>
        )}
      </div>
    </StaggerItem>
  );
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  buyer: 'Байер',
};

export function SettingsPage() {
  const { user, isAuthenticated } = useAuth();

  const [keyVisible, setKeyVisible] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);

  // Extension download
  const [extState, setExtState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [extError, setExtError] = useState<string | null>(null);

  // Password change form
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  const handleDownloadExtension = useCallback(async () => {
    if (extState === 'loading') return;
    setExtState('loading');
    setExtError(null);
    try {
      await downloadExtension();
      setExtState('success');
      setTimeout(() => setExtState('idle'), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка скачивания';
      setExtError(msg);
      setExtState('error');
      setTimeout(() => setExtState('idle'), 2000);
    }
  }, [extState]);

  function handleCopyKey() {
    if (!user?.api_key) return;
    navigator.clipboard.writeText(user.api_key).then(() => {
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    });
  }

  async function handlePasswordChange(e: FormEvent) {
    e.preventDefault();
    setPwLoading(true);
    setPwError(null);
    setPwSuccess(false);
    try {
      await changeMyPassword(currentPassword, newPassword);
      setPwSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setTimeout(() => setShowPasswordForm(false), 1500);
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Ошибка смены пароля');
    } finally {
      setPwLoading(false);
    }
  }

  return (
    <StaggerContainer className="py-5 px-6 max-w-xl space-y-1.5" staggerDelay={0.06}>
      <StaggerItem>
        <h1
          className="text-lg font-semibold tracking-tight mb-[14px]"
          style={{ color: 'var(--text-primary)' }}
        >
          Настройки
        </h1>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {isAuthenticated ? 'Профиль и безопасность' : 'Подключение к CTS Anti-Fraud API'}
        </p>
      </StaggerItem>

      {isAuthenticated && user ? (
        <>
          {/* Profile card */}
          <StaggerItem>
            <div className="card-static p-[12px_14px] space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <Settings2
                  className="w-4 h-4"
                  style={{ color: 'var(--text-muted)' }}
                  strokeWidth={1.5}
                />
                <span className="label-xs">Профиль</span>
              </div>

              <div className="space-y-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <div className="flex items-center justify-between">
                  <span className="label-xs" style={{ color: 'var(--text-muted)' }}>Имя</span>
                  <span style={{ color: 'var(--text-primary)' }}>{user.name}</span>
                </div>
                {user.email && (
                  <div className="flex items-center justify-between">
                    <span className="label-xs" style={{ color: 'var(--text-muted)' }}>Email</span>
                    <span className="font-mono text-xs">{user.email}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="label-xs" style={{ color: 'var(--text-muted)' }}>Роль</span>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background:
                        user.role === 'admin'
                          ? 'rgba(251,191,36,0.12)'
                          : 'rgba(96,165,250,0.12)',
                      color: user.role === 'admin' ? '#fbbf24' : '#60a5fa',
                    }}
                  >
                    {ROLE_LABELS[user.role] ?? user.role}
                  </span>
                </div>
              </div>
            </div>
          </StaggerItem>

          {/* API key card */}
          {user.api_key && (
            <StaggerItem>
              <div className="card-static p-[12px_14px] space-y-3">
                <span className="label-xs" style={{ color: 'var(--text-muted)' }}>
                  API ключ
                </span>
                <div className="flex items-center gap-2">
                  <code
                    className="flex-1 text-xs font-mono break-all"
                    style={{ color: keyVisible ? '#4ade80' : 'var(--text-ghost)' }}
                  >
                    {keyVisible ? user.api_key : '••••••••••••••••••••••••'}
                  </code>
                  <button
                    onClick={() => setKeyVisible((v) => !v)}
                    className="p-1.5 rounded-lg transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    title={keyVisible ? 'Скрыть' : 'Показать'}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = 'var(--bg-hover)')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = 'transparent')
                    }
                  >
                    {keyVisible ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={handleCopyKey}
                    className="p-1.5 rounded-lg transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    title="Скопировать"
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = 'var(--bg-hover)')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = 'transparent')
                    }
                  >
                    {keyCopied ? (
                      <Check className="w-4 h-4" style={{ color: '#4ade80' }} />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </StaggerItem>
          )}

          {/* Extension download */}
          <StaggerItem>
            <div className="card-static p-[12px_14px] space-y-3">
              <div className="flex items-center gap-2">
                <Download
                  className="w-4 h-4"
                  style={{ color: 'var(--text-muted)' }}
                  strokeWidth={1.5}
                />
                <span className="label-xs">Chrome расширение</span>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Скачайте расширение с вашим API ключом. Распакуйте и загрузите в антидетект браузер через chrome://extensions.
              </p>
              <motion.button
                onClick={handleDownloadExtension}
                disabled={extState === 'loading'}
                className="relative w-full py-2 flex items-center justify-center gap-2 text-sm font-medium rounded-lg overflow-hidden"
                animate={{
                  background:
                    extState === 'success'
                      ? 'rgba(34,197,94,0.15)'
                      : extState === 'error'
                        ? 'rgba(239,68,68,0.12)'
                        : 'rgba(34,197,94,0.06)',
                  borderColor:
                    extState === 'success'
                      ? 'rgba(34,197,94,0.5)'
                      : extState === 'error'
                        ? 'rgba(239,68,68,0.4)'
                        : extState === 'loading'
                          ? 'rgba(34,197,94,0.4)'
                          : 'rgba(34,197,94,0.15)',
                  color:
                    extState === 'success'
                      ? '#4ade80'
                      : extState === 'error'
                        ? '#f87171'
                        : '#4ade80',
                }}
                transition={{ duration: 0.3 }}
                style={{ border: '1px solid' }}
              >
                {extState === 'loading' && (
                  <motion.div
                    className="absolute inset-0 rounded-lg"
                    style={{ border: '2px solid rgba(34,197,94,0.5)' }}
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
                <AnimatePresence mode="wait">
                  <motion.span
                    key={extState}
                    className="flex items-center gap-2"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                  >
                    {extState === 'loading' && (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Подготовка...
                      </>
                    )}
                    {extState === 'success' && (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        Скачано!
                      </>
                    )}
                    {extState === 'error' && (
                      <>
                        <XCircle className="w-4 h-4" />
                        {extError ?? 'Ошибка'}
                      </>
                    )}
                    {extState === 'idle' && (
                      <>
                        <Download className="w-4 h-4" />
                        Скачать расширение
                      </>
                    )}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
            </div>
          </StaggerItem>

          {/* Telegram Connect */}
          <TelegramConnectCard />

          {/* Security */}
          <StaggerItem>
            <div className="card-static p-[12px_14px] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lock
                    className="w-4 h-4"
                    style={{ color: 'var(--text-muted)' }}
                    strokeWidth={1.5}
                  />
                  <span className="label-xs">Безопасность</span>
                </div>
                {!showPasswordForm && (
                  <button
                    onClick={() => setShowPasswordForm(true)}
                    className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                    style={{
                      background: 'var(--bg-hover)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-medium)',
                    }}
                  >
                    Сменить пароль
                  </button>
                )}
              </div>

              {showPasswordForm && (
                <form onSubmit={handlePasswordChange} className="space-y-3 pt-1">
                  <div>
                    <label className="block label-xs mb-1.5">Текущий пароль</label>
                    <input
                      required
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="input-field text-sm"
                    />
                  </div>
                  <div>
                    <label className="block label-xs mb-1.5">Новый пароль</label>
                    <input
                      required
                      type="password"
                      minLength={8}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="input-field text-sm"
                      placeholder="Минимум 8 символов"
                    />
                  </div>

                  {pwError && (
                    <div
                      className="flex items-center gap-2 text-xs"
                      style={{ color: '#f87171' }}
                    >
                      <XCircle className="w-3.5 h-3.5" /> {pwError}
                    </div>
                  )}
                  {pwSuccess && (
                    <div
                      className="flex items-center gap-2 text-xs"
                      style={{ color: '#4ade80' }}
                    >
                      <CheckCircle className="w-3.5 h-3.5" /> Пароль изменён
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={pwLoading}
                      className="btn-ghost-green flex-1 py-2 flex items-center justify-center gap-2 text-sm"
                    >
                      {pwLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                      Сменить
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowPasswordForm(false);
                        setPwError(null);
                        setPwSuccess(false);
                        setCurrentPassword('');
                        setNewPassword('');
                      }}
                      className="px-4 py-2 rounded-lg text-sm"
                      style={{
                        background: 'var(--bg-hover)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-medium)',
                      }}
                    >
                      Отмена
                    </button>
                  </div>
                </form>
              )}
            </div>
          </StaggerItem>
        </>
      ) : (
        <LegacySettingsForm />
      )}

      {/* Info */}
      <StaggerItem>
        <div className="card-static p-[12px_14px]">
          <div className="flex items-center gap-2 mb-3">
            <Settings2
              className="w-4 h-4"
              style={{ color: 'var(--text-muted)' }}
              strokeWidth={1.5}
            />
            <span className="label-xs">Информация</span>
          </div>
          <div className="space-y-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            <p>
              API URL: <span className="font-mono">{getApiUrl() || '(текущий хост)'}</span>
            </p>
          </div>
        </div>
      </StaggerItem>
    </StaggerContainer>
  );
}
