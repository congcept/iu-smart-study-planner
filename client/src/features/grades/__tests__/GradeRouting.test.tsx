import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUserDTO } from '@iu-study-planner/shared';
import App from '@/App';
import * as api from '@/lib/api';
import { getStudentGrades } from '@/lib/gradesApi';
vi.mock('@/lib/api');
vi.mock('@/features/ratings/RatingDashboard', () => ({
  RatingDashboard: () => <h2>Course ratings</h2>,
}));
vi.mock('../GradeEntry', () => ({ GradeEntry: () => null }));
vi.mock('@/lib/gradesApi', () => ({ getStudentGrades: vi.fn() }));
vi.mock('@/features/curriculum/CurriculumProgressMap', () => ({
  CurriculumProgressMap: () => <p>Curriculum route</p>,
}));
const user: AuthUserDTO = {
  id: 'route-owner',
  studentId: 'demo-student',
  name: 'Route student',
  email: 'route@example.test',
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
  vi.mocked(api.healthCheck).mockResolvedValue({
    success: true,
    data: { status: 'ok', timestamp: '' },
  });
  vi.mocked(api.getCurrentStudentProgress).mockResolvedValue({ completedIds: {}, plannedIds: [] });
  vi.mocked(api.getDemoLoginStatus).mockResolvedValue({ enabled: false });
  vi.mocked(getStudentGrades).mockResolvedValue({
    attempts: [],
    summary: { gpa100: null, gradedCredits: 0, gradedCourseCount: 0, courseScores: [] },
    completedCoursesWithoutNumericGrades: [],
  });
  window.history.replaceState({}, '', '/grades');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('protected grades routing', () => {
  it('redirects an anonymous grade visit to login and hides grade navigation', async () => {
    vi.mocked(api.getSession).mockRejectedValue({ isAxiosError: true, response: { status: 401 } });
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(screen.queryByRole('link', { name: 'Grades' })).not.toBeInTheDocument();
    expect(getStudentGrades).not.toHaveBeenCalled();
  });
  it.each(['STUDENT', 'ADMIN'] as const)(
    'allows %s to read current-account numeric grades',
    async (role) => {
      vi.mocked(api.getSession).mockResolvedValue({ ...user, role });
      render(<App />);
      expect(await screen.findByRole('heading', { name: 'Grades' })).toBeInTheDocument();
      expect(await screen.findByText('No scores yet')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Grades' })).toHaveAttribute('href', '/grades');
    },
  );
  it('opens Grades from the signed-in curriculum navigation', async () => {
    window.history.replaceState({}, '', '/curriculum');
    vi.mocked(api.getSession).mockResolvedValue(user);
    render(<App />);
    fireEvent.click(await screen.findByRole('link', { name: 'Grades' }));
    expect(await screen.findByRole('heading', { name: 'Grades' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/grades');
  });
});

describe('protected ratings routing', () => {
  it('redirects an anonymous ratings visit to sign in', async () => {
    window.history.replaceState({}, '', '/ratings');
    vi.mocked(api.getSession).mockRejectedValue({ isAxiosError: true, response: { status: 401 } });
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(screen.queryByRole('link', { name: 'Ratings' })).not.toBeInTheDocument();
  });
  it.each(['STUDENT', 'ADMIN'] as const)('opens ratings for %s from navigation', async (role) => {
    window.history.replaceState({}, '', '/curriculum');
    vi.mocked(api.getSession).mockResolvedValue({ ...user, role });
    render(<App />);
    fireEvent.click(await screen.findByRole('link', { name: 'Ratings' }));
    expect(await screen.findByRole('heading', { name: 'Course ratings' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/ratings');
  });
});
