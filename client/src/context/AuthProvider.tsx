import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isAxiosError } from 'axios';
import type { AuthUserDTO, LoginDTO, RegisterDTO } from '@iu-study-planner/shared';
import * as api from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { AuthContext, type AuthContextValue } from './AuthContext';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUserDTO | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [sessionError, setSessionError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const applyUser = useCallback((nextUser: AuthUserDTO | null) => {
    useAppStore.getState().setProgressOwner(nextUser?.id ?? null);
    setUser(nextUser);
    setSessionError(null);
    setStatus(nextUser ? 'authenticated' : 'unauthenticated');
  }, []);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setStatus('loading');
    setSessionError(null);
    try {
      const currentUser = await api.getSession();
      if (version === requestVersion.current) applyUser(currentUser);
    } catch (error) {
      if (version !== requestVersion.current) return;
      if (isAxiosError(error) && error.response?.status === 401) {
        applyUser(null);
      } else {
        setStatus('unauthenticated');
        setSessionError(
          'Could not check your session. Check that the server is running and try again.',
        );
      }
    }
  }, [applyUser]);

  const invalidatePendingRequests = useCallback(() => {
    requestVersion.current++;
  }, []);

  useEffect(() => {
    // Remove the obsolete bearer-token cache; cookies are the only session source.
    localStorage.removeItem('auth_token');
    void refresh();
    return invalidatePendingRequests;
  }, [refresh, invalidatePendingRequests]);

  const login = useCallback(
    async (data: LoginDTO) => {
      const version = ++requestVersion.current;
      const nextUser = await api.login(data);
      if (version === requestVersion.current) applyUser(nextUser);
    },
    [applyUser],
  );

  const register = useCallback(
    async (data: RegisterDTO) => {
      const version = ++requestVersion.current;
      const nextUser = await api.register(data);
      if (version === requestVersion.current) applyUser(nextUser);
    },
    [applyUser],
  );

  const logout = useCallback(async () => {
    const version = ++requestVersion.current;
    await api.logout();
    if (version === requestVersion.current) applyUser(null);
  }, [applyUser]);

  const value = useMemo(
    () => ({ user, status, sessionError, refresh, login, register, logout }),
    [user, status, sessionError, refresh, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
