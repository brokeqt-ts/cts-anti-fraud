import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Shield, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/auth-context.js';
import { BlurFade } from '../components/ui/animations.js';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: string })?.from || '/';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--bg-base)' }}
    >
      <BlurFade>
        <div className="w-full max-w-sm space-y-6">
          {/* Logo */}
          <div className="flex flex-col items-center gap-3">
            <div
              className="flex items-center justify-center"
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: 'rgba(34,197,94,0.12)',
              }}
            >
              <Shield className="w-6 h-6 text-green-500" strokeWidth={1.5} />
            </div>
            <div className="text-center">
              <h1
                className="text-lg font-semibold tracking-tight"
                style={{ color: 'var(--text-primary)' }}
              >
                CTS Anti-Fraud
              </h1>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Войдите в систему
              </p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="card-static p-5 space-y-4">
            <div>
              <label className="block label-xs mb-1.5">Email</label>
              <input
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                className="input-field text-sm"
              />
            </div>

            <div>
              <label className="block label-xs mb-1.5">Пароль</label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Введите пароль"
                className="input-field text-sm"
              />
            </div>

            {error && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                style={{
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  color: '#f87171',
                }}
              >
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-ghost-green w-full py-2.5 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Вход...' : 'Войти'}
            </button>
          </form>

          <p
            className="text-center text-xs"
            style={{ color: 'var(--text-ghost)' }}
          >
            Внутренняя система мониторинга
          </p>
        </div>
      </BlurFade>
    </div>
  );
}
