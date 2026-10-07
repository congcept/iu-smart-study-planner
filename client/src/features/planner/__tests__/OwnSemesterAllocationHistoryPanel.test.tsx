import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OwnSemesterAllocationHistoryDTO,
  OwnSemesterAllocationRunV1DTO,
} from '@iu-study-planner/shared';
import apiClient from '@/lib/api';
import {
  getOwnSemesterAllocationRun,
  listOwnSemesterAllocationRuns,
  OwnSemesterSessionChangedError,
} from '@/lib/ownSemesterAllocationApi';
import { ownerId } from '@/test/fixtures/curriculumReference';
import { ownSemesterAllocationRun } from '@/test/fixtures/ownSemesterAllocationRun';
import { OwnSemesterAllocationHistoryPanel } from '../OwnSemesterAllocationHistoryPanel';

vi.mock('@/lib/api', () => ({ default: { post: vi.fn(), get: vi.fn() }, getSession: vi.fn() }));
vi.mock('@/lib/ownSemesterAllocationApi', async (original) => {
  const source = await original<typeof import('@/lib/ownSemesterAllocationApi')>();
  return {
    ...source,
    getOwnSemesterAllocationRun: vi.fn(),
    listOwnSemesterAllocationRuns: vi.fn(),
  };
});

const otherOwner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function page(
  runs = [ownSemesterAllocationRun()],
  after: string | null = null,
  more = false,
): OwnSemesterAllocationHistoryDTO {
  return {
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    visibility: 'CURRENT_ACCOUNT_ONLY',
    order: 'STORED_NEWEST_FIRST',
    pageSize: 5,
    after,
    runs,
    nextAfter: more ? runs.at(-1)!.id : null,
  };
}
const firstPage = () => page([5, 4, 3, 2, 1].map(ownSemesterAllocationRun), null, true);
function olderPage(boundary: OwnSemesterAllocationRunV1DTO) {
  const run = ownSemesterAllocationRun(0);
  run.createdAt = '2026-10-07T02:00:00.500Z';
  return page([run], boundary.id);
}
const mount = (owner = ownerId) => render(<OwnSemesterAllocationHistoryPanel ownerId={owner} />);
const reload = () => screen.getByRole('button', { name: 'Reload simulation history' });
const older = () => screen.getByRole('button', { name: 'Older results' });
const select = (index = 1) => screen.getByRole('button', { name: `View result ${index}` });
const ready = () => waitFor(() => expect(reload()).toBeEnabled());
const selected = () => screen.queryByRole('region', { name: 'Your simulation result' });
const hidden = () => {
  expect(screen.queryByRole('button', { name: /^View result/ })).not.toBeInTheDocument();
  expect(selected()).not.toBeInTheDocument();
  expect(screen.queryByText(/credits assigned/)).not.toBeInTheDocument();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (failure: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listOwnSemesterAllocationRuns).mockResolvedValue(page());
  vi.mocked(getOwnSemesterAllocationRun).mockResolvedValue(ownSemesterAllocationRun());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('current-account saved semester simulations', () => {
  it('loads only the current owner’s first page without writing or automatic focus refresh', async () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const removes = vi.spyOn(Storage.prototype, 'removeItem');
    mount();
    await ready();
    expect(listOwnSemesterAllocationRuns).toHaveBeenCalledExactlyOnceWith(ownerId, {}, undefined);
    expect(select()).toBeEnabled();
    expect(screen.getByText(/6 of 6 credits assigned/)).toBeInTheDocument();
    fireEvent(window, new Event('focus'));
    fireEvent(document, new Event('visibilitychange'));
    expect(listOwnSemesterAllocationRuns).toHaveBeenCalledTimes(1);
    expect(getOwnSemesterAllocationRun).not.toHaveBeenCalled();
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
  });

  it('shows loading with all private evidence hidden until the first page is confirmed', async () => {
    const pending = deferred<OwnSemesterAllocationHistoryDTO>();
    vi.mocked(listOwnSemesterAllocationRuns).mockReturnValueOnce(pending.promise);
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('Loading your saved semester simulations');
    expect(reload()).toBeDisabled();
    hidden();
    await act(async () => pending.resolve(page()));
    await ready();
    expect(select()).toBeEnabled();
  });

  it('shows honest empty history without an older-page or selected-result action', async () => {
    vi.mocked(listOwnSemesterAllocationRuns).mockResolvedValueOnce(page([]));
    mount();
    await ready();
    expect(
      screen.getByText('No saved semester simulations for your account yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Older results' })).not.toBeInTheDocument();
    expect(getOwnSemesterAllocationRun).not.toHaveBeenCalled();
  });

  it('distinguishes an empty continuation from having no saved history at all', async () => {
    const first = firstPage();
    vi.mocked(listOwnSemesterAllocationRuns)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(page([], first.runs[4].id));
    mount();
    await ready();
    fireEvent.click(older());
    await ready();
    expect(
      screen.getByText('No older saved semester simulations are available.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('No saved semester simulations for your account yet.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Older results' })).not.toBeInTheDocument();
    expect(reload()).toBeEnabled();
  });

  it('focuses the confirmed result heading and announces when a selected result is loaded', async () => {
    mount();
    await ready();
    select().focus();
    expect(select()).toHaveFocus();
    fireEvent.click(select());
    await ready();
    const heading = screen.getByRole('heading', { name: 'Your simulation result' });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Selected simulation result loaded.');
  });

  it('drops private evidence and pending reads while blocked, then starts fresh when unblocked', async () => {
    const view = render(<OwnSemesterAllocationHistoryPanel ownerId={ownerId} blocked />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in as this account');
    hidden();
    expect(listOwnSemesterAllocationRuns).not.toHaveBeenCalled();
    expect(getOwnSemesterAllocationRun).not.toHaveBeenCalled();
    view.rerender(<OwnSemesterAllocationHistoryPanel ownerId={ownerId} blocked={false} />);
    await ready();
    fireEvent.click(select());
    await ready();
    expect(selected()).toBeInTheDocument();
    const pending = deferred<OwnSemesterAllocationHistoryDTO>();
    vi.mocked(listOwnSemesterAllocationRuns).mockReturnValueOnce(pending.promise);
    fireEvent.click(reload());
    expect(listOwnSemesterAllocationRuns).toHaveBeenCalledTimes(2);
    view.rerender(<OwnSemesterAllocationHistoryPanel ownerId={ownerId} blocked />);
    hidden();
    expect(
      screen.queryByRole('button', { name: 'Reload simulation history' }),
    ).not.toBeInTheDocument();
    await act(async () => pending.resolve(page()));
    hidden();
    expect(listOwnSemesterAllocationRuns).toHaveBeenCalledTimes(2);
    expect(getOwnSemesterAllocationRun).toHaveBeenCalledTimes(1);
    view.rerender(<OwnSemesterAllocationHistoryPanel ownerId={ownerId} blocked={false} />);
    await ready();
    expect(listOwnSemesterAllocationRuns).toHaveBeenNthCalledWith(3, ownerId, {}, undefined);
    expect(selected()).not.toBeInTheDocument();
    expect(select()).toBeEnabled();
  });

  it('replaces pages using the exact confirmed boundary, then reloads the newest page without a cursor', async () => {
    const first = firstPage();
    const boundary = first.runs[4];
    const next = olderPage(boundary);
    vi.mocked(listOwnSemesterAllocationRuns)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(next)
      .mockResolvedValueOnce(first);
    mount();
    await ready();
    expect(screen.getAllByRole('button', { name: /^View result/ })).toHaveLength(5);
    fireEvent.click(older());
    await ready();
    expect(listOwnSemesterAllocationRuns).toHaveBeenNthCalledWith(
      2,
      ownerId,
      { after: boundary.id },
      boundary,
    );
    expect(screen.getAllByRole('button', { name: /^View result/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Older results' })).not.toBeInTheDocument();
    fireEvent.click(reload());
    await ready();
    expect(listOwnSemesterAllocationRuns).toHaveBeenNthCalledWith(3, ownerId, {}, undefined);
    expect(screen.getAllByRole('button', { name: /^View result/ })).toHaveLength(5);
  });

  it('hides the previous page after continuation failure and retries the same boundary', async () => {
    const first = firstPage();
    const boundary = first.runs[4];
    vi.mocked(listOwnSemesterAllocationRuns)
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('Lost page'))
      .mockResolvedValueOnce(olderPage(boundary));
    mount();
    await ready();
    fireEvent.click(older());
    await screen.findByRole('alert');
    hidden();
    expect(screen.queryByRole('button', { name: 'Older results' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry history read' }));
    await ready();
    expect(listOwnSemesterAllocationRuns).toHaveBeenNthCalledWith(
      3,
      ownerId,
      { after: boundary.id },
      boundary,
    );
    expect(select()).toBeEnabled();
  });

  it('clears both page and selected detail immediately while a reload is pending or fails', async () => {
    mount();
    await ready();
    fireEvent.click(select());
    await ready();
    expect(selected()).toBeInTheDocument();
    const pending = deferred<OwnSemesterAllocationHistoryDTO>();
    vi.mocked(listOwnSemesterAllocationRuns).mockReturnValueOnce(pending.promise);
    fireEvent.click(reload());
    hidden();
    await act(async () => pending.reject(new Error('Read unavailable')));
    await screen.findByRole('alert');
    hidden();
    fireEvent.click(screen.getByRole('button', { name: 'Retry history read' }));
    await ready();
    expect(select()).toBeEnabled();
    expect(selected()).not.toBeInTheDocument();
  });

  it('locks rapid duplicate reads while the current page action is pending', async () => {
    mount();
    await ready();
    const pending = deferred<OwnSemesterAllocationHistoryDTO>();
    vi.mocked(listOwnSemesterAllocationRuns).mockReturnValueOnce(pending.promise);
    const button = reload();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(reload()).toBeDisabled();
    hidden();
    expect(listOwnSemesterAllocationRuns).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(page()));
    await ready();
    expect(listOwnSemesterAllocationRuns).toHaveBeenCalledTimes(2);
  });

  it('reads the exact selected immutable receipt and publishes only after its result is confirmed', async () => {
    mount();
    await ready();
    const pending = deferred<OwnSemesterAllocationRunV1DTO>();
    vi.mocked(getOwnSemesterAllocationRun).mockReturnValueOnce(pending.promise);
    const button = select();
    fireEvent.click(button);
    fireEvent.click(button);
    hidden();
    expect(getOwnSemesterAllocationRun).toHaveBeenCalledExactlyOnceWith(
      ownerId,
      ownSemesterAllocationRun().id,
      ownSemesterAllocationRun(),
    );
    await act(async () => pending.resolve(ownSemesterAllocationRun()));
    await ready();
    expect(selected()).toBeInTheDocument();
    expect(select()).toBeEnabled();
  });

  it('hides all evidence after a selected read fails and retries only the same expected receipt', async () => {
    const runs = [ownSemesterAllocationRun(2), ownSemesterAllocationRun(1)];
    vi.mocked(listOwnSemesterAllocationRuns).mockResolvedValueOnce(page(runs));
    vi.mocked(getOwnSemesterAllocationRun)
      .mockResolvedValueOnce(runs[0])
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(runs[1]);
    mount();
    await ready();
    fireEvent.click(select());
    await ready();
    expect(selected()).toBeInTheDocument();
    fireEvent.click(select(2));
    hidden();
    await screen.findByRole('alert');
    hidden();
    fireEvent.click(screen.getByRole('button', { name: 'Retry result read' }));
    await ready();
    expect(getOwnSemesterAllocationRun).toHaveBeenNthCalledWith(3, ownerId, runs[1].id, runs[1]);
    expect(selected()).toBeInTheDocument();
  });

  it.each(['success', 'failure'] as const)(
    'ignores an older owner’s pending history %s after account remount',
    async (outcome) => {
      const pending = deferred<OwnSemesterAllocationHistoryDTO>();
      vi.mocked(listOwnSemesterAllocationRuns)
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce(page([]));
      const view = mount();
      view.rerender(<OwnSemesterAllocationHistoryPanel ownerId={otherOwner} />);
      await ready();
      await act(async () =>
        outcome === 'success'
          ? pending.resolve(page())
          : pending.reject(new Error('Old owner error')),
      );
      expect(
        screen.getByText('No saved semester simulations for your account yet.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      hidden();
      expect(listOwnSemesterAllocationRuns).toHaveBeenLastCalledWith(otherOwner, {}, undefined);
    },
  );

  it.each(['owner', 'unmount'] as const)(
    'ignores a stale selected result after %s changes',
    async (change) => {
      const pending = deferred<OwnSemesterAllocationRunV1DTO>();
      vi.mocked(getOwnSemesterAllocationRun).mockReturnValueOnce(pending.promise);
      const view = mount();
      await ready();
      fireEvent.click(select());
      if (change === 'unmount') view.unmount();
      else {
        vi.mocked(listOwnSemesterAllocationRuns).mockResolvedValueOnce(page([]));
        view.rerender(<OwnSemesterAllocationHistoryPanel ownerId={otherOwner} />);
        await ready();
      }
      await act(async () => pending.resolve(ownSemesterAllocationRun()));
      expect(selected()).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('normalizes owner casing without refetching or discarding the confirmed page', async () => {
    const view = mount(otherOwner.toUpperCase());
    await ready();
    view.rerender(<OwnSemesterAllocationHistoryPanel ownerId={otherOwner} />);
    await ready();
    expect(listOwnSemesterAllocationRuns).toHaveBeenCalledExactlyOnceWith(
      otherOwner,
      {},
      undefined,
    );
    expect(select()).toBeEnabled();
  });

  it.each(['private', 'creditTotals'] as const)(
    'rejects corrupt history %s with no private evidence shown',
    async (kind) => {
      const run = ownSemesterAllocationRun();
      const received =
        kind === 'private'
          ? { ...page(), students: [{ studentId: otherOwner }] }
          : page([{ ...run, result: { ...run.result, assignedCredits: 5 } }]);
      vi.mocked(listOwnSemesterAllocationRuns).mockResolvedValueOnce(received);
      mount();
      await screen.findByRole('alert');
      hidden();
      expect(screen.queryByText(otherOwner)).not.toBeInTheDocument();
    },
  );

  it('rejects an otherwise valid page with the wrong requested continuation', async () => {
    const first = firstPage();
    const next = olderPage(first.runs[4]);
    next.after = null;
    vi.mocked(listOwnSemesterAllocationRuns)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(next);
    mount();
    await ready();
    fireEvent.click(older());
    await screen.findByRole('alert');
    hidden();
    expect(screen.getByRole('button', { name: 'Retry history read' })).toBeEnabled();
  });

  it('preserves the original boundary and request when a reader mutates its cloned arguments', async () => {
    const first = firstPage();
    const boundary = structuredClone(first.runs[4]);
    vi.mocked(listOwnSemesterAllocationRuns)
      .mockResolvedValueOnce(first)
      .mockImplementationOnce(async (_owner, input, receivedBoundary) => {
        input!.after = otherOwner;
        receivedBoundary!.createdAt = '2026-10-07T02:00:03.000Z';
        const invalid = olderPage(boundary);
        invalid.runs[0].createdAt = '2026-10-07T02:00:02.000Z';
        return invalid;
      })
      .mockResolvedValueOnce(olderPage(boundary));
    mount();
    await ready();
    fireEvent.click(older());
    await screen.findByRole('alert');
    hidden();
    fireEvent.click(screen.getByRole('button', { name: 'Retry history read' }));
    await ready();
    expect(listOwnSemesterAllocationRuns).toHaveBeenNthCalledWith(
      3,
      ownerId,
      { after: boundary.id },
      boundary,
    );
    expect(select()).toBeEnabled();
  });

  it.each(['changedScope', 'private'] as const)(
    'rejects a selected immutable receipt with %s evidence',
    async (kind) => {
      mount();
      await ready();
      const run = ownSemesterAllocationRun();
      const received =
        kind === 'changedScope'
          ? { ...run, scope: { ...run.scope, year: 2027 } }
          : { ...run, result: { ...run.result, studentId: otherOwner } };
      vi.mocked(getOwnSemesterAllocationRun).mockResolvedValueOnce(received);
      fireEvent.click(select());
      await screen.findByRole('alert');
      hidden();
      expect(screen.getByRole('button', { name: 'Retry result read' })).toBeEnabled();
    },
  );

  it('preserves the selected expected receipt if a reader mutates its cloned argument', async () => {
    mount();
    await ready();
    vi.mocked(getOwnSemesterAllocationRun)
      .mockImplementationOnce(async (_owner, _id, expected) => {
        expected!.scope.year = 2027;
        return expected!;
      })
      .mockResolvedValueOnce(ownSemesterAllocationRun());
    fireEvent.click(select());
    await screen.findByRole('alert');
    hidden();
    fireEvent.click(screen.getByRole('button', { name: 'Retry result read' }));
    await ready();
    expect(getOwnSemesterAllocationRun).toHaveBeenNthCalledWith(
      2,
      ownerId,
      ownSemesterAllocationRun().id,
      ownSemesterAllocationRun(),
    );
    expect(selected()).toBeInTheDocument();
  });

  it.each([
    new OwnSemesterSessionChangedError(),
    { isAxiosError: true, response: { status: 401, data: { error: 'Private error' } } },
  ])('requires sign-in after an account error without exposing raw errors %#', async (error) => {
    vi.mocked(listOwnSemesterAllocationRuns).mockRejectedValueOnce(error);
    mount();
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in as this account');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Private');
    hidden();
    expect(screen.queryByRole('button', { name: 'Retry history read' })).not.toBeInTheDocument();
  });

  it('offers reload after an unavailable continuation instead of retrying its revoked cursor', async () => {
    vi.mocked(listOwnSemesterAllocationRuns)
      .mockResolvedValueOnce(firstPage())
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } });
    mount();
    await ready();
    fireEvent.click(older());
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Reload simulation history');
    hidden();
    expect(screen.queryByRole('button', { name: 'Retry history read' })).not.toBeInTheDocument();
    fireEvent.click(reload());
    await ready();
    expect(listOwnSemesterAllocationRuns).toHaveBeenNthCalledWith(3, ownerId, {}, undefined);
  });

  it('offers reload when the selected result is gone without substituting another result', async () => {
    vi.mocked(getOwnSemesterAllocationRun).mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 404 },
    });
    mount();
    await ready();
    fireEvent.click(select());
    await screen.findByRole('alert');
    hidden();
    expect(screen.getByRole('alert')).toHaveTextContent('no longer available');
    expect(screen.queryByRole('button', { name: 'Retry result read' })).not.toBeInTheDocument();
    expect(getOwnSemesterAllocationRun).toHaveBeenCalledTimes(1);
  });

  it('renders own credit totals, captured identifiers and an explicit missing-course-name explanation', async () => {
    mount();
    await ready();
    fireEvent.click(select());
    await ready();
    const detail = selected()!;
    expect(detail).toHaveTextContent('Credit target reached');
    for (const [label, value] of [
      ['Target credits', '6'],
      ['Assigned credits', '6'],
      ['Remaining credits', '0'],
    ])
      expect(within(detail).getByText(label).nextElementSibling).toHaveTextContent(value);
    expect(detail).toHaveTextContent('Course names were not captured');
    expect(detail).toHaveTextContent(ownSemesterAllocationRun().courses[0].courseId);
    expect(detail).toHaveTextContent(ownSemesterAllocationRun().scope.curriculumId);
    expect(
      detail.querySelector(`time[datetime="${ownSemesterAllocationRun().capturedAt}"]`),
    ).toBeInTheDocument();
    expect(screen.getByText(/Credit targets are simulation budgets/)).toHaveTextContent(
      'do not change your course selections',
    );
  });

  it('distinguishes absent resource information and an empty own assignment from capacity exhaustion', async () => {
    const run = ownSemesterAllocationRun();
    run.result = {
      targetCredits: 6,
      courseIds: [],
      assignedCredits: 0,
      remainingCredits: 6,
      reason: 'RESOURCE_UNKNOWN',
    };
    run.courses = [];
    vi.mocked(listOwnSemesterAllocationRuns).mockResolvedValueOnce(page([run]));
    vi.mocked(getOwnSemesterAllocationRun).mockResolvedValueOnce(run);
    mount();
    await ready();
    fireEvent.click(select());
    await ready();
    expect(selected()).toHaveTextContent('Resource information unavailable');
    expect(selected()).toHaveTextContent('No courses were assigned.');
    expect(selected()).not.toHaveTextContent('All eligible sections are full');
  });
});
