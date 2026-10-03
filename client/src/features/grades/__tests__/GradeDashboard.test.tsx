import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentGradesDTO } from '@iu-study-planner/shared';
import { getStudentGrades } from '@/lib/gradesApi';
import { GradeDashboard } from '../GradeDashboard';
vi.mock('../GradeEntry', () => ({ GradeEntry: () => null }));
vi.mock('@/lib/gradesApi', () => ({ getStudentGrades: vi.fn() }));
const getGrades = vi.mocked(getStudentGrades);
const empty: StudentGradesDTO = {
  attempts: [],
  summary: { gpa100: null, gradedCredits: 0, gradedCourseCount: 0, courseScores: [] },
  completedCoursesWithoutNumericGrades: [],
};
const scored: StudentGradesDTO = {
  attempts: [
    {
      id: 'low',
      requestId: 'low',
      courseId: 'math',
      score: 40,
      semester: null,
      year: null,
      createdAt: '2026-10-03T00:00:00.000Z',
      course: { id: 'math', code: 'MA001IU', name: 'Calculus 1', credits: 4 },
    },
    {
      id: 'high',
      requestId: 'high',
      courseId: 'math',
      score: 90,
      semester: 'FALL',
      year: 2026,
      createdAt: '2026-10-03T00:00:00.000Z',
      course: { id: 'math', code: 'MA001IU', name: 'Calculus 1', credits: 4 },
    },
  ],
  summary: {
    gpa100: 90,
    gradedCredits: 4,
    gradedCourseCount: 1,
    courseScores: [{ courseId: 'math', score: 90, credits: 4 }],
  },
  completedCoursesWithoutNumericGrades: ['missing'],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  getGrades.mockResolvedValue(empty);
});
afterEach(cleanup);
describe('numeric grade dashboard', () => {
  it('shows a loading state before scores arrive', async () => {
    const pending = deferred<StudentGradesDTO>();
    getGrades.mockReturnValue(pending.promise);
    render(<GradeDashboard userId="one" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading your grades');
    await act(async () => pending.resolve(empty));
  });
  it('distinguishes no grades from a zero GPA and preserves legacy grade wording', async () => {
    render(<GradeDashboard userId="one" />);
    expect(await screen.findByText('No scores yet')).toBeInTheDocument();
    expect(screen.getByText(/Existing letter grades remain unchanged/)).toBeInTheDocument();
  });
  it('shows the server weighted summary, both retakes, highest marker and coverage gap', async () => {
    getGrades.mockResolvedValue(scored);
    render(<GradeDashboard userId="one" />);
    expect(await screen.findByText('90.00')).toBeInTheDocument();
    expect(screen.getAllByText('MA001IU')).toHaveLength(2);
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('90')).toBeInTheDocument();
    expect(screen.getAllByText('Highest', { exact: true })).toHaveLength(1);
    expect(screen.getByText(/1 completed course has no numeric score/)).toBeInTheDocument();
    expect(screen.getByText('FALL 2026')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Grade history table' })).toHaveAttribute(
      'tabindex',
      '0',
    );
  });
  it('renders a real zero score as zero instead of an empty summary', async () => {
    getGrades.mockResolvedValue({
      ...empty,
      summary: { ...empty.summary, gpa100: 0, gradedCredits: 4, gradedCourseCount: 1 },
    });
    render(<GradeDashboard userId="one" />);
    expect(await screen.findByText('0.00')).toBeInTheDocument();
    expect(screen.queryByText('No scores yet')).not.toBeInTheDocument();
  });
  it('offers a retry after a failed load and recovers authoritative data', async () => {
    getGrades.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(scored);
    render(<GradeDashboard userId="one" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your grades');
    fireEvent.click(screen.getByRole('button', { name: 'Reload grades' }));
    expect(await screen.findByText('90.00')).toBeInTheDocument();
    expect(getGrades).toHaveBeenCalledTimes(2);
  });
  it('ignores an old account response after account changes', async () => {
    const old = deferred<StudentGradesDTO>();
    getGrades.mockReturnValueOnce(old.promise).mockResolvedValueOnce(empty);
    const { rerender } = render(<GradeDashboard userId="one" />);
    rerender(<GradeDashboard userId="two" />);
    expect(await screen.findByText('No scores yet')).toBeInTheDocument();
    await act(async () => old.resolve(scored));
    expect(screen.queryByText('90.00')).not.toBeInTheDocument();
  });
  it('hides the previous account snapshot immediately while the next account loads', async () => {
    const next = deferred<StudentGradesDTO>();
    getGrades.mockResolvedValueOnce(scored).mockReturnValueOnce(next.promise);
    const { rerender } = render(<GradeDashboard userId="one" />);
    await screen.findByText('90.00');
    rerender(<GradeDashboard userId="two" />);
    expect(screen.queryByText('90.00')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => next.resolve(empty));
  });
  it('does not write a late result after unmount', async () => {
    const pending = deferred<StudentGradesDTO>();
    getGrades.mockReturnValue(pending.promise);
    const { unmount } = render(<GradeDashboard userId="one" />);
    unmount();
    await act(async () => pending.resolve(scored));
    await waitFor(() => expect(screen.queryByText('90.00')).not.toBeInTheDocument());
  });
});
