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
  let loginCalls = 0;
  let gradesCalls = 0;
  let sessionChecks = 0;
  let renameNextLogin = false;
  let sessionGate: Gate | null = null;
  const loginGates: Gate[] = [];

  const adapter = async (config: InternalAxiosRequestConfig) => {
    const url = config.url ?? '';
    if (url === '/auth/me') {
      sessionChecks++;
      const pendingSession = sessionGate;
      if (pendingSession) {
        // A held check answers with the cookie that is going away.
        await pendingSession.promise;
        sessionGate = null;
        refused(config);
      }
      if (!signedIn) refused(config);
      return succeeded(config, { success: true, data: { user: signedIn } });
    }
    if (url === '/auth/login') {
      loginCalls++;
      const pending = loginGates.shift();
      if (pending) await pending.promise;
      const body = JSON.parse(String(config.data)) as LoginDTO;
      const account = accounts.get(body.email);
      if (!account) refused(config);
      signedIn = account;
      // A sign-in can report a new id, so a test can see that the sign-in was
      // applied and not merely refused.
      const signedInAccount = renameNextLogin
        ? { ...account, id: `${account.id}-signed-in-again` }
        : account;
      renameNextLogin = false;
      return succeeded(config, { success: true, data: { user: signedInAccount } });
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
      const held = gate();
      loginGates.push(held);
      return held;
    },
    holdSession() {
      sessionGate = gate();
      return sessionGate;
    },
    loginCalls: () => loginCalls,
    renameNextLogin() {
      renameNextLogin = true;
    },
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
    const outcome = await refusedRead;
    expect(outcome).toBeInstanceOf(AxiosError);
    expect((outcome as AxiosError).response?.status).toBe(401);
  });

  it('keeps the account signed in when the same account signs in again while a read is in flight', async () => {
    const backend = await start();
    await signIn('sign in alice', alice.id);

    const released = backend.holdGrades();
    const refusedRead = apiClient.get('/users/me/grades').catch((error: unknown) => error);
    await waitFor(() => expect(backend.gradesCalls()).toBe(1));

    // The same account signs in again without signing out first.
    backend.renameNextLogin();
    const login = backend.holdLogin();
    const loginCalls = backend.loginCalls();
    fireEvent.click(screen.getByRole('button', { name: 'sign in alice' }));
    await waitFor(() => expect(backend.loginCalls()).toBeGreaterThan(loginCalls));

    let outcome: unknown;
    await act(async () => {
      released.open();
      outcome = await refusedRead;
    });

    // The refusal belongs to the session that the sign-in already replaced.
    expect(screen.getByTestId('session')).toHaveTextContent(`authenticated:${alice.id}`);
    expect(outcome).toBeInstanceOf(AxiosError);
    expect((outcome as AxiosError).response?.status).toBe(401);

    await act(async () => {
      login.open();
    });
    // The sign-in that was running is applied when it finishes.
    await screen.findByText(`authenticated:${alice.id}-signed-in-again`);
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

    let outcome: unknown;
    await act(async () => {
      released.open();
      outcome = await refusedRead;
    });

    expect(screen.getByTestId('session')).toHaveTextContent(`authenticated:${alice.id}`);
    expect(outcome).toBeInstanceOf(AxiosError);
    expect((outcome as AxiosError).response?.status).toBe(401);

    await act(async () => {
      login.open();
    });
    await screen.findByText(`authenticated:${bob.id}`);
  });

  it('keeps the sign-in that was in flight when a read is refused in that window', async () => {
    const backend = await start();
    await signIn('sign in alice', alice.id);

    const login = backend.holdLogin();
    const loginCalls = backend.loginCalls();
    fireEvent.click(screen.getByRole('button', { name: 'sign in bob' }));
    await waitFor(() => expect(backend.loginCalls()).toBeGreaterThan(loginCalls));

    // A read that goes out while the sign-in is still running.
    const released = backend.holdGrades();
    const refusedRead = apiClient.get('/users/me/grades').catch((error: unknown) => error);
    await waitFor(() => expect(backend.gradesCalls()).toBe(1));

    let outcome: unknown;
    await act(async () => {
      released.open();
      outcome = await refusedRead;
    });

    // The refusal belongs to the cookie that the sign-in is replacing, so it
    // must not throw the sign-in away.
    expect(screen.getByTestId('session')).toHaveTextContent(`authenticated:${alice.id}`);
    expect(outcome).toBeInstanceOf(AxiosError);
    expect((outcome as AxiosError).response?.status).toBe(401);

    await act(async () => {
      login.open();
    });
    await screen.findByText(`authenticated:${bob.id}`);
  });

  it('ignores a refusal that answers after the sign-in replaced the cookie', async () => {
    const backend = await start();
    await signIn('sign in alice', alice.id);

    // The same account signs in again, so the account identity does not change
    // and only the cookie does.
    const login = backend.holdLogin();
    const loginCalls = backend.loginCalls();
    fireEvent.click(screen.getByRole('button', { name: 'sign in alice' }));
    await waitFor(() => expect(backend.loginCalls()).toBeGreaterThan(loginCalls));

    const released = backend.holdGrades();
    const refusedRead = apiClient.get('/users/me/grades').catch((error: unknown) => error);
    await waitFor(() => expect(backend.gradesCalls()).toBe(1));

    await act(async () => {
      login.open();
    });
    await screen.findByText(`authenticated:${alice.id}`);

    let outcome: unknown;
    await act(async () => {
      released.open();
      outcome = await refusedRead;
    });

    expect(screen.getByTestId('session')).toHaveTextContent(`authenticated:${alice.id}`);
    expect(outcome).toBeInstanceOf(AxiosError);
    expect((outcome as AxiosError).response?.status).toBe(401);
  });

  it('discards a session check that answers after the sign-in completed', async () => {
    const backend = await start();
    const login = backend.holdLogin();
    const loginCalls = backend.loginCalls();
    fireEvent.click(screen.getByRole('button', { name: 'sign in alice' }));
    await waitFor(() => expect(backend.loginCalls()).toBeGreaterThan(loginCalls));

    // A session check that starts while the sign-in is running.
    const check = backend.holdSession();
    const checks = backend.sessionChecks();
    fireEvent.click(screen.getByRole('button', { name: 'check session' }));
    await waitFor(() => expect(backend.sessionChecks()).toBeGreaterThan(checks));

    await act(async () => {
      login.open();
    });
    await screen.findByText(`authenticated:${alice.id}`);

    // The held check answers with the cookie that the sign-in replaced.
    await act(async () => {
      check.open();
    });
    await waitFor(() =>
      expect(screen.getByTestId('session')).toHaveTextContent(`authenticated:${alice.id}`),
    );
  });

  it('ends the session when the sign-in that was running fails after a refusal', async () => {
    const backend = await start();
    await signIn('sign in bob', bob.id);

    // A sign-in that will be refused by the server.
    const login = backend.holdLogin();
    const loginCalls = backend.loginCalls();
    fireEvent.click(screen.getByRole('button', { name: 'sign in unknown' }));
    await waitFor(() => expect(backend.loginCalls()).toBeGreaterThan(loginCalls));

    const released = backend.holdGrades();
    const refusedRead = apiClient.get('/users/me/grades').catch((error: unknown) => error);
    await waitFor(() => expect(backend.gradesCalls()).toBe(1));
    await act(async () => {
      released.open();
      await refusedRead;
    });

    // The refusal belongs to the cookie that the sign-in was going to replace.
    expect(screen.getByTestId('session')).toHaveTextContent(`authenticated:${bob.id}`);

    // The sign-in fails, so the cookie it was going to replace is still dead.
    await act(async () => {
      login.open();
    });
    await screen.findByText('unauthenticated:guest');
  });

  it('applies a refusal after a superseded sign-in was rejected', async () => {
    const backend = await start();
    await signIn('sign in alice', alice.id);

    // Two sign-ins at once; the first is refused by the server.
    const first = backend.holdLogin();
    const second = backend.holdLogin();
    const loginCalls = backend.loginCalls();
    fireEvent.click(screen.getByRole('button', { name: 'sign in unknown' }));
    await waitFor(() => expect(backend.loginCalls()).toBeGreaterThan(loginCalls));
    fireEvent.click(screen.getByRole('button', { name: 'sign in bob' }));
    await waitFor(() => expect(backend.loginCalls()).toBeGreaterThan(loginCalls + 1));

    await act(async () => {
      first.open();
    });
    await act(async () => {
      second.open();
    });
    await screen.findByText(`authenticated:${bob.id}`);

    // A refusal of the session in use still ends it.
    const released = backend.holdGrades();
    const refusedRead = apiClient.get('/users/me/grades').catch((error: unknown) => error);
    await waitFor(() => expect(backend.gradesCalls()).toBe(1));
    await act(async () => {
      released.open();
      await refusedRead;
    });
    await screen.findByText('unauthenticated:guest');
  });

  it('applies a refusal that arrived while an older sign-in was still running', async () => {
    const backend = await start();
    const first = backend.holdLogin();
    const second = backend.holdLogin();
    const loginCalls = backend.loginCalls();
    fireEvent.click(screen.getByRole('button', { name: 'sign in bob' }));
    await waitFor(() => expect(backend.loginCalls()).toBeGreaterThan(loginCalls));
    fireEvent.click(screen.getByRole('button', { name: 'sign in alice' }));
    await waitFor(() => expect(backend.loginCalls()).toBeGreaterThan(loginCalls + 1));

    // The second sign-in completes and replaces the cookie.
    await act(async () => {
      second.open();
    });
    await screen.findByText(`authenticated:${alice.id}`);

    // A refusal of the session in use arrives while the first sign-in runs.
    const released = backend.holdGrades();
    const refusedRead = apiClient.get('/users/me/grades').catch((error: unknown) => error);
    await waitFor(() => expect(backend.gradesCalls()).toBe(1));
    await act(async () => {
      released.open();
      await refusedRead;
    });
    expect(screen.getByTestId('session')).toHaveTextContent(`authenticated:${alice.id}`);

    // The first sign-in settles and reaches the server, so it replaced the
    // cookie the refusal belonged to. The refusal is not applied against it.
    await act(async () => {
      first.open();
    });
    await screen.findByText(`authenticated:${bob.id}`);
  });

  it('ends the session when a refusal arrives after a sign-in failed', async () => {
    const backend = await start();
    await signIn('sign in bob', bob.id);

    // A read that goes out before the sign-in is started.
    const released = backend.holdGrades();
    const refusedRead = apiClient.get('/users/me/grades').catch((error: unknown) => error);
    await waitFor(() => expect(backend.gradesCalls()).toBe(1));

    // The sign-in fails, so the cookie it was going to replace is still dead.
    const login = backend.holdLogin();
    const loginCalls = backend.loginCalls();
    fireEvent.click(screen.getByRole('button', { name: 'sign in unknown' }));
    await waitFor(() => expect(backend.loginCalls()).toBeGreaterThan(loginCalls));

    await act(async () => {
      released.open();
      await refusedRead;
    });
    await act(async () => {
      login.open();
    });

    await screen.findByText('unauthenticated:guest');
  });

  it('does not leave the app loading when a sign-in fails during a session check', async () => {
    const backend = await start();
    const check = backend.holdSession();
    const checks = backend.sessionChecks();
    fireEvent.click(screen.getByRole('button', { name: 'check session' }));
    await waitFor(() => expect(backend.sessionChecks()).toBeGreaterThan(checks));

    const loginCalls = backend.loginCalls();
    fireEvent.click(screen.getByRole('button', { name: 'sign in unknown' }));
    await waitFor(() => expect(backend.loginCalls()).toBeGreaterThan(loginCalls));

    await act(async () => {
      check.open();
    });
    await waitFor(() => expect(screen.getByTestId('session')).not.toHaveTextContent('loading:'));
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
    const outcome = await refusedRead;
    expect(outcome).toBeInstanceOf(AxiosError);
    expect((outcome as AxiosError).response?.status).toBe(401);
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

    let outcome: unknown;
    await act(async () => {
      released.open();
      outcome = await refusedRead;
    });

    expect(screen.getByTestId('session')).toHaveTextContent('unauthenticated:guest');
    expect(outcome).toBeInstanceOf(AxiosError);
    expect((outcome as AxiosError).response?.status).toBe(401);
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
    const outcome = await refusedRead;
    expect(outcome).toBeInstanceOf(AxiosError);
    expect((outcome as AxiosError).response?.status).toBe(401);
  });
});
