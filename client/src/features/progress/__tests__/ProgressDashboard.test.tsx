import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Course, StudentRecord } from '@/types';
import { getUserProgress } from '@/lib/api';
import { ProgressDashboard } from '../ProgressDashboard';

vi.mock('@/lib/api', () => ({
  getUserProgress: vi.fn(),
}));

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: 'course-1',
    code: 'IT001IU',
    name: 'Introduction to Programming',
    credits: 3,
    difficultyLevel: 2,
    category: 'REQUIRED',
    semesterOffered: ['SPRING'],
    prerequisites: [],
    isPrerequisiteFor: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function record(overrides: Partial<StudentRecord> = {}): StudentRecord {
  return {
    id: 'record-1',
    userId: 'alice',
    courseId: 'course-1',
    status: 'COMPLETED',
    createdAt: '',
    updatedAt: '',
    course: course(),
    ...overrides,
  };
}

function payload(
  overrides: {
    completed?: StudentRecord[];
    inProgress?: StudentRecord[];
    available?: Course[];
    totalCourses?: number;
    completedCourses?: number;
    totalCredits?: number;
    completedCredits?: number;
  } = {},
) {
  const completed = overrides.completed ?? [];
  return {
    completed,
    inProgress: overrides.inProgress ?? [],
    planned: [],
    available: overrides.available ?? [],
    progress: {
      totalCourses: overrides.totalCourses ?? 10,
      completedCourses: overrides.completedCourses ?? completed.length,
      totalCredits: overrides.totalCredits ?? 120,
      completedCredits: overrides.completedCredits ?? 0,
      percentage: 10,
    },
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

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('ProgressDashboard', () => {
  it('announces loading and does not render records before they arrive', async () => {
    const pending =
      deferred<ReturnType<typeof getUserProgress> extends Promise<infer R> ? R : never>();
    vi.mocked(getUserProgress).mockReturnValue(pending.promise as never);
    render(<ProgressDashboard userId="alice" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading progress');
    expect(screen.queryByText('IT001IU')).toBeNull();

    await act(async () => pending.resolve({ success: true, data: payload() } as never));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('shows a recoverable error with retry when the read fails', async () => {
    vi.mocked(getUserProgress).mockRejectedValueOnce(new Error('Offline'));
    render(<ProgressDashboard userId="alice" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t load your progress');
    expect(screen.queryByText('IT001IU')).toBeNull();

    vi.mocked(getUserProgress).mockResolvedValueOnce({
      success: true,
      data: payload({ completed: [record()], totalCourses: 1, completedCourses: 1 }),
    } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));

    await screen.findByText('IT001IU');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(getUserProgress).toHaveBeenCalledTimes(2);
  });

  it('treats an unsuccessful response as an error rather than empty progress', async () => {
    vi.mocked(getUserProgress).mockResolvedValueOnce({ success: false } as never);
    render(<ProgressDashboard userId="alice" />);
    expect(await screen.findByRole('alert')).toBeVisible();
  });

  it('ignores a stale response that resolves after a newer request', async () => {
    const first = deferred<never>();
    const second = deferred<never>();
    vi.mocked(getUserProgress)
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never);

    const view = render(<ProgressDashboard userId="alice" />);
    await waitFor(() => expect(getUserProgress).toHaveBeenCalledTimes(1));

    // A newer account starts its own read before the first one settles.
    view.rerender(<ProgressDashboard userId="bob" />);
    await waitFor(() => expect(getUserProgress).toHaveBeenCalledTimes(2));

    // The newer read wins and paints its own (empty) payload.
    await act(async () => second.resolve({ success: true, data: payload() } as never));
    await screen.findByText('No completed courses have been recorded yet.');

    // The older read then arrives with alice's records and must be discarded.
    await act(async () =>
      first.resolve({
        success: true,
        data: payload({ completed: [record()], totalCourses: 1, completedCourses: 1 }),
      } as never),
    );

    expect(screen.queryByText('IT001IU')).toBeNull();
    expect(screen.getByText('No completed courses have been recorded yet.')).toBeVisible();
  });

  it('does not claim a graduation or GPA outcome for the catalog count', async () => {
    vi.mocked(getUserProgress).mockResolvedValueOnce({
      success: true,
      data: payload({ completed: [record()], totalCourses: 1, completedCourses: 1 }),
    } as never);
    render(<ProgressDashboard userId="alice" />);

    expect(await screen.findByText(/not a graduation or GPA calculation/)).toBeVisible();
    expect(screen.getByText(/Physical\s+Training 1 and 2 do not count/)).toBeVisible();
    expect(screen.queryByText(/more courses to graduate/i)).toBeNull();
    expect(screen.queryByText(/Degree Progress/i)).toBeNull();
  });

  it('exposes both recorded totals as labelled progress bars', async () => {
    vi.mocked(getUserProgress).mockResolvedValueOnce({
      success: true,
      data: payload({
        completed: [record()],
        totalCourses: 10,
        completedCourses: 1,
        totalCredits: 120,
        completedCredits: 3,
      }),
    } as never);
    render(<ProgressDashboard userId="alice" />);

    const courses = await screen.findByRole('progressbar', {
      name: 'Courses recorded as complete',
    });
    expect(courses).toHaveAttribute('aria-valuenow', '1');
    expect(courses).toHaveAttribute('aria-valuemax', '10');

    const credits = screen.getByRole('progressbar', { name: 'Credits recorded as complete' });
    expect(credits).toHaveAttribute('aria-valuenow', '3');
    expect(credits).toHaveAttribute('aria-valuemax', '120');
  });

  it('renders an explicit empty state instead of an empty list', async () => {
    vi.mocked(getUserProgress).mockResolvedValueOnce({
      success: true,
      data: payload(),
    } as never);
    render(<ProgressDashboard userId="alice" />);

    expect(await screen.findByText('No completed courses have been recorded yet.')).toBeVisible();
    expect(
      screen.getByText('No additional catalog courses currently meet the recorded prerequisites.'),
    ).toBeVisible();
  });

  it('omits the in-progress card entirely when nothing is in progress', async () => {
    vi.mocked(getUserProgress).mockResolvedValueOnce({
      success: true,
      data: payload(),
    } as never);
    render(<ProgressDashboard userId="alice" />);
    await screen.findByText('Recorded progress');
    expect(screen.queryByText('In progress')).toBeNull();
  });

  it('reports when the eligible list is truncated at ten courses', async () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      course({ id: `course-${index}`, code: `IT1${String(index).padStart(2, '0')}IU` }),
    );
    vi.mocked(getUserProgress).mockResolvedValueOnce({
      success: true,
      data: payload({ available: many }),
    } as never);
    render(<ProgressDashboard userId="alice" />);

    expect(await screen.findByText('Showing 10 of 12 eligible catalog courses.')).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
  });

  it('shows a grade badge only when a grade was recorded', async () => {
    vi.mocked(getUserProgress).mockResolvedValueOnce({
      success: true,
      data: payload({
        completed: [
          record({ grade: 'A' }),
          record({
            id: 'record-2',
            courseId: 'course-2',
            course: course({ id: 'course-2', code: 'IT002IU' }),
          }),
        ],
        totalCourses: 2,
        completedCourses: 2,
      }),
    } as never);
    render(<ProgressDashboard userId="alice" />);

    await screen.findByText('IT001IU');
    expect(screen.getByText('IT002IU')).toBeVisible();
    expect(screen.getByText('Grade A')).toBeVisible();
    expect(screen.queryAllByText(/^Grade /)).toHaveLength(1);
  });
});
