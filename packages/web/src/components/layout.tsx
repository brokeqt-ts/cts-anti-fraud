import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, ShieldBan, Globe, Settings, Plus, Shield, Link2, BarChart3, ShieldCheck, Brain, LogOut, UserCog, Bell, BellRing, BookOpen, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback } from 'react';
import { AnimatedThemeToggler } from './ui/animated-theme-toggler.js';
import { NotificationBell } from './notification-bell.js';
import { CommandPalette, openCommandPalette } from './command-palette.js';
import { ToastNotifications } from './toast-notifications.js';
import { useNotificationStream } from '../hooks/use-notification-stream.js';
import { useAuth } from '../contexts/auth-context.js';

const baseNavItems = [
  { to: '/', label: 'Дашборд', icon: LayoutDashboard },
  { to: '/accounts', label: 'Аккаунты', icon: Users },
  { to: '/assessment', label: 'Оценка рисков', icon: ShieldCheck },
  { to: '/analytics', label: 'Аналитика', icon: BarChart3 },
  { to: '/ai-analysis', label: 'AI Анализ', icon: Brain },
  { to: '/best-practices', label: 'Методички', icon: BookOpen },
  { to: '/bans', label: 'Баны', icon: ShieldBan },
  { to: '/domains', label: 'Домены', icon: Globe },
  { to: '/cts', label: 'CTS Интеграция', icon: Link2 },
  { to: '/notifications', label: 'Уведомления', icon: Bell },
  { to: '/settings', label: 'Настройки', icon: Settings },
];

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { lastNotification } = useNotificationStream();

  const navItems = user?.role === 'admin'
    ? [...baseNavItems.slice(0, -1), { to: '/users', label: 'Пользователи', icon: UserCog }, { to: '/admin/notifications', label: 'Упр. уведомлениями', icon: BellRing }, baseNavItems[baseNavItems.length - 1]]
    : baseNavItems;

  const handleLogout = useCallback(async () => {
    await logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar — 64px, near-invisible bg */}
      <motion.aside
        className="group/sidebar flex-shrink-0 flex flex-col overflow-hidden"
        initial={false}
        animate={{ width: 64 }}
        whileHover={{ width: 220 }}
        transition={{ duration: 0.2, ease: [0.25, 0.4, 0.25, 1] }}
        style={{
          background: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--border-subtle)',
        }}
      >
        {/* Brand */}
        <div
          className="flex items-center px-4 overflow-hidden"
          style={{ height: 64, borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: 'rgba(34,197,94,0.12)',
            }}
          >
            <Shield className="w-4 h-4 text-green-500" strokeWidth={1.5} />
          </div>
          <span
            className="ml-3 text-sm font-semibold whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200"
            style={{ color: 'var(--text-primary)' }}
          >
            CTS Anti-Fraud
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className="relative flex items-center h-[34px] px-3 rounded-xl overflow-hidden transition-colors"
              style={({ isActive }) => ({
                background: isActive ? 'var(--bg-card-hover)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
              })}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.div
                      layoutId="sidebar-active"
                      className="absolute left-0 top-2 bottom-2 rounded-full"
                      style={{ width: 2, background: 'var(--accent-green)' }}
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                  <motion.div whileHover={{ scale: 1.1 }} transition={{ duration: 0.15 }}>
                    <item.icon className="w-[18px] h-[18px] flex-shrink-0" strokeWidth={1.5} />
                  </motion.div>
                  <span className="ml-3 text-sm font-medium whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200">
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Quick action + logout */}
        <div className="px-2 pb-4 space-y-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <button
            onClick={() => navigate('/bans/new')}
            className="btn-ghost-green flex items-center w-full h-[34px] mt-3 overflow-hidden"
            style={{ padding: '0 12px', fontSize: 13 }}
          >
            <Plus className="w-[18px] h-[18px] flex-shrink-0" strokeWidth={1.5} />
            <span className="ml-3 font-medium whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200">
              Записать бан
            </span>
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center w-full h-[34px] px-3 rounded-xl overflow-hidden transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <LogOut className="w-[18px] h-[18px] flex-shrink-0" strokeWidth={1.5} />
            <span className="ml-3 text-sm font-medium whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200">
              Выйти
            </span>
          </button>
        </div>
      </motion.aside>

      {/* Main */}
      <main className="flex-1 overflow-auto" style={{ background: 'var(--bg-base)' }}>
        {/* Top bar with user info + demo toggle */}
        <div
          className="flex items-center justify-end gap-3 px-8"
          style={{
            height: 48,
            borderBottom: '1px solid var(--bg-hover)',
          }}
        >
          {user && (
            <div className="flex items-center gap-2 mr-auto">
              <div
                className="flex items-center justify-center flex-shrink-0 rounded-full text-xs font-semibold"
                style={{
                  width: 26,
                  height: 26,
                  background: user.role === 'admin' ? 'rgba(251,191,36,0.12)' : 'rgba(96,165,250,0.12)',
                  color: user.role === 'admin' ? '#fbbf24' : '#60a5fa',
                }}
              >
                {user.name.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                {user.name}
              </span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full"
                style={{
                  background: user.role === 'admin' ? 'rgba(251,191,36,0.12)' : 'rgba(96,165,250,0.12)',
                  color: user.role === 'admin' ? '#fbbf24' : '#60a5fa',
                }}
              >
                {user.role}
              </span>
            </div>
          )}
          <button
            onClick={openCommandPalette}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all hover:scale-[1.02]"
            style={{
              color: 'var(--text-primary)',
              background: 'rgba(99,102,241,0.12)',
              border: '1px solid rgba(99,102,241,0.3)',
              minWidth: 160,
            }}
            title="Поиск"
          >
            <Search className="w-4 h-4" style={{ color: '#818cf8' }} />
            <span>Поиск...</span>
          </button>
          <NotificationBell />
          <AnimatedThemeToggler />
        </div>

        <div className="max-w-7xl mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      <CommandPalette />
      <ToastNotifications notification={lastNotification} />
    </div>
  );
}
