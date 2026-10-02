import { afterEach, expect, it, vi } from 'vitest';
import apiClient, {
  demoLogin,
  getDemoLoginStatus,
  getSession,
  login,
  logout,
  register,
} from '../api';

const originalAdapter = apiClient.defaults.adapter;
afterEach(() => {
  apiClient.defaults.adapter = originalAdapter;
  vi.unstubAllGlobals();
});

it('uses credentialed cookie requests for every auth endpoint without reading bearer tokens', async () => {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('Must not read tokens');
    },
  });
  const user = {
    id: 'student-a',
    studentId: 'IT123',
    name: 'Alice',
    email: 'alice@example.test',
    role: 'STUDENT',
  };
  const paths: string[] = [];
  apiClient.defaults.adapter = async (config) => {
    paths.push(config.url ?? '');
    expect(config.withCredentials).toBe(true);
    expect(config.headers.get('Authorization')).toBeUndefined();
    return {
      config,
      status: config.url === '/auth/logout' ? 204 : 200,
      statusText: 'OK',
      headers: {},
      data: {
        success: true,
        data: config.url === '/auth/demo' && config.method === 'get' ? { enabled: true } : { user },
      },
    };
  };
  expect(await getSession()).toEqual(user);
  expect(await login({ email: user.email, password: 'password123' })).toEqual(user);
  expect(
    await register({
      studentId: user.studentId,
      name: user.name,
      email: user.email,
      password: 'password123',
    }),
  ).toEqual(user);
  await logout();
  expect(await getDemoLoginStatus()).toEqual({ enabled: true });
  expect(await demoLogin({ role: 'STUDENT' })).toEqual(user);
  expect(paths).toEqual([
    '/auth/me',
    '/auth/login',
    '/auth/register',
    '/auth/logout',
    '/auth/demo',
    '/auth/demo',
  ]);
});
