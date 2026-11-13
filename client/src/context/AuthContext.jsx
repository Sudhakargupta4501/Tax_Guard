import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onUnauthorized, setCsrfToken } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  const apply = useCallback((data) => {
    setUser(data?.user || null);
    setPermissions(data?.permissions || []);
    setCsrfToken(data?.csrfToken);
  }, []);

  const clear = useCallback(() => apply(null), [apply]);

  // Any 401 from a protected API call means the session is gone: drop local state so routes redirect to /login.
  useEffect(() => {
    onUnauthorized(() => {
      clear();
      setSessionExpired(true);
    });
    return () => onUnauthorized(null);
  }, [clear]);

  // Restore the session from the HTTP-only cookie on first load.
  useEffect(() => {
    let active = true;
    api.get('/auth/me')
      .then((body) => active && apply(body.data))
      .catch(() => active && clear())
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [apply, clear]);

  const login = useCallback(async (email, password) => {
    const body = await api.post('/auth/login', { email, password });
    setSessionExpired(false);
    apply(body.data);
    return body.data.user;
  }, [apply]);

  const register = useCallback(async (payload) => {
    const body = await api.post('/auth/register', payload);
    setSessionExpired(false);
    apply(body.data);
    return body.data.user;
  }, [apply]);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* cookie may already be gone */ }
    clear();
  }, [clear]);

  const refreshUser = useCallback(async () => {
    const body = await api.get('/auth/me');
    apply(body.data);
  }, [apply]);

  const can = useCallback((permission) => permissions.includes(permission), [permissions]);

  const value = useMemo(
    () => ({ user, permissions, loading, sessionExpired, isAuthenticated: Boolean(user), login, register, logout, refreshUser, can }),
    [user, permissions, loading, sessionExpired, login, register, logout, refreshUser, can]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
