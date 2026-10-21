import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OwnStudyPlanSemesterMetadataDTO,
  OwnStudyPlanSemestersDTO,
} from '@iu-study-planner/shared';
import {
  listSavedStudyPlanSemesters,
  SavedStudyPlanSemestersSessionChangedError,
} from '@/lib/savedStudyPlanSemestersApi';
import { ownerId, referenceId } from '@/test/fixtures/curriculumReference';
import { SavedStudyPlanSemestersPanel } from '../SavedStudyPlanSemestersPanel';

vi.mock('@/lib/savedStudyPlanSemestersApi', async (original) => ({
  ...(await original<typeof import('@/lib/savedStudyPlanSemestersApi')>()),
  listSavedStudyPlanSemesters: vi.fn(),
}));
vi.mock('../SavedStudyPlanCoursesPanel', () => ({
  SavedStudyPlanCoursesPanel: ({
    semesterId,
    expectedCurriculumId,
    onBack,
  }: {
    semesterId: string;
    expectedCurriculumId: string | null;
    onBack: () => void;
  }) => (
    <div>
      <span data-testid="selected-semester">{semesterId}</span>
      <span data-testid="selected-context">{expectedCurriculumId ?? 'unassigned'}</span>
      <button onClick={onBack}>Back to saved semesters</button>
    </div>
  ),
}));
const read = vi.mocked(listSavedStudyPlanSemesters);
const planId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const semester = (n = 1): OwnStudyPlanSemesterMetadataDTO => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  semester: n === 1 ? 'SPRING' : 'FALL',
  year: 2026,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  storedTotalCredits: n,
});
function page(semesters = [semester()], after: string | null = null): OwnStudyPlanSemestersDTO {
  return {
    visibility: 'CURRENT_ACCOUNT_ONLY',
    order: 'STORED_NEWEST_FIRST',
    scope: { userId: ownerId, curriculumId: null, studyPlansValidated: false },
    plan: {
      id: planId,
      name: 'Saved reference',
      description: null,
      isActive: true,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      semesterCount: 8,
    },
    pageSize: 5,
    after,
    semesters,
    nextAfter: null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const back = vi.fn();
const panel = (changes = {}) => (
  <SavedStudyPlanSemestersPanel
    ownerId={ownerId}
    planId={planId}
    expectedCurriculumId={null}
    onBack={back}
    {...changes}
  />
);
beforeEach(() => {
  vi.resetAllMocks();
  read.mockResolvedValue(page());
});
afterEach(cleanup);

describe('saved plan semester references', () => {
  it('focuses the detail heading on entry but not on subsequent reads', async () => {
    render(panel());
    expect(screen.getByRole('heading', { name: 'Saved plan semester references' })).toHaveFocus();
    await screen.findByRole('button', { name: /View courses for Spring 2026/ });
    const backButton = screen.getByRole('button', { name: 'Back to saved plans' });
    backButton.focus();
    act(() => window.dispatchEvent(new Event('focus')));
    await screen.findByRole('button', { name: /View courses for Spring 2026/ });
    expect(backButton).toHaveFocus();
  });
  it('opens the selected semester and returns through a fresh metadata read', async () => {
    const pending = deferred<OwnStudyPlanSemestersDTO>();
    read.mockResolvedValueOnce(page()).mockReturnValueOnce(pending.promise);
    render(panel());
    fireEvent.click(await screen.findByRole('button', { name: /View courses for Spring 2026/ }));
    expect(screen.getByTestId('selected-semester')).toHaveTextContent(semester().id);
    expect(screen.getByTestId('selected-context')).toHaveTextContent('unassigned');
    expect(screen.queryByText('Stored credit total: 1 · not verified')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to saved semesters' }));
    expect(screen.getByRole('heading', { name: 'Saved plan semester references' })).toHaveFocus();
    expect(screen.queryByTestId('selected-semester')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading saved semester references');
    await act(async () => pending.resolve(page([semester(2)])));
    expect(await screen.findByText('Stored credit total: 2 · not verified')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Saved plan semester references' })).toHaveFocus();
  });
  it('rejects a batched old course-selection event after focus refresh begins', async () => {
    const pending = deferred<OwnStudyPlanSemestersDTO>();
    read.mockResolvedValueOnce(page()).mockReturnValueOnce(pending.promise);
    render(panel());
    const old = await screen.findByRole('button', { name: /View courses for Spring 2026/ });
    act(() => {
      window.dispatchEvent(new Event('focus'));
      fireEvent.click(old);
    });
    expect(screen.queryByTestId('selected-semester')).not.toBeInTheDocument();
    await act(async () => pending.resolve(page([semester(2)])));
    expect(await screen.findByText('Stored credit total: 2 · not verified')).toBeInTheDocument();
  });
  it('hides selected course references when the expected curriculum changes', async () => {
    const view = render(panel());
    fireEvent.click(await screen.findByRole('button', { name: /View courses for Spring 2026/ }));
    const pending = deferred<OwnStudyPlanSemestersDTO>();
    read.mockReturnValueOnce(pending.promise);
    view.rerender(panel({ expectedCurriculumId: referenceId }));
    expect(screen.queryByTestId('selected-semester')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading saved semester references');
    const fresh = page();
    fresh.scope.curriculumId = referenceId;
    await act(async () => pending.resolve(fresh));
    fireEvent.click(await screen.findByRole('button', { name: /View courses for Spring 2026/ }));
    expect(screen.getByTestId('selected-context')).toHaveTextContent(referenceId);
  });

  it('shows stored labels and credits without claiming current validation or academic ordering', async () => {
    render(panel());
    await screen.findByRole('heading', { name: 'Saved reference' });
    expect(screen.getByRole('heading', { name: 'Spring 2026' })).toBeInTheDocument();
    expect(screen.getByText('Stored credit total: 1 · not verified')).toBeInTheDocument();
    expect(screen.getByText(/order is not an academic sequence/)).toBeInTheDocument();
    expect(
      screen.getByText(/current courses, prerequisites, GPA or a timetable/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /create|edit|activate|delete/i }),
    ).not.toBeInTheDocument();
  });
  it('shows a genuine empty plan without fabricating semester rows', async () => {
    read.mockResolvedValue(page([]));
    render(panel());
    expect(
      await screen.findByText('No saved semester references for this plan yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Older saved semesters' })).not.toBeInTheDocument();
  });
  it('browses older storage metadata and reloads the latest page', async () => {
    const first = page([9, 8, 7, 6, 5].map(semester));
    first.nextAfter = semester(5).id;
    read
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(page([semester(4)], semester(5).id))
      .mockResolvedValueOnce(page());
    render(panel());
    fireEvent.click(await screen.findByRole('button', { name: 'Older saved semesters' }));
    expect(screen.queryByText('Stored credit total: 9 · not verified')).not.toBeInTheDocument();
    await screen.findByText('Stored credit total: 4 · not verified');
    expect(read).toHaveBeenNthCalledWith(
      2,
      ownerId,
      planId,
      null,
      { after: semester(5).id },
      { boundary: semester(5), signal: expect.any(AbortSignal) },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Latest saved semesters' }));
    expect(await screen.findByText('Stored credit total: 1 · not verified')).toBeInTheDocument();
  });
  it('keeps back navigation available while pending so the parent can perform a fresh list read', () => {
    read.mockReturnValueOnce(deferred<OwnStudyPlanSemestersDTO>().promise);
    render(panel());
    expect(screen.getByRole('button', { name: 'Reload saved semesters' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to saved plans' }));
    expect(back).toHaveBeenCalledTimes(1);
  });
  it('hides previous evidence on reload failure and retries the same read', async () => {
    const pending = deferred<OwnStudyPlanSemestersDTO>();
    read
      .mockResolvedValueOnce(page())
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(page([semester(2)]));
    render(panel());
    await screen.findByRole('heading', { name: 'Saved reference' });
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved semesters' }));
    expect(screen.queryByText('Stored credit total: 1 · not verified')).not.toBeInTheDocument();
    await act(async () => pending.reject(new Error('offline')));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved semesters' }));
    expect(await screen.findByText('Stored credit total: 2 · not verified')).toBeInTheDocument();
  });
  it.each(['owner', 'scope', 'plan'] as const)(
    'rejects a mismatched %s response from an adapter',
    async (kind) => {
      const received = page();
      if (kind === 'owner') received.scope.userId = referenceId;
      if (kind === 'scope') received.scope.curriculumId = referenceId;
      if (kind === 'plan') received.plan.id = referenceId;
      read.mockResolvedValue(received);
      render(panel());
      await screen.findByRole('alert');
      expect(screen.queryByText('Stored credit total: 1 · not verified')).not.toBeInTheDocument();
    },
  );
  it.each(['resolve', 'reject'] as const)(
    'isolates an old selected plan %s after switching selection',
    async (outcome) => {
      const pending = deferred<OwnStudyPlanSemestersDTO>();
      const next = page([semester(2)]);
      next.plan.id = referenceId;
      next.plan.name = 'Other reference';
      read.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(next);
      const { rerender } = render(panel());
      await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      const signal = read.mock.calls[0][4]?.signal;
      rerender(panel({ planId: referenceId }));
      expect(signal?.aborted).toBe(true);
      await screen.findByRole('heading', { name: 'Other reference' });
      await act(async () => {
        if (outcome === 'resolve') pending.resolve(page());
        else pending.reject(new Error('old failure'));
      });
      expect(screen.queryByRole('heading', { name: 'Saved reference' })).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );
  it('hides confirmed evidence immediately when the expected curriculum changes', async () => {
    const pending = deferred<OwnStudyPlanSemestersDTO>();
    read.mockResolvedValueOnce(page()).mockReturnValueOnce(pending.promise);
    const { rerender } = render(panel());
    await screen.findByRole('heading', { name: 'Saved reference' });
    rerender(panel({ expectedCurriculumId: referenceId }));
    expect(screen.queryByText('Stored credit total: 1 · not verified')).not.toBeInTheDocument();
    await act(async () => pending.reject(new SavedStudyPlanSemestersSessionChangedError()));
    expect(await screen.findByRole('alert')).toHaveTextContent('account or curriculum');
  });
  it('refreshes on focus and ignores an older pending response', async () => {
    const pending = deferred<OwnStudyPlanSemestersDTO>();
    read.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page([semester(2)]));
    render(panel());
    fireEvent(window, new Event('focus'));
    await screen.findByText('Stored credit total: 2 · not verified');
    await act(async () => pending.resolve(page()));
    expect(screen.queryByText('Stored credit total: 1 · not verified')).not.toBeInTheDocument();
  });
  it.each([404, 409] as const)(
    'guides recovery for unavailable status %s without retrying stale references',
    async (status) => {
      read.mockRejectedValueOnce({ isAxiosError: true, response: { status } });
      render(panel());
      expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
      expect(
        screen.queryByRole('button', { name: 'Retry saved semesters' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Back to saved plans' })).toBeEnabled();
    },
  );

  it('returns focus to Reload saved semesters when the read finishes', async () => {
    render(panel());
    await screen.findByRole('button', { name: /View courses for Spring 2026/ });
    const pendingRead = deferred<OwnStudyPlanSemestersDTO>();
    read.mockReturnValueOnce(pendingRead.promise);
    const target = screen.getByRole('button', { name: 'Reload saved semesters' });
    target.focus();
    act(() => {
      fireEvent.click(target);
      target.blur();
    });
    await waitFor(() => expect(target).toBeDisabled());
    expect(document.activeElement).toBe(document.body);
    await act(async () => pendingRead.resolve(page()));
    await waitFor(() => expect(target).toBeEnabled());
    await waitFor(() => expect(document.activeElement).toBe(target));
  });

  it('puts focus on the failure message when a retry button is replaced', async () => {
    read.mockRejectedValueOnce(new Error('offline'));
    render(panel());
    const retry = await screen.findByRole('button', { name: 'Retry saved semesters' });
    read.mockRejectedValueOnce(new Error('offline'));
    retry.focus();
    act(() => {
      fireEvent.click(retry);
      retry.blur();
    });
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement).toHaveTextContent(
      'Could not confirm the saved semester references',
    );
  });
});
