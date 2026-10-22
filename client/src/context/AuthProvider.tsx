import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isAxiosError } from 'axios';
import type { AuthUserDTO, DemoLoginDTO, LoginDTO, RegisterDTO } from '@iu-study-planner/shared';
import * as api from '@/lib/api';
import { beginAuthenticationGeneration, onSessionExpired } from '@/lib/sessionExpiry';
import { useAppStore } from '@/lib/store';
import { AuthContext, type AuthContextValue } from './AuthContext';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUserDTO | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [sessionError, setSessionError] = useState<string | null>(null);
  // The session check and the sign-in operations keep separate counters. A
  // session check that answers late must not undo a sign-in that is still
  // running, and a sign-in must not undo a session check that is still running.
  const refreshVersion = useRef(0);
  const authAttempt = useRef(0);
  const authInFlight = useRef(0);
  const expiryPending = useRef(false);
  const currentUserId = useRef<string | null>(null);

  const applyUser = useCallback((nextUser: AuthUserDTO | null) => {
    const nextId = nextUser?.id ?? null;
    if (nextId !== currentUserId.current) {
      // A different account, or no account at all, means every request still in
      // flight belongs to a session that no longer exists. Checking the same
      // account again does not: that request still describes the session in use.
      beginAuthenticationGeneration();
    }
    currentUserId.current = nextId;
    useAppStore.getState().setProgressOwner(nextId);
    setUser(nextUser);
    setSessionError(null);
    setStatus(nextUser ? 'authenticated' : 'unauthenticated');
  }, []);

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    setStatus('loading');
    setSessionError(null);
    try {
      const currentUser = await api.getSession();
      if (version === refreshVersion.current) applyUser(currentUser);
    } catch (error) {
      if (version !== refreshVersion.current) return;
      if (isAxiosError(error) && error.response?.status === 401) {
        applyUser(null);
      } else {
        setStatus('unauthenticated');
        setSessionError(
          'Could not check whether you are signed in. Check your internet connection and try again.',
        );
      }
    }
  }, [applyUser]);

  const invalidatePendingRequests = useCallback(() => {
    // An unmounted provider must not answer for the session any more, and the
    // requests it started belong to the session it started them in. The next
    // refresh is what re-establishes the session; this is not a safety net for
    // detecting an expiry.
    refreshVersion.current++;
    beginAuthenticationGeneration();
  }, []);

  useEffect(() => {
    // Remove the obsolete bearer-token cache; cookies are the only session source.
    try {
      localStorage.removeItem('auth_token');
    } catch {
      // Browser storage may be unavailable; cookie session recovery must still run.
    }
    void refresh();
    return invalidatePendingRequests;
  }, [refresh, invalidatePendingRequests]);

  useEffect(
    () =>
      onSessionExpired(() => {
        // The cookie is no longer accepted, so no authenticated read can succeed.
        // Dropping the local session sends the user through the normal sign-in
        // recovery instead of leaving a panel that offers a pointless reload.
        refreshVersion.current++;
        if (authInFlight.current > 0) {
          // A sign-in that is still running is about to replace the cookie. The
          // refusal belongs to the cookie that is going away, so it must not
          // throw the sign-in away. If that sign-in does not replace the cookie,
          // the refusal is applied then.
          expiryPending.current = true;
          return;
        }
        applyUser(null);
      }),
    [applyUser],
  );

  const runAuthentication = useCallback(
    async <T,>(operation: () => Promise<T>, apply: (result: T) => void) => {
      const attempt = ++authAttempt.current;
      authInFlight.current++;
      // A sign-in that starts replaces the cookie, so every request that is
      // still in flight belongs to the session that is going away.
      beginAuthenticationGeneration();
      try {
        const result = await operation();
        if (attempt === authAttempt.current) {
          // The cookie is new now. A read that was sent before this moment
          // cannot describe the session that is in use, so its refusal must not
          // end it.
          beginAuthenticationGeneration();
          // A session check that is still running belongs to the cookie that is
          // going away, so it must not answer for the session that replaced it.
          refreshVersion.current++;
          expiryPending.current = false;
          apply(result);
        }
      } catch (error) {
        if (attempt === authAttempt.current && expiryPending.current) {
          // A refusal that arrived while the sign-in was running belongs to the
          // cookie that was going away. The sign-in did not replace it, so the
          // session really is gone.
          expiryPending.current = false;
          applyUser(null);
        }
        throw error;
      } finally {
        // Every attempt counts down once, whether it won, lost or failed.
        authInFlight.current--;
        if (authInFlight.current === 0 && expiryPending.current) {
          // No sign-in is running any more and none of them replaced the cookie
          // the refusal belonged to, so the refusal is applied now.
          expiryPending.current = false;
          applyUser(null);
        }
      }
    },
    [applyUser],
  );

  const login = useCallback(
    async (data: LoginDTO) => {
      await runAuthentication(
        () => api.login(data),
        (nextUser) => applyUser(nextUser),
      );
    },
    [runAuthentication, applyUser],
  );

  const register = useCallback(
    async (data: RegisterDTO) => {
      await runAuthentication(
        () => api.register(data),
        (nextUser) => applyUser(nextUser),
      );
    },
    [runAuthentication, applyUser],
  );

  const demoLogin = useCallback(
    async (data: DemoLoginDTO) => {
      await runAuthentication(
        () => api.demoLogin(data),
        (nextUser) => applyUser(nextUser),
      );
    },
    [runAuthentication, applyUser],
  );

  const logout = useCallback(async () => {
    await runAuthentication(
      () => api.logout(),
      () => applyUser(null),
    );
  }, [runAuthentication, applyUser]);

  const value = useMemo(
    () => ({ user, status, sessionError, refresh, login, register, demoLogin, logout }),
    [user, status, sessionError, refresh, login, register, demoLogin, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
