import '@testing-library/jest-dom/vitest';
import { useEffect, useRef } from 'react';
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

vi.mock('@/features/curriculum/CurriculumProgressMap', () => ({
  CurriculumProgressMap: () => <div>Demo curriculum content</div>,
}));
vi.mock('@/features/curriculum/AccountCurriculum', () => ({
  AccountCurriculum: () => <div>Account curriculum content</div>,
}));
vi.mock('@/features/grades/GradeDashboard', () => ({
  GradeDashboard: () => <h2>Grades</h2>,
}));
vi.mock('@/features/ratings/RatingDashboard', () => ({
  RatingDashboard: () => <h2>Ratings</h2>,
}));
// Mirrors the real Planner, which focuses a heading it has just revealed.
vi.mock('@/features/planner/PlannerDashboard', () => ({
  PlannerDashboard: () => {
    const heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
      heading.current?.focus();
    }, []);
    return (
      <h2 ref={heading} tabIndex={-1}>
        Planner
      </h2>
    );
  },
}));
vi.mock('@/features/admin/AdminGuard', () => ({
  AdminGuard: () => <div />,
}));
vi.mock('@/features/admin/AdminResourceDashboard', () => ({
  AdminResourceDashboard: () => <h2>Simulation resources</h2>,
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
  vi.mocked(api.getDemoLoginStatus).mockResolvedValue({ enabled: false });
  window.history.replaceState({}, '', '/curriculum');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.title = '';
});

describe('app shell navigation', () => {
  it('offers a skip link to the main content as the first focusable element', async () => {
    render(<App />);
    await screen.findByText(student.name);

    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    const main = screen.getByRole('main');

    expect(skip).toHaveAttribute('href', '#main-content');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveAttribute('tabindex', '-1');

    const focusable = Array.from(
      document.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    );
    expect(focusable[0]).toBe(skip);
  });

  it('moves focus into the page after a client-side navigation', async () => {
    render(<App />);
    await screen.findByText(student.name);

    fireEvent.click(screen.getByRole('link', { name: 'Grades' }));

    await waitFor(() => expect(window.location.pathname).toBe('/grades'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('main')));
  });

  it('shows where the keyboard landed after a navigation', async () => {
    render(<App />);
    await screen.findByText(student.name);

    fireEvent.click(screen.getByRole('link', { name: 'Grades' }));

    await waitFor(() => expect(window.location.pathname).toBe('/grades'));
    const main = screen.getByRole('main');
    await waitFor(() => expect(document.activeElement).toBe(main));
    // The focus move has to be visible, or a keyboard user cannot see that the
    // page they opened is the one they are now on.
    expect(main.className).toContain('focus-visible:outline-primary-700');
  });

  it("keeps a route's own deliberate focus instead of overriding it", async () => {
    render(<App />);
    await screen.findByText(student.name);

    fireEvent.click(screen.getByRole('link', { name: 'Planner' }));

    const heading = await screen.findByRole('heading', { name: 'Planner' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('gives each route its own document title', async () => {
    render(<App />);
    await screen.findByText(student.name);

    expect(document.title).toBe('My curriculum · IU Smart Study Planner');

    fireEvent.click(screen.getByRole('link', { name: 'Grades' }));
    await waitFor(() => expect(document.title).toBe('Grades · IU Smart Study Planner'));

    fireEvent.click(screen.getByRole('link', { name: 'Ratings' }));
    await waitFor(() => expect(document.title).toBe('Ratings · IU Smart Study Planner'));
  });

  it('titles the sign-in route for signed-out visitors', async () => {
    vi.mocked(api.getSession).mockRejectedValue(httpError(401, 'Authentication required'));
    window.history.replaceState({}, '', '/login');

    render(<App />);

    await waitFor(() => expect(document.title).toBe('Sign in · IU Smart Study Planner'));
  });

  it('offers a retry instead of telling the user to reload the page', async () => {
    vi.mocked(api.healthCheck).mockRejectedValue(new Error('network down'));

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot connect to the planner.');
    expect(screen.queryByText(/reload the page/i)).not.toBeInTheDocument();

    const retry = screen.getByRole('button', { name: 'Try again' });
    vi.mocked(api.healthCheck).mockResolvedValue({
      success: true,
      data: { status: 'ok', timestamp: '' },
    });
    fireEvent.click(retry);

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(api.healthCheck).toHaveBeenCalledTimes(2);
  });

  it('keeps the page in place while the connection banner retries', async () => {
    vi.mocked(api.healthCheck).mockRejectedValueOnce(new Error('network down'));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot connect to the planner.');
    expect(screen.getByText(/curriculum content/)).toBeInTheDocument();

    // A connectivity re-check must not rebuild the page under the user: any
    // half-finished selection or typed value lives in that subtree.
    let finish: () => void = () => {};
    vi.mocked(api.healthCheck).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = () => resolve({ success: true, data: { status: 'ok', timestamp: '' } });
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(api.healthCheck).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/curriculum content/)).toBeInTheDocument();
    expect(screen.queryByText(/Loading IU Smart Study Planner/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();

    finish();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
