// Auth state hook. Wraps /api/auth/me so any component can know who is signed
// in, whether GitHub OAuth is configured, and refresh after connect/login.
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [configured, setConfigured] = useState(true);
  const [mode, setMode] = useState('local');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const { user, configured, mode } = await api.me();
      setUser(user || null);
      setConfigured(!!configured);
      setMode(mode || 'local');
      setError(null);
      return user;
    } catch (e) {
      setError(e.message);
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback((returnTo = '#/app') => {
    // Full-page navigation into the OAuth flow.
    window.location.href = api.loginUrl(returnTo);
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch {}
    setUser(null);
  }, []);

  return { user, setUser, configured, mode, loading, error, refresh, login, logout };
}
