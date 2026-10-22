import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthUserDTO, LoginDTO } from '@iu-study-planner/shared';
import apiClient from '@/lib/api';
import { useAuth } from '../AuthContext';
import { AuthProvider } from '../AuthProvider';

const originalAdapter = apiClient.defaults.adapter;

const alice: AuthUserDTO = {
  id: 'alice-id',
  studentId: 'IT001',
  name: 'Alice',
  email: 'alice@example.test',
  role: 'STUDENT',
  curriculumId: null,
};

const bob: AuthUserDTO = {
  id: 'bob-id',
  studentId: 'IT002',
  name: 'Bob',
  email: 'bob@example.test',
  role: 'STUDENT',
  curriculumId: null,
};

interface Gate {
  promise: Promise<void>;
  open: () => void;
}

function gate(): Gate {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

function succeeded(config: InternalAxiosRequestConfig, data: unknown): AxiosResponse {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

function refused(config: InternalAxiosRequestConfig): never {
  const response: AxiosResponse = {
    data: { success: false, error: 'Authentication required' },
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config,
  };
  throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, undefined, response);
}

function createBackend() {
  const accounts = new Map<string, AuthUserDTO>([
    [alice.email, alice],
    [bob.email, bob],
  ]);
  let signedIn: AuthUserDTO | null = null;
  let gradesGate: Gate | null = null;
  let loginGate: Gate | null = null;
  let loginCalls = 0;
  let gradesCalls = 0;
  let sessionChecks = 0;

  const adapter = async (config: InternalAxiosRequestConfig) => {
    const url = config.url ?? '';
    if (url === '/auth/me') {
      sessionChecks++;
      if (!signedIn) refused(config);
      return succeeded(config, { success: true, data: { user: signedIn } });
    }
    if (url === '/auth/login') {
      loginCalls++;
      const pending = loginGate;
      if (pending) await pending.promise;
      const body = JSON.parse(String(config.data)) as LoginDTO;
      const account = accounts.get(body.email);
      if (!account) refused(config);
      signedIn = account;
      return succeeded(config, { success: true, data: { user: account } });
    }
    if (url === '/auth/logout') {
      signedIn = null;
      return succeeded(config, { success: true, data: null });
    }
    if (url === '/users/me/grades') {
      gradesCalls++;
      const pending = gradesGate;
      if (pending) {
        await pending.promise;
        refused(config);
      }
      return succeeded(config, { success: true, data: null });
    }
    throw new AxiosError(`Unexpected request ${url}`, 'ERR_BAD_REQUEST', config);
  };

  return {
    adapter,
    account: () => signedIn,
    holdGrades() {
      gradesGate = gate();
      return gradesGate;
    },
    holdLogin() {
      loginGate = gate();
      return loginGate;
    },
    loginCalls: () => loginCalls,
    gradesCalls: () => gradesCalls,
    sessionChecks: () => sessionChecks,
  };
}

function SessionControls() {
  const { user, status, login, logout, refresh } = useAuth();
  const signIn = (email: string) => {
    login({ email, password: 'correct-horse' }).catch(() => {});
  };
  return (
    <>
      <output data-testid="session">
        {status}:{user?.id ?? 'guest'}
      </output>
      <button onClick={() => signIn(alice.email)}>sign in alice</button>
      <button onClick={() => signIn(bob.email)}>sign in bob</button>
      <button onClick={() => signIn('unknown@example.test')}>sign in unknown</button>
      <button onClick={() => void logout().catch(() => {})}>sign out</button>
      <button onClick={() => void refresh()}>check session</button>
    </>
  );
}

async function start() {
  const backend = createBackend();
  apiClient.defaults.adapter = backend.adapter;
  render(
    <AuthProvider>
      <SessionControls />
    </AuthProvider>,
  );
  await screen.findByText('unauthenticated:guest');
  return backend;
}

async function signIn(label: string, expected: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
  await screen.findByText(`authenticated:${expected}`);
}

async function signOut() {
  fireEvent.click(screen.getByRole('button', { name: 'sign out' }));
  await screen.findByText('unauthenticated:guest');
}

afterEach(() => {
  cleanup();
  apiClient.defaults.adapter = originalAdapter;
});

describe('a refused protected read during session changes', () => {
  it('leaves the account that signed in after the read was sent intact', async () => {
    const backend = await start();
    await signIn('sign in alice', alice.id);

    const released = backend.holdGrades();
    const refusedRead = apiClient.get('/users/me/grades').catch((error: unknown) => error);
    await waitFor(() => expect(backend.gradesCalls()).toBe(1));

    await signOut();
    await signIn('sign in bob', bob.id);

    let outcome: unknown;
    await act(async () => {
      released.open();
      outcome = await refusedRead;
    });

    expect(screen.getByTestId('session')).toHaveTextContent(`authenticated:${bob.id}`);
    expect(backend.account()).toBe(bob);
    // The refusal still belongs to the caller that asked for the read.
    expect(outcome).toBeInstanceOf(AxiosError);
    expect((outcome as AxiosError).response?.status).toBe(401);
  });

  it('leaves the same account signed in again after the read was sent intact', async () => {
    const backend = await start();
    await signIn('sign in alice', alice.id);

    const released = backend.holdGrades();
    const refusedRead = apiClient.get('/users/me/grades').catch((error: unknown) => error);
    await waitFor(() => expect(backend.gradesCalls()).toBe(1));

    await signOut();
    await signIn('sign in alice', alice.id);

    await act(async () => {
      released.open();
      await refusedRead;
    });

    expect(screen.getByTestId('session')).toHaveTextContent(`authenticated:${alice.id}`);
  });

  it('lets the sign-in in progress finish when the read was sent before it', async () => {
    const backend = await start();
    await signIn('sign in alice', alice.id);

    const released = backend.holdGrades();
    const refusedRead = apiClient.get('/users/me/grades').catch((error: unknown) => error);
    await waitFor(() => expect(backend.gradesCalls()).toBe(1));

    const login = backend.holdLogin();
    const loginCalls = backend.loginCalls();
    fireEvent.click(screen.getByRole('button', { name: 'sign in bob' }));
    await waitFor(() => expect(backend.loginCalls()).toBeGreaterThan(loginCalls));

    await act(async () => {
      released.open();
      await refusedRead;
    });

    expect(screen.getByTestId('session')).toHaveTextContent(`authenticated:${alice.id}`);

    await act(async () => {
      login.open();
    });
    await screen.findByText(`authenticated:${bob.id}`);
  });

  it('still ends the current session when its own protected read is refused', async () => {
    const backend = await start();
    await signIn('sign in bob', bob.id);

    const released = backend.holdGrades();
    const refusedRead = apiClient.get('/users/me/grades').catch((error: unknown) => error);
    await waitFor(() => expect(backend.gradesCalls()).toBe(1));

    await act(async () => {
      released.open();
      await refusedRead;
    });

    expect(screen.getByTestId('session')).toHaveTextContent('unauthenticated:guest');
  });

  it('keeps the current account when a sign-in attempt is refused', async () => {
    const backend = await start();
    await signIn('sign in bob', bob.id);

    const loginCalls = backend.loginCalls();
    fireEvent.click(screen.getByRole('button', { name: 'sign in unknown' }));
    await waitFor(() => expect(backend.loginCalls()).toBeGreaterThan(loginCalls));

    expect(screen.getByTestId('session')).toHaveTextContent(`authenticated:${bob.id}`);
  });

  it('ends the session when the cookie the read was sent under is refused, even after the account was checked again', async () => {
    const backend = await start();
    await signIn('sign in bob', bob.id);

    const released = backend.holdGrades();
    const refusedRead = apiClient.get('/users/me/grades').catch((error: unknown) => error);
    await waitFor(() => expect(backend.gradesCalls()).toBe(1));

    // The account is checked again and it is the same account, so the read that
    // is in flight still describes the session in use.
    const checks = backend.sessionChecks();
    fireEvent.click(screen.getByRole('button', { name: 'check session' }));
    await waitFor(() => expect(backend.sessionChecks()).toBeGreaterThan(checks));

    await act(async () => {
      released.open();
      await refusedRead;
    });

    expect(screen.getByTestId('session')).toHaveTextContent('unauthenticated:guest');
  });

  it('stays signed out when a read sent before the sign-out is refused', async () => {
    const backend = await start();
    await signIn('sign in bob', bob.id);

    const released = backend.holdGrades();
    const refusedRead = apiClient.get('/users/me/grades').catch((error: unknown) => error);
    await waitFor(() => expect(backend.gradesCalls()).toBe(1));

    await signOut();

    await act(async () => {
      released.open();
      await refusedRead;
    });

    expect(screen.getByTestId('session')).toHaveTextContent('unauthenticated:guest');
  });
});
