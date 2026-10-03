import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUserDTO } from '@iu-study-planner/shared';
import App from '@/App';
import * as api from '@/lib/api';
import { useAppStore } from '@/lib/store';

vi.mock('@/lib/api', () => ({ healthCheck: vi.fn(), getSession: vi.fn(), logout: vi.fn() }));
vi.mock('@/features/planner/PlannerDashboard', () => ({
  PlannerDashboard: ({ userId }: { userId: string }) => <p>Planner for {userId}</p>,
}));
vi.mock('@/features/curriculum/CurriculumProgressMap', () => ({
  CurriculumProgressMap: () => <p>Curriculum</p>,
}));
vi.mock('@/features/auth/LoginPage', () => ({ LoginPage: () => <p>Sign in page</p> }));
const student: AuthUserDTO = {
  id: 'alice',
  studentId: 'IT123',
  name: 'Simulated Alice',
  email: 'alice@example.test',
  role: 'STUDENT',
};
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
  vi.mocked(api.getSession).mockResolvedValue(student);
  vi.mocked(api.logout).mockResolvedValue(undefined);
  window.history.replaceState({}, '', '/planner');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('protected Planner route', () => {
  it.each(['STUDENT', 'ADMIN'] as const)(
    'opens saved account Planner for a %s session',
    async (role) => {
      vi.mocked(api.getSession).mockResolvedValue({ ...student, role });
      render(<App />);
      expect(await screen.findByText('Planner for alice')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Planner' })).toHaveAttribute('href', '/planner');
    },
  );
  it('redirects a guest to sign in without rendering Planner', async () => {
    vi.mocked(api.getSession).mockRejectedValue(
      Object.assign(new Error('Unauthorized'), { isAxiosError: true, response: { status: 401 } }),
    );
    render(<App />);
    expect(await screen.findByText('Sign in page')).toBeInTheDocument();
    expect(screen.queryByText('Planner for alice')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Planner' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });
  it('navigates from curriculum to Planner and removes account content on sign out', async () => {
    window.history.replaceState({}, '', '/curriculum');
    render(<App />);
    fireEvent.click(await screen.findByRole('link', { name: 'Planner' }));
    expect(await screen.findByText('Planner for alice')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByText('Sign in page');
    expect(screen.queryByText('Planner for alice')).not.toBeInTheDocument();
    expect(api.logout).toHaveBeenCalledTimes(1);
  });
  it('blocks Planner when session recovery fails until a valid session is loaded', async () => {
    vi.mocked(api.getSession)
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue(student);
    render(<App />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Planner for alice')).not.toBeInTheDocument();
    const retry =
      screen.queryByRole('button', { name: 'Retry' }) ??
      screen.getByRole('button', { name: 'Try again' });
    fireEvent.click(retry);
    expect(await screen.findByText('Planner for alice')).toBeInTheDocument();
    await waitFor(() => expect(api.getSession).toHaveBeenCalledTimes(2));
  });
});
