import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentGradesDTO } from '@iu-study-planner/shared';
import { getCurriculum, getCurrentStudentProgress, saveCourseProgress } from '@/lib/api';
import { getStudentGrades } from '@/lib/gradesApi';
import { useAppStore } from '@/lib/store';
import type { Course } from '@/types';
import { CurriculumProgressMap } from '../CurriculumProgressMap';

vi.mock('@/lib/api', () => ({
  getCurriculum: vi.fn(),
  getCurrentStudentProgress: vi.fn(),
  saveCourseProgress: vi.fn(),
}));
vi.mock('@/lib/gradesApi', () => ({ getStudentGrades: vi.fn() }));
vi.mock('@/lib/sounds', () => ({
  playCompleteSound: vi.fn(),
  playUncompleteSound: vi.fn(),
  playPlanSound: vi.fn(),
  playUnplanSound: vi.fn(),
  playLockedSound: vi.fn(),
  playToggleSound: vi.fn(),
  playRecommendationsSound: vi.fn(),
}));

function course(code: string, credits = 3): Course {
  return {
    id: code,
    code,
    name: `Course ${code}`,
    credits,
    difficultyLevel: 2,
    category: 'REQUIRED',
    semesterOffered: ['SPRING'],
    prerequisites: [],
    isPrerequisiteFor: [],
    createdAt: '',
    updatedAt: '',
  };
}
function grades(
  path: StudentGradesDTO['summary']['gpaPath'],
  score: number | null,
): StudentGradesDTO {
  return {
    attempts: [],
    summary: {
      gpaPath: path,
      gpa100: score,
      gradedCredits: path ? 3 : 0,
      gradedCourseCount: path ? 1 : 0,
      courseScores: [],
    },
    completedCoursesWithoutNumericGrades: [],
  };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
// The incumbent card has a different DOM from the pending interface work. Assert
// the visible status within either card, rather than its styling or wrappers.
function card(code: string) {
  const label = screen.getByText(code);
  return label.closest('button') ?? label.parentElement?.parentElement;
}
function signIn(userId: string) {
  useAppStore.getState().setProgressOwner(userId);
}

beforeEach(() => {
  vi.resetAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 0),
  );
  useAppStore.setState({
    completedIds: {},
    plannedIds: [],
    progressOwnerId: null,
    progressStatus: 'ready',
    progressError: null,
    browserProgressBackup: null,
    pendingCompletionIds: new Set(),
    progressImportStatus: 'idle',
  });
  vi.mocked(getCurrentStudentProgress).mockResolvedValue({ completedIds: {}, plannedIds: [] });
  vi.mocked(getCurriculum).mockResolvedValue({
    success: true,
    data: [
      { year: 1, semester: 1, courses: [course('MA001IU')] },
      {
        year: 4,
        semester: 2,
        courses: [course('IT058IU', 9), course('IT059IU'), course('IT060IU')],
      },
    ],
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('server GPA policy in the curriculum map', () => {
  it.each([
    ['THESIS', 70, 'Thesis path', 'IT058IU', 'IT059IU', '41'],
    ['ALTERNATIVE', 70, 'Alternative path', 'IT059IU', 'IT058IU', '43'],
  ] as const)(
    'uses the server %s path, its target and recommendations before display rounding',
    async (path, score, label, shown, hidden, target) => {
      signIn('alice');
      vi.mocked(getStudentGrades).mockResolvedValue(grades(path, score));
      render(<CurriculumProgressMap userId="alice" />);
      expect(await screen.findByText(label)).toBeVisible();
      expect(screen.getByText('Recorded GPA: 70.00 / 100')).toBeVisible();
      expect(screen.getByText(target)).toBeVisible();
      expect(screen.queryByText(hidden)).toBeNull();
      await waitFor(() => expect(card(shown)).toHaveTextContent(/next/i));
      expect(screen.queryByRole('button', { name: 'GPA > 70' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'GPA <= 70' })).toBeNull();
    },
  );

  it('keeps guest paths manual and never requests an account GPA', async () => {
    render(<CurriculumProgressMap />);
    await screen.findByText('IT058IU');
    expect(screen.getByText('41')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'GPA <= 70' }));
    expect(screen.queryByText('IT058IU')).toBeNull();
    expect(screen.getByText('IT059IU')).toBeVisible();
    expect(screen.getByText('43')).toBeVisible();
    await waitFor(() => expect(card('IT059IU')).toHaveTextContent(/next/i));
    expect(getStudentGrades).not.toHaveBeenCalled();
  });

  it('allows a signed-in manual choice only after an explicit no-score summary', async () => {
    signIn('alice');
    vi.mocked(getStudentGrades).mockResolvedValue(grades(null, null));
    render(<CurriculumProgressMap userId="alice" />);
    expect(await screen.findByRole('button', { name: 'GPA > 70' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'GPA <= 70' }));
    expect(screen.getByRole('button', { name: 'GPA <= 70' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('43')).toBeVisible();
    expect(screen.queryByText('IT058IU')).toBeNull();
    expect(getStudentGrades).toHaveBeenCalledTimes(1);
  });

  it('withholds course editing and manual controls while the account GPA is loading', async () => {
    signIn('alice');
    const pending = deferred<StudentGradesDTO>();
    vi.mocked(getStudentGrades).mockReturnValue(pending.promise);
    render(<CurriculumProgressMap userId="alice" />);
    expect(await screen.findByRole('status')).toHaveTextContent('Loading your GPA path');
    expect(screen.queryByText('MA001IU')).toBeNull();
    expect(screen.queryByText('IT058IU')).toBeNull();
    expect(screen.queryByRole('button', { name: 'GPA > 70' })).toBeNull();
    expect(saveCourseProgress).not.toHaveBeenCalled();
    await act(async () => pending.resolve(grades('THESIS', 80)));
    await screen.findByText('MA001IU');
    expect(screen.getByText('IT058IU')).toBeVisible();
  });

  it('requires successful GPA reload after failure before showing editable cards', async () => {
    signIn('alice');
    vi.mocked(getStudentGrades)
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(grades('ALTERNATIVE', 65));
    render(<CurriculumProgressMap userId="alice" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your GPA path');
    expect(screen.queryByText('MA001IU')).toBeNull();
    expect(screen.queryByRole('button', { name: 'GPA <= 70' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload GPA path' }));
    await screen.findByText('Alternative path');
    expect(screen.getByText('MA001IU')).toBeVisible();
    expect(screen.getByText('IT059IU')).toBeVisible();
    expect(screen.queryByText('IT058IU')).toBeNull();
    expect(getStudentGrades).toHaveBeenCalledTimes(2);
    expect(saveCourseProgress).not.toHaveBeenCalled();
  });

  it('never applies a late first-account summary to the next signed-in account', async () => {
    const first = deferred<StudentGradesDTO>();
    const second = deferred<StudentGradesDTO>();
    vi.mocked(getStudentGrades)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    signIn('alice');
    const view = render(<CurriculumProgressMap userId="alice" />);
    await waitFor(() => expect(getStudentGrades).toHaveBeenCalledTimes(1));
    act(() => signIn('bob'));
    view.rerender(<CurriculumProgressMap userId="bob" />);
    await waitFor(() => expect(getStudentGrades).toHaveBeenCalledTimes(2));
    await act(async () => second.resolve(grades('ALTERNATIVE', 60)));
    await screen.findByText('Alternative path');
    await act(async () => first.resolve(grades('THESIS', 95)));
    expect(screen.getByText('Recorded GPA: 60.00 / 100')).toBeVisible();
    expect(screen.getByText('43')).toBeVisible();
    expect(screen.queryByText('IT058IU')).toBeNull();
    expect(screen.queryByText('Thesis path')).toBeNull();
  });

  it('refreshes the path on return from grade entry without changing progress', async () => {
    signIn('alice');
    vi.mocked(getCurrentStudentProgress).mockResolvedValue({
      completedIds: { MA001IU: null },
      plannedIds: ['IT059IU'],
    });
    vi.mocked(getStudentGrades)
      .mockResolvedValueOnce(grades('ALTERNATIVE', 70))
      .mockResolvedValueOnce(grades('THESIS', 70.0001));
    render(<CurriculumProgressMap userId="alice" />);
    await screen.findByText('Alternative path');
    fireEvent(window, new Event('focus'));
    await screen.findByText('Thesis path');
    expect(screen.getByText('Recorded GPA: 70.00 / 100')).toBeVisible();
    expect(screen.getByText('40')).toBeVisible();
    expect(screen.queryByText('IT059IU')).toBeNull();
    expect(useAppStore.getState().completedIds).toEqual({ MA001IU: null });
    expect(useAppStore.getState().plannedIds).toEqual(['IT059IU']);
    expect(saveCourseProgress).not.toHaveBeenCalled();
  });
});
