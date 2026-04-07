import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

// --- Types ---

export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
  role: 'admin' | 'buyer';
  api_key?: string | null;
  adspower_api_key?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<string | null>;
}

// --- Storage keys ---

const LS_ACCESS_TOKEN = 'cts_access_token';
const LS_REFRESH_TOKEN = 'cts_refresh_token';
const LS_USER = 'cts_user';

export function getStoredAccessToken(): string | null {
  return localStorage.getItem(LS_ACCESS_TOKEN);
}

export function getStoredRefreshToken(): string | null {
  return localStorage.getItem(LS_REFRESH_TOKEN);
}

function storeTokens(access: string, refresh: string): void {
  localStorage.setItem(LS_ACCESS_TOKEN, access);
  localStorage.setItem(LS_REFRESH_TOKEN, refresh);
}

function storeUser(user: AuthUser): void {
  localStorage.setItem(LS_USER, JSON.stringify(user));
}

function loadUser(): AuthUser | null {
  const raw = localStorage.getItem(LS_USER);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function clearStorage(): void {
  localStorage.removeItem(LS_ACCESS_TOKEN);
  localStorage.removeItem(LS_REFRESH_TOKEN);
  localStorage.removeItem(LS_USER);
}

// --- Context ---

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// --- Provider ---

const API_PREFIX = '/api/v1';

function getBaseUrl(): string {
  return localStorage.getItem('cts_api_url') || import.meta.env.VITE_API_URL || '';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(loadUser);
  const [accessToken, setAccessToken] = useState<string | null>(getStoredAccessToken);
  const [, setRefreshToken] = useState<string | null>(getStoredRefreshToken);
  const [isLoading, setIsLoading] = useState(true);

  const isAuthenticated = !!accessToken && !!user;

  // On mount: validate stored session by fetching /auth/me
  useEffect(() => {
    const token = getStoredAccessToken();
    if (!token) {
      setIsLoading(false);
      return;
    }

    fetch(`${getBaseUrl()}${API_PREFIX}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (res.ok) {
          const data = (await res.json()) as AuthUser;
          setUser(data);
          storeUser(data);
        } else {
          // Try refresh
          const rt = getStoredRefreshToken();
          if (rt) {
            const refreshRes = await fetch(`${getBaseUrl()}${API_PREFIX}/auth/refresh`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh_token: rt }),
            });
            if (refreshRes.ok) {
              const tokens = (await refreshRes.json()) as { access_token: string; refresh_token: string };
              storeTokens(tokens.access_token, tokens.refresh_token);
              setAccessToken(tokens.access_token);
              setRefreshToken(tokens.refresh_token);

              // Re-fetch /me with new token
              const meRes = await fetch(`${getBaseUrl()}${API_PREFIX}/auth/me`, {
                headers: { Authorization: `Bearer ${tokens.access_token}` },
              });
              if (meRes.ok) {
                const data = (await meRes.json()) as AuthUser;
                setUser(data);
                storeUser(data);
              } else {
                clearStorage();
                setUser(null);
                setAccessToken(null);
                setRefreshToken(null);
              }
            } else {
              clearStorage();
              setUser(null);
              setAccessToken(null);
              setRefreshToken(null);
            }
          } else {
            clearStorage();
            setUser(null);
            setAccessToken(null);
            setRefreshToken(null);
          }
        }
      })
      .catch(() => {
        // Network error — keep stored state, user may be offline
      })
      .finally(() => setIsLoading(false));
  // eslint-disable-next-line
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${getBaseUrl()}${API_PREFIX}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, string>;
      throw new Error(body['error'] || `HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      user: AuthUser;
    };

    storeTokens(data.access_token, data.refresh_token);
    storeUser(data.user);
    setAccessToken(data.access_token);
    setRefreshToken(data.refresh_token);
    setUser(data.user);
  }, []);

  const refreshSession = useCallback(async (): Promise<string | null> => {
    const rt = getStoredRefreshToken();
    if (!rt) return null;

    const res = await fetch(`${getBaseUrl()}${API_PREFIX}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    });

    if (!res.ok) {
      clearStorage();
      setUser(null);
      setAccessToken(null);
      setRefreshToken(null);
      return null;
    }

    const data = (await res.json()) as { access_token: string; refresh_token: string };
    storeTokens(data.access_token, data.refresh_token);
    setAccessToken(data.access_token);
    setRefreshToken(data.refresh_token);
    return data.access_token;
  }, []);

  const logout = useCallback(async () => {
    const rt = getStoredRefreshToken();
    const token = getStoredAccessToken();

    // Fire-and-forget server logout
    if (token) {
      fetch(`${getBaseUrl()}${API_PREFIX}/auth/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: rt ? JSON.stringify({ refresh_token: rt }) : '{}',
      }).catch(() => {});
    }

    clearStorage();
    setUser(null);
    setAccessToken(null);
    setRefreshToken(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, accessToken, isAuthenticated, isLoading, login, logout, refreshSession }}
    >
      {children}
    </AuthContext.Provider>
  );
}
