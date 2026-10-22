import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnStudyPlanMetadataDTO, OwnStudyPlansDTO } from '@iu-study-planner/shared';
import { listSavedStudyPlans, SavedStudyPlansSessionChangedError } from '@/lib/savedStudyPlansApi';
import { ownerId, referenceId } from '@/test/fixtures/curriculumReference';
import { dropFocusToBody } from '@/test/dropFocusToBody';
import { SavedStudyPlansPanel } from '../SavedStudyPlansPanel';

vi.mock('@/lib/savedStudyPlansApi', async (original) => ({
  ...(await original<typeof import('@/lib/savedStudyPlansApi')>()),
  listSavedStudyPlans: vi.fn(),
}));
vi.mock('../SavedStudyPlanSemestersPanel', () => ({
  SavedStudyPlanSemestersPanel: ({
    ownerId: owner,
    planId,
    expectedCurriculumId,
    onBack,
  }: {
    ownerId: string;
    planId: string;
    expectedCurriculumId: string | null;
    onBack: () => void;
  }) => (
    <div aria-label="Selected semester references">
      <span data-testid="selected-plan">{planId}</span>
      <span data-testid="selected-owner">{owner}</span>
      <span data-testid="selected-curriculum">{expectedCurriculumId ?? 'unassigned'}</span>
      <button onClick={onBack}>Back to saved plans</button>
    </div>
  ),
}));
const read = vi.mocked(listSavedStudyPlans);
const metadata = (n = 1): OwnStudyPlanMetadataDTO => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: `Reference ${n}`,
  description: null,
  isActive: n === 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  semesterCount: 2,
});
function page(plans = [metadata()], after: string | null = null): OwnStudyPlansDTO {
  return {
    visibility: 'CURRENT_ACCOUNT_ONLY',
    order: 'STORED_NEWEST_FIRST',
    scope: { userId: ownerId, curriculumId: null, studyPlansValidated: false },
    pageSize: 5,
    after,
    plans,
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
beforeEach(() => {
  vi.resetAllMocks();
  read.mockResolvedValue(page());
});
afterEach(cleanup);

describe('saved study plan reference browser', () => {
  it('does not steal focus on initial load or background refresh', async () => {
    render(
      <>
        <button>Outside planner</button>
        <SavedStudyPlansPanel ownerId={ownerId} />
      </>,
    );
    const outside = screen.getByRole('button', { name: 'Outside planner' });
    outside.focus();
    await screen.findByRole('heading', { name: 'Reference 1' });
    expect(outside).toHaveFocus();
    act(() => window.dispatchEvent(new Event('focus')));
    await screen.findByRole('heading', { name: 'Reference 1' });
    expect(outside).toHaveFocus();
  });
  it('opens only the selected plan and requires a fresh list read when returning', async () => {
    const pending = deferred<OwnStudyPlansDTO>();
    read.mockResolvedValueOnce(page()).mockReturnValueOnce(pending.promise);
    render(<SavedStudyPlansPanel ownerId={ownerId} />);
    fireEvent.click(await screen.findByRole('button', { name: /View semesters for Reference 1/ }));
    expect(screen.getByTestId('selected-plan')).toHaveTextContent(metadata().id);
    expect(screen.getByTestId('selected-owner')).toHaveTextContent(ownerId);
    expect(screen.getByTestId('selected-curriculum')).toHaveTextContent('unassigned');
    expect(screen.queryByRole('heading', { name: 'Reference 1' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to saved plans' }));
    expect(screen.getByRole('heading', { name: 'Your saved study plans' })).toHaveFocus();
    expect(screen.queryByTestId('selected-plan')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Reference 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading your saved study plans');
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(page([metadata(2)])));
    expect(await screen.findByRole('heading', { name: 'Reference 2' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your saved study plans' })).toHaveFocus();
  });
  it('drops selected details on focus and pins a new selection to the freshly confirmed scope', async () => {
    const pending = deferred<OwnStudyPlansDTO>();
    read.mockResolvedValueOnce(page()).mockReturnValueOnce(pending.promise);
    render(<SavedStudyPlansPanel ownerId={ownerId} />);
    fireEvent.click(await screen.findByRole('button', { name: /View semesters for Reference 1/ }));
    act(() => window.dispatchEvent(new Event('focus')));
    expect(screen.queryByTestId('selected-plan')).not.toBeInTheDocument();
    const fresh = page([metadata(2)]);
    fresh.scope.curriculumId = referenceId;
    await act(async () => pending.resolve(fresh));
    fireEvent.click(await screen.findByRole('button', { name: /View semesters for Reference 2/ }));
    expect(screen.getByTestId('selected-plan')).toHaveTextContent(metadata(2).id);
    expect(screen.getByTestId('selected-curriculum')).toHaveTextContent(referenceId);
  });
  it('ignores a batched old selection after a fresh page read has begun', async () => {
    const pending = deferred<OwnStudyPlansDTO>();
    read.mockResolvedValueOnce(page()).mockReturnValueOnce(pending.promise);
    render(<SavedStudyPlansPanel ownerId={ownerId} />);
    const oldSelection = await screen.findByRole('button', {
      name: /View semesters for Reference 1/,
    });
    act(() => {
      window.dispatchEvent(new Event('focus'));
      fireEvent.click(oldSelection);
    });
    expect(screen.queryByTestId('selected-plan')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading your saved study plans');
    await act(async () => pending.resolve(page([metadata(2)])));
    expect(await screen.findByRole('heading', { name: 'Reference 2' })).toBeInTheDocument();
  });
  it('hides selected semester references when the parent account is blocked', async () => {
    const view = render(<SavedStudyPlansPanel ownerId={ownerId} />);
    fireEvent.click(await screen.findByRole('button', { name: /View semesters for Reference 1/ }));
    view.rerender(<SavedStudyPlansPanel ownerId={ownerId} blocked />);
    expect(screen.queryByTestId('selected-plan')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in as this account');
  });

  it('shows escaped metadata and honest active-marker wording without editing controls', async () => {
    read.mockResolvedValue(page([{ ...metadata(), description: '<script>untrusted</script>' }]));
    render(<SavedStudyPlansPanel ownerId={ownerId} />);
    await screen.findByRole('heading', { name: 'Reference 1' });
    expect(screen.getByText('<script>untrusted</script>')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText(/Previously marked active · 2 saved semesters/)).toBeInTheDocument();
    expect(
      screen.getByText(/not been verified against your current curriculum/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /create|edit|activate|delete/i }),
    ).not.toBeInTheDocument();
  });
  it('shows an empty account without inventing a plan', async () => {
    read.mockResolvedValue(page([]));
    render(<SavedStudyPlansPanel ownerId={ownerId} />);
    expect(
      await screen.findByText('No saved study plans for your account yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Older saved plans' })).not.toBeInTheDocument();
  });
  it('browses older metadata with a pinned boundary and returns to latest', async () => {
    const first = page([9, 8, 7, 6, 5].map(metadata));
    first.nextAfter = metadata(5).id;
    read
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(page([metadata(4)], metadata(5).id))
      .mockResolvedValueOnce(page());
    render(<SavedStudyPlansPanel ownerId={ownerId} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Older saved plans' }));
    expect(screen.queryByText('Reference 9')).not.toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Reference 4' });
    expect(read).toHaveBeenNthCalledWith(
      2,
      ownerId,
      { after: metadata(5).id },
      { boundary: metadata(5), expectedCurriculumId: null, signal: expect.any(AbortSignal) },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Latest saved plans' }));
    expect(await screen.findByRole('heading', { name: 'Reference 1' })).toBeInTheDocument();
  });
  it('hides confirmed metadata while reloading and on failure, then retries', async () => {
    const pending = deferred<OwnStudyPlansDTO>();
    read
      .mockResolvedValueOnce(page())
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(page([metadata(2)]));
    render(<SavedStudyPlansPanel ownerId={ownerId} />);
    await screen.findByRole('heading', { name: 'Reference 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved plans' }));
    expect(screen.queryByText('Reference 1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload saved plans' })).toBeDisabled();
    await act(async () => pending.reject(new Error('offline')));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved plans' }));
    expect(await screen.findByRole('heading', { name: 'Reference 2' })).toBeInTheDocument();
  });
  it('rejects a wrong owner response from an adapter', async () => {
    read.mockResolvedValue({ ...page(), scope: { ...page().scope, userId: referenceId } });
    render(<SavedStudyPlansPanel ownerId={ownerId} />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Reference 1')).not.toBeInTheDocument();
  });
  it.each(['scope', 'cursor', 'boundary'] as const)(
    'rejects a mismatched continuation %s from an adapter',
    async (kind) => {
      const first = page([9, 8, 7, 6, 5].map(metadata));
      first.nextAfter = metadata(5).id;
      const older = page(
        [metadata(kind === 'boundary' ? 6 : 4)],
        kind === 'cursor' ? null : metadata(5).id,
      );
      if (kind === 'scope') older.scope.curriculumId = referenceId;
      read.mockResolvedValueOnce(first).mockResolvedValueOnce(older);
      render(<SavedStudyPlansPanel ownerId={ownerId} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Older saved plans' }));
      await screen.findByRole('alert');
      expect(screen.queryByText('Reference 4')).not.toBeInTheDocument();
      expect(screen.queryByText('Reference 6')).not.toBeInTheDocument();
    },
  );
  it.each(['resolve', 'reject'] as const)(
    'isolates an old account pending %s from the next account',
    async (outcome) => {
      const pending = deferred<OwnStudyPlansDTO>();
      read.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({
        ...page([metadata(2)]),
        scope: { ...page().scope, userId: referenceId },
      });
      const { rerender } = render(<SavedStudyPlansPanel ownerId={ownerId} />);
      await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      const oldSignal = read.mock.calls[0][2]?.signal;
      rerender(<SavedStudyPlansPanel ownerId={referenceId} />);
      expect(oldSignal?.aborted).toBe(true);
      await screen.findByRole('heading', { name: 'Reference 2' });
      await act(async () => {
        if (outcome === 'resolve') pending.resolve(page());
        else pending.reject(new Error('old failure'));
      });
      expect(screen.getByRole('heading', { name: 'Reference 2' })).toBeInTheDocument();
      expect(screen.queryByText('Reference 1')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );
  it('hides old evidence and refreshes current scope on focus', async () => {
    const pending = deferred<OwnStudyPlansDTO>();
    read.mockResolvedValueOnce(page()).mockReturnValueOnce(pending.promise);
    render(<SavedStudyPlansPanel ownerId={ownerId} />);
    await screen.findByRole('heading', { name: 'Reference 1' });
    fireEvent(window, new Event('focus'));
    expect(screen.queryByText('Reference 1')).not.toBeInTheDocument();
    await act(async () =>
      pending.resolve({
        ...page([metadata(2)]),
        scope: { ...page().scope, curriculumId: referenceId },
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Reference 2' })).toBeInTheDocument();
  });
  it('ignores a stale reload after a newer focus refresh', async () => {
    const pending = deferred<OwnStudyPlansDTO>();
    read.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page([metadata(2)]));
    render(<SavedStudyPlansPanel ownerId={ownerId} />);
    fireEvent(window, new Event('focus'));
    await screen.findByRole('heading', { name: 'Reference 2' });
    await act(async () => pending.resolve(page()));
    expect(screen.queryByText('Reference 1')).not.toBeInTheDocument();
  });
  it('aborts pending work when blocked', async () => {
    const pending = deferred<OwnStudyPlansDTO>();
    read.mockReturnValueOnce(pending.promise);
    const { rerender } = render(<SavedStudyPlansPanel ownerId={ownerId} />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const signal = read.mock.calls[0][2]?.signal;
    rerender(<SavedStudyPlansPanel ownerId={ownerId} blocked />);
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in as this account');
    await act(async () => pending.resolve(page()));
    expect(screen.queryByText('Reference 1')).not.toBeInTheDocument();
  });
  it('shows session-change guidance without retrying an old continuation', async () => {
    read.mockRejectedValueOnce(new SavedStudyPlansSessionChangedError());
    render(<SavedStudyPlansPanel ownerId={ownerId} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('account or curriculum');
    expect(screen.queryByRole('button', { name: 'Retry saved plans' })).not.toBeInTheDocument();
  });
  it('returns to latest after an unavailable cursor', async () => {
    const first = page([9, 8, 7, 6, 5].map(metadata));
    first.nextAfter = metadata(5).id;
    read
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } });
    render(<SavedStudyPlansPanel ownerId={ownerId} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Older saved plans' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
    expect(screen.queryByText('Reference 9')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry saved plans' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved plans' }));
    expect(await screen.findByRole('heading', { name: 'Reference 1' })).toBeInTheDocument();
    expect(read).toHaveBeenNthCalledWith(
      3,
      ownerId,
      {},
      { boundary: undefined, expectedCurriculumId: undefined, signal: expect.any(AbortSignal) },
    );
  });

  it('returns focus to Reload saved plans when the read finishes', async () => {
    render(<SavedStudyPlansPanel ownerId={ownerId} />);
    await screen.findByRole('heading', { name: 'Reference 1' });
    const pendingRead = deferred<OwnStudyPlansDTO>();
    read.mockReturnValueOnce(pendingRead.promise);
    const target = screen.getByRole('button', { name: 'Reload saved plans' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reload saved plans' })).toBeEnabled(),
    );
    target.focus();
    fireEvent.click(target);
    await waitFor(() => expect(target).toBeDisabled());
    dropFocusToBody();
    expect(target).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
    await act(async () => pendingRead.resolve(page()));
    await waitFor(() => expect(target).toBeEnabled());
    await waitFor(() => expect(document.activeElement).toBe(target));
  });

  it('puts focus on the failure message when a retry button is replaced', async () => {
    read.mockRejectedValueOnce(new Error('offline'));
    render(<SavedStudyPlansPanel ownerId={ownerId} />);
    const retry = await screen.findByRole('button', { name: 'Retry saved plans' });
    read.mockRejectedValueOnce(new Error('offline'));
    retry.focus();
    act(() => {
      fireEvent.click(retry);
      retry.blur();
    });
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement).toHaveTextContent('Could not confirm your saved study plans');
  });
});
