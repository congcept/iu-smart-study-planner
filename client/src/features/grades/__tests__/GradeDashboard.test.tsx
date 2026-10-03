import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentGradesDTO } from '@iu-study-planner/shared';
import { getStudentGrades } from '@/lib/gradesApi';
import { GradeDashboard } from '../GradeDashboard';
const entry = vi.hoisted(() => ({
  onSaved: undefined as undefined | ((saved: StudentGradesDTO) => void),
}));
vi.mock('../GradeEntry', () => ({
  GradeEntry: ({ onSaved }: { onSaved: (saved: StudentGradesDTO) => void }) => {
    entry.onSaved = onSaved;
    return null;
  },
}));
vi.mock('@/lib/gradesApi', () => ({ getStudentGrades: vi.fn() }));
const getGrades = vi.mocked(getStudentGrades);
const empty: StudentGradesDTO = {
  attempts: [],
  summary: {
    gpa100: null,
    gpaPath: null,
    gradedCredits: 0,
    gradedCourseCount: 0,
    courseScores: [],
  },
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
    gpaPath: 'THESIS',
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
  entry.onSaved = undefined;
  getGrades.mockResolvedValue(empty);
});
afterEach(cleanup);
describe('numeric grade dashboard', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const scope = { userId, curriculumId: '22222222-2222-4222-8222-222222222222', isGpaPath: true };
  it('explains current-member GPA while preserving nonmember history without a highest marker', async () => {
    const historical = {
      ...scored.attempts[0],
      id: 'historical',
      requestId: 'historical',
      courseId: 'outside',
      score: 100,
      course: { id: 'outside', code: 'OUTSIDE', name: 'Historical course', credits: 3 },
    };
    getGrades.mockResolvedValue({ ...scored, scope, attempts: [...scored.attempts, historical] });
    render(<GradeDashboard userId={userId} />);
    await screen.findByText('90.00');
    expect(
      screen.getByText(/GPA includes scored courses in your current reference curriculum/),
    ).toBeInTheDocument();
    expect(screen.getByText('OUTSIDE').closest('tr')).not.toHaveTextContent('Highest');
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getAllByText('Highest', { exact: true })).toHaveLength(1);
  });
  it('displays numeric GPA for a nonfork context without inventing thesis eligibility', async () => {
    getGrades.mockResolvedValue({
      ...scored,
      scope: { ...scope, isGpaPath: false },
      summary: { ...scored.summary, gpaPath: null },
    });
    render(<GradeDashboard userId={userId} />);
    await screen.findByText('90.00');
    expect(
      screen.getByText('This curriculum does not use a GPA-based thesis path.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /GPA/i })).not.toBeInTheDocument();
  });
  it('does not label a fork curriculum as having no GPA path', async () => {
    getGrades.mockResolvedValue({ ...scored, scope });
    render(<GradeDashboard userId={userId} />);
    await screen.findByText('90.00');
    expect(screen.queryByText(/does not use a GPA-based thesis path/)).not.toBeInTheDocument();
  });
  it('rejects another cookie owner scope before rendering grades and recovers on retry', async () => {
    getGrades
      .mockResolvedValueOnce({
        ...scored,
        scope: { ...scope, userId: '33333333-3333-4333-8333-333333333333' },
      })
      .mockResolvedValueOnce({ ...scored, scope });
    render(<GradeDashboard userId={userId} />);
    await screen.findByRole('alert');
    expect(screen.queryByText('90.00')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload grades' }));
    await screen.findByText('90.00');
  });
  it('keeps unassigned wording without claiming a reference curriculum', async () => {
    getGrades.mockResolvedValue({ ...scored, scope: { ...scope, curriculumId: null } });
    render(<GradeDashboard userId={userId} />);
    await screen.findByText('90.00');
    expect(screen.queryByText(/current reference curriculum/)).not.toBeInTheDocument();
  });
  it('does not reconcile a saved snapshot belonging to another cookie owner', async () => {
    getGrades.mockResolvedValue({ ...empty, scope });
    render(<GradeDashboard userId={userId} />);
    await screen.findByText('No scores yet');
    act(() =>
      entry.onSaved?.({
        ...scored,
        scope: { ...scope, userId: '33333333-3333-4333-8333-333333333333' },
      }),
    );
    expect(screen.getByText('No scores yet')).toBeInTheDocument();
    expect(screen.queryByText('90.00')).not.toBeInTheDocument();
  });
  it('reconciles an immutable grade save for the matching scoped owner', async () => {
    getGrades.mockResolvedValue({ ...empty, scope });
    render(<GradeDashboard userId={userId} />);
    await screen.findByText('No scores yet');
    act(() => entry.onSaved?.({ ...scored, scope }));
    expect(screen.getByText('90.00')).toBeInTheDocument();
    expect(screen.queryByText('No scores yet')).not.toBeInTheDocument();
  });
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
      summary: {
        ...empty.summary,
        gpa100: 0,
        gpaPath: 'ALTERNATIVE',
        gradedCredits: 4,
        gradedCourseCount: 1,
      },
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
