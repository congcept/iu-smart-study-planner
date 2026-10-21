import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUserDTO } from '@iu-study-planner/shared';
import App from '@/App';
import * as api from '@/lib/api';
import { useAppStore } from '@/lib/store';

vi.mock('@/lib/api', () => ({
  healthCheck: vi.fn(),
  getSession: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  getDemoLoginStatus: vi.fn(),
  demoLogin: vi.fn(),
}));

// The guarded pages are not what this file is about; keep them out of the tree.
vi.mock('@/features/curriculum/CurriculumProgressMap', () => ({
  CurriculumProgressMap: () => <div>demo curriculum</div>,
}));
vi.mock('@/features/curriculum/AccountCurriculum', () => ({
  AccountCurriculum: () => <div>my curriculum</div>,
}));
vi.mock('@/features/grades/GradeDashboard', () => ({
  GradeDashboard: () => <div>grades</div>,
}));
vi.mock('@/features/ratings/RatingDashboard', () => ({
  RatingDashboard: () => <div>ratings</div>,
}));
vi.mock('@/features/planner/PlannerDashboard', () => ({
  PlannerDashboard: () => <div>planner</div>,
}));
vi.mock('@/features/admin/AdminResourceDashboard', () => ({
  AdminResourceDashboard: () => <div>admin</div>,
}));

const student: AuthUserDTO = {
  id: 'student-a',
  studentId: 'IT123',
  name: 'Alice Student',
  email: 'alice@example.test',
  role: 'STUDENT',
  curriculumId: null,
};

const httpError = (status: number, error: string) =>
  Object.assign(new Error(error), {
    isAxiosError: true,
    response: { status, data: { success: false, error } },
  });

async function signIn() {
  fireEvent.change(await screen.findByLabelText('Email'), {
    target: { value: 'alice@example.test' },
  });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
}

beforeEach(() => {
  vi.resetAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  useAppStore.setState({ completedIds: {}, plannedIds: [], progressOwnerId: null });
  vi.mocked(api.healthCheck).mockResolvedValue({
    success: true,
    data: { status: 'ok', timestamp: '' },
  });
  vi.mocked(api.getSession).mockRejectedValue(httpError(401, 'Authentication required'));
  vi.mocked(api.getDemoLoginStatus).mockResolvedValue({ enabled: false });
  vi.mocked(api.login).mockResolvedValue(student);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('signing in after being bounced from a protected page', () => {
  it('returns the visitor to the page they asked for', async () => {
    window.history.replaceState({}, '', '/grades');
    render(<App />);

    // The guard sends them to sign in first.
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    await signIn();

    await waitFor(() => expect(window.location.pathname).toBe('/grades'));
  });

  it('returns an administrator to the admin page they asked for', async () => {
    vi.mocked(api.login).mockResolvedValue({ ...student, role: 'ADMIN' });
    window.history.replaceState({}, '', '/admin');
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    await signIn();

    await waitFor(() => expect(window.location.pathname).toBe('/admin'));
  });

  it('still lands on the curriculum when the visitor went straight to sign in', async () => {
    window.history.replaceState({}, '', '/login');
    render(<App />);

    await signIn();

    await waitFor(() => expect(window.location.pathname).toBe('/curriculum'));
  });

  it.each(['https://evil.test/steal', '//evil.test', '/login', '/register'])(
    'ignores the crafted destination %s',
    async (from) => {
      window.history.replaceState({ usr: { from } }, '', '/login');
      render(<App />);

      await signIn();

      await waitFor(() => expect(window.location.pathname).toBe('/curriculum'));
    },
  );
});
