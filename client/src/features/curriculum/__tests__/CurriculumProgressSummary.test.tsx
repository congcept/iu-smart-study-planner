import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextStudentProgressDTO } from '@iu-study-planner/shared';
import { getContextStudentProgress } from '@/lib/curriculumApi';
import { contextProgress } from '@/test/fixtures/contextProgress';
import { otherReferenceId, ownerId, referenceId } from '@/test/fixtures/curriculumReference';
import { CurriculumProgressSummary } from '../CurriculumProgressSummary';
vi.mock('@/lib/curriculumApi', () => ({ getContextStudentProgress: vi.fn() }));
const getProgress = vi.mocked(getContextStudentProgress);
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  getProgress.mockResolvedValue(contextProgress());
});
afterEach(cleanup);
describe('read-only curriculum progress summary', () => {
  it('shows member totals with no degree percentage or mutation controls', async () => {
    render(<CurriculumProgressSummary userId={ownerId} curriculumId={referenceId} />);
    await screen.findByText('Earned credits');
    expect(screen.getByText('Earned credits').parentElement).toHaveTextContent('4');
    expect(screen.getByText('Completed courses').parentElement).toHaveTextContent('1');
    expect(screen.getByText(/Physical training earns no degree credits/)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(getProgress).toHaveBeenCalledWith(ownerId, referenceId);
  });
  it('preserves historical records and elective claims outside the totals', async () => {
    const data = contextProgress();
    data.historicalRecords.push({
      ...data.completed[0],
      id: otherReferenceId,
      courseId: otherReferenceId,
      status: 'PLANNED',
      electiveGroup: 'Archived group',
      course: { id: otherReferenceId, code: 'OLD', name: 'Historical course', credits: 99 },
    });
    getProgress.mockResolvedValue(data);
    render(<CurriculumProgressSummary userId={ownerId} curriculumId={referenceId} />);
    await screen.findByText('Historical selections outside this curriculum');
    expect(
      screen.getByText('OLD · Historical course · Planned · Archived group'),
    ).toBeInTheDocument();
    expect(screen.getByText('Earned credits').parentElement).toHaveTextContent('4');
  });
  it('shows an empty-selection state without removing history', async () => {
    const data = contextProgress();
    data.completed = [];
    data.progress.completedCourses = 0;
    data.progress.completedCredits = 0;
    getProgress.mockResolvedValue(data);
    render(<CurriculumProgressSummary userId={ownerId} curriculumId={referenceId} />);
    await screen.findByText('No saved course selections in this curriculum yet.');
  });
  it('recovers from failure and withholds stale totals during reload', async () => {
    getProgress.mockRejectedValueOnce(new Error('offline'));
    render(<CurriculumProgressSummary userId={ownerId} curriculumId={referenceId} />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Reload progress' }));
    await screen.findByText('Earned credits');
    const pending = deferred<ContextStudentProgressDTO>();
    getProgress.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Reload progress' }));
    expect(screen.queryByText('Earned credits')).not.toBeInTheDocument();
    await act(async () => pending.resolve(contextProgress()));
    await screen.findByText('Earned credits');
  });
  it.each(['owner', 'context'])('rejects a mismatched %s from the adapter', async (kind) => {
    const data = contextProgress();
    if (kind === 'owner') data.scope.userId = otherReferenceId;
    else data.scope.curriculumId = otherReferenceId;
    getProgress.mockResolvedValue(data);
    render(<CurriculumProgressSummary userId={ownerId} curriculumId={referenceId} />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Earned credits')).not.toBeInTheDocument();
  });
  it.each(['owner', 'context'])('isolates old replies after a changed %s', async (kind) => {
    const pending = deferred<ContextStudentProgressDTO>();
    getProgress.mockReturnValueOnce(pending.promise);
    const { rerender } = render(
      <CurriculumProgressSummary userId={ownerId} curriculumId={referenceId} />,
    );
    await waitFor(() => expect(getProgress).toHaveBeenCalledTimes(1));
    const data = contextProgress();
    data.completed = [];
    data.progress.completedCredits = 0;
    data.progress.completedCourses = 0;
    if (kind === 'owner') data.scope.userId = otherReferenceId;
    else data.scope.curriculumId = otherReferenceId;
    getProgress.mockResolvedValue(data);
    rerender(
      <CurriculumProgressSummary
        userId={data.scope.userId}
        curriculumId={data.scope.curriculumId}
      />,
    );
    await screen.findByText('Earned credits');
    await act(async () => pending.resolve(contextProgress()));
    expect(screen.getByText('Earned credits').parentElement).toHaveTextContent('0');
  });
  it('cleans up a pending reply after unmount', async () => {
    const pending = deferred<ContextStudentProgressDTO>();
    getProgress.mockReturnValue(pending.promise);
    const { unmount } = render(
      <CurriculumProgressSummary userId={ownerId} curriculumId={referenceId} />,
    );
    unmount();
    await act(async () => pending.resolve(contextProgress()));
    expect(screen.queryByText('Earned credits')).not.toBeInTheDocument();
  });
  it('retains planned and in-progress counts independently of earned totals', async () => {
    const data = contextProgress();
    data.planned = [
      {
        ...data.completed[0],
        id: otherReferenceId,
        courseId: otherReferenceId,
        course: { ...data.completed[0].course, id: otherReferenceId, code: 'PLANNED' },
        status: 'PLANNED',
      },
    ];
    data.inProgress = [
      {
        ...data.completed[0],
        id: '77777777-7777-4777-8777-777777777777',
        courseId: '77777777-7777-4777-8777-777777777777',
        course: {
          ...data.completed[0].course,
          id: '77777777-7777-4777-8777-777777777777',
          code: 'PROGRESS',
        },
        status: 'IN_PROGRESS',
      },
    ];
    data.progress.totalCourses = 3;
    getProgress.mockResolvedValue(data);
    render(<CurriculumProgressSummary userId={ownerId} curriculumId={referenceId} />);
    await screen.findByText('Planned courses');
    expect(
      within(screen.getByText('Planned courses').parentElement!).getByText('1'),
    ).toBeInTheDocument();
    expect(screen.getByText('Earned credits').parentElement).toHaveTextContent('4');
  });
});
