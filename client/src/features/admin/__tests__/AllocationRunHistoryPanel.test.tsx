import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AllocationRunHistoryDTO,
  AllocationRunV1DTO,
  AuthUserDTO,
} from '@iu-study-planner/shared';
import { getSession } from '@/lib/api';
import { createAllocationRun, getAllocationRun, listAllocationRuns } from '@/lib/allocationRunsApi';
import { allocationHistory, allocationRun } from '@/test/fixtures/allocationRun';
import { allocationScope } from '@/test/fixtures/allocationPreview';
import { ownerId, referenceSession } from '@/test/fixtures/curriculumReference';
import { AllocationRunHistoryPanel } from '../AllocationRunHistoryPanel';

vi.mock('@/lib/api', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/allocationRunsApi', () => ({
  createAllocationRun: vi.fn(),
  getAllocationRun: vi.fn(),
  listAllocationRuns: vi.fn(),
}));
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const session = () => ({ ...referenceSession(null), role: 'ADMIN' as const });
const mount = (userId = ownerId, scope = allocationScope) =>
  render(<AllocationRunHistoryPanel userId={userId} scope={scope} />);
const reload = () => screen.getByRole('button', { name: 'Reload simulation history' });
const rows = () =>
  within(screen.getByRole('list', { name: 'Saved captures' })).getAllByRole('listitem');
const viewCapture = (index = 0) =>
  screen.getAllByRole('button', { name: /^View capture stored/ })[index];
const ready = () => waitFor(() => expect(reload()).toBeEnabled());
const detail = () => screen.queryByRole('region', { name: 'Selected simulation capture' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (failure: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function olderPage(boundary: AllocationRunV1DTO) {
  const page = allocationHistory();
  page.runs[0].id = otherId;
  page.runs[0].capturedAt = '2026-10-04T01:00:00.000Z';
  page.runs[0].createdAt = new Date(Date.parse(boundary.createdAt) - 1000).toISOString();
  return page;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue(session());
  vi.mocked(listAllocationRuns).mockResolvedValue(allocationHistory());
  vi.mocked(getAllocationRun).mockResolvedValue(allocationHistory().runs[0]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('simulation run history', () => {
  it('reads the first page with session checks and makes no capture or storage writes', async () => {
    const sessionWrites = vi.spyOn(Storage.prototype, 'setItem');
    const removes = vi.spyOn(Storage.prototype, 'removeItem');
    mount();
    await ready();
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(listAllocationRuns).toHaveBeenCalledExactlyOnceWith(allocationScope);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('Resource revision 3');
    expect(rows()[0]).toHaveTextContent('3 students · 1 assigned in simulation');
    expect(createAllocationRun).not.toHaveBeenCalled();
    expect(getAllocationRun).not.toHaveBeenCalled();
    fireEvent.click(viewCapture());
    await screen.findByRole('region', { name: 'Selected simulation capture' });
    fireEvent.click(reload());
    await ready();
    expect(sessionWrites).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
    expect(createAllocationRun).not.toHaveBeenCalled();
  });

  it('waits for fresh sessions both before GET and before publishing the page', async () => {
    const before = deferred<AuthUserDTO>();
    const after = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockReturnValueOnce(before.promise).mockReturnValueOnce(after.promise);
    mount();
    expect(listAllocationRuns).not.toHaveBeenCalled();
    await act(async () => before.resolve(session()));
    await waitFor(() => expect(listAllocationRuns).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('list', { name: 'Saved captures' })).not.toBeInTheDocument();
    await act(async () => after.resolve(session()));
    await ready();
    expect(rows()).toHaveLength(1);
  });

  it('replaces bounded pages and reloads the newest page without a cursor', async () => {
    const first = allocationHistory(allocationScope, 20, true);
    const next = olderPage(first.runs[19]);
    vi.mocked(listAllocationRuns)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(next)
      .mockResolvedValueOnce(first);
    mount();
    await ready();
    expect(rows()).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: 'Load older captures' }));
    await ready();
    expect(listAllocationRuns).toHaveBeenNthCalledWith(2, {
      ...allocationScope,
      after: first.nextAfter,
    });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('time')?.dateTime).toBe(next.runs[0].createdAt);
    expect(screen.queryByRole('button', { name: 'Load older captures' })).not.toBeInTheDocument();
    expect(screen.getByText('No older captures.')).toBeInTheDocument();
    fireEvent.click(reload());
    await ready();
    expect(listAllocationRuns).toHaveBeenNthCalledWith(3, allocationScope);
    expect(rows()).toHaveLength(20);
  });

  it('retries a failed older page with its original cursor while retaining the last verified page', async () => {
    const first = allocationHistory(allocationScope, 20, true);
    vi.mocked(listAllocationRuns)
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('Lost response'))
      .mockResolvedValueOnce(olderPage(first.runs[19]));
    mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Load older captures' }));
    await screen.findByRole('alert');
    expect(rows()).toHaveLength(20);
    expect(screen.queryByRole('button', { name: 'Load older captures' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry history page' }));
    await ready();
    expect(listAllocationRuns).toHaveBeenNthCalledWith(3, {
      ...allocationScope,
      after: first.nextAfter,
    });
    expect(rows()).toHaveLength(1);
  });

  it('supports empty history and explicitly retries a failed initial read', async () => {
    vi.mocked(listAllocationRuns)
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(allocationHistory(allocationScope, 0));
    mount();
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry history page' }));
    await ready();
    expect(screen.getByText('No saved simulation captures for this scenario.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^View capture/ })).not.toBeInTheDocument();
    expect(listAllocationRuns).toHaveBeenNthCalledWith(2, allocationScope);
  });

  it('locks rapid reload, older-page and detail clicks while one read is pending', async () => {
    const first = allocationHistory(allocationScope, 20, true);
    const pending = deferred<AllocationRunHistoryDTO>();
    vi.mocked(listAllocationRuns).mockResolvedValueOnce(first).mockReturnValueOnce(pending.promise);
    mount();
    await ready();
    const older = screen.getByRole('button', { name: 'Load older captures' });
    fireEvent.click(older);
    fireEvent.click(older);
    fireEvent.click(reload());
    fireEvent.click(viewCapture());
    await waitFor(() => expect(listAllocationRuns).toHaveBeenCalledTimes(2));
    expect(reload()).toBeDisabled();
    expect(getAllocationRun).not.toHaveBeenCalled();
    await act(async () => pending.resolve(olderPage(first.runs[19])));
    await ready();
    expect(listAllocationRuns).toHaveBeenCalledTimes(2);
  });

  it.each([null, { ...session(), role: 'STUDENT' as const }, { ...session(), id: otherId }])(
    'blocks a foreign or non-admin session before the page request %#',
    async (account) => {
      vi.mocked(getSession).mockResolvedValueOnce(account as unknown as AuthUserDTO);
      mount();
      await screen.findByRole('alert');
      expect(listAllocationRuns).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent('Your admin session changed');
      expect(screen.queryByRole('list', { name: 'Saved captures' })).not.toBeInTheDocument();
    },
  );

  it('discards a page after final session verification detects an account change', async () => {
    vi.mocked(getSession)
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce({ ...session(), id: otherId });
    mount();
    await screen.findByRole('alert');
    expect(listAllocationRuns).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('list', { name: 'Saved captures' })).not.toBeInTheDocument();
  });

  it.each(['owner', 'scope'] as const)(
    'ignores stale pending page responses after %s changes',
    async (change) => {
      const pending = deferred<AllocationRunHistoryDTO>();
      vi.mocked(listAllocationRuns).mockReturnValueOnce(pending.promise);
      const view = mount();
      await waitFor(() => expect(listAllocationRuns).toHaveBeenCalledTimes(1));
      const nextScope = change === 'scope' ? { ...allocationScope, year: 2027 } : allocationScope;
      const nextOwner = change === 'owner' ? otherId : ownerId;
      vi.mocked(getSession).mockResolvedValue({ ...session(), id: nextOwner });
      vi.mocked(listAllocationRuns).mockResolvedValueOnce(allocationHistory(nextScope, 0));
      view.rerender(<AllocationRunHistoryPanel userId={nextOwner} scope={nextScope} />);
      await ready();
      await act(async () => pending.resolve(allocationHistory()));
      expect(
        screen.getByText('No saved simulation captures for this scenario.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Saved captures' })).not.toBeInTheDocument();
      expect(getSession).toHaveBeenCalledTimes(3);
    },
  );

  it('ignores stale first and final session verification on scenario changes and unmount', async () => {
    const before = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockReturnValueOnce(before.promise);
    const view = mount();
    view.rerender(
      <AllocationRunHistoryPanel userId={ownerId} scope={{ ...allocationScope, year: 2027 }} />,
    );
    vi.mocked(listAllocationRuns).mockResolvedValueOnce(
      allocationHistory({ ...allocationScope, year: 2027 }, 0),
    );
    await ready();
    await act(async () => before.resolve(session()));
    expect(listAllocationRuns).toHaveBeenCalledTimes(1);
    const after = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockResolvedValueOnce(session()).mockReturnValueOnce(after.promise);
    vi.mocked(listAllocationRuns).mockResolvedValueOnce(
      allocationHistory({ ...allocationScope, year: 2027 }, 0),
    );
    fireEvent.click(reload());
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(5));
    view.unmount();
    await act(async () => after.resolve(session()));
    expect(
      screen.queryByRole('region', { name: 'Simulation run history' }),
    ).not.toBeInTheDocument();
  });

  it.each(['wrongScope', 'untrustedField', 'unsupportedVersion'] as const)(
    'rejects an unverified history page: %s',
    async (field) => {
      const page = allocationHistory();
      if (field === 'wrongScope') {
        page.scope.year = 2027;
        page.runs[0].result.scope.year = 2027;
      }
      if (field === 'unsupportedVersion') Object.assign(page.runs[0], { formatVersion: 2 });
      const reply = field === 'untrustedField' ? { ...page, students: [] } : page;
      vi.mocked(listAllocationRuns).mockResolvedValueOnce(reply);
      mount();
      await screen.findByRole('alert');
      expect(screen.queryByRole('list', { name: 'Saved captures' })).not.toBeInTheDocument();
    },
  );

  it.each(['cursor', 'newer', 'precision', 'tiedId'] as const)(
    'rejects an older page outside the stored-time/ID boundary: %s',
    async (kind) => {
      const first = allocationHistory(allocationScope, 20, true);
      const boundary = first.runs[19];
      boundary.createdAt = '2026-10-05T01:59:41.000100Z';
      const next = olderPage(boundary);
      if (kind === 'cursor') next.runs[0].id = boundary.id;
      if (kind === 'newer') next.runs[0].createdAt = '2026-10-05T02:00:00.000Z';
      if (kind === 'precision') next.runs[0].createdAt = '2026-10-05T01:59:41.000101Z';
      if (kind === 'tiedId') {
        next.runs[0].createdAt = boundary.createdAt;
        next.runs[0].id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      }
      vi.mocked(listAllocationRuns).mockResolvedValueOnce(first).mockResolvedValueOnce(next);
      mount();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Load older captures' }));
      await screen.findByRole('alert');
      expect(rows()).toHaveLength(20);
      expect(screen.getByRole('button', { name: 'Retry history page' })).toBeEnabled();
    },
  );

  it('accepts a lower ID at an identical storage timestamp across page boundaries', async () => {
    const first = allocationHistory(allocationScope, 20, true);
    const boundary = first.runs[19];
    const next = olderPage(boundary);
    next.runs[0].createdAt = boundary.createdAt;
    vi.mocked(listAllocationRuns).mockResolvedValueOnce(first).mockResolvedValueOnce(next);
    mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Load older captures' }));
    await ready();
    expect(rows()).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('normalizes owner/scenario identity without refetching after a casing-only rerender', async () => {
    const view = mount(ownerId.toUpperCase(), {
      ...allocationScope,
      curriculumId: allocationScope.curriculumId.toUpperCase(),
    });
    await ready();
    view.rerender(<AllocationRunHistoryPanel userId={ownerId} scope={allocationScope} />);
    await ready();
    expect(listAllocationRuns).toHaveBeenCalledExactlyOnceWith(allocationScope);
  });
});

describe('selected simulation capture', () => {
  it('keeps the page visible during detail GET, locks duplicate reads and publishes after a fresh final session', async () => {
    const pending = deferred<AllocationRunV1DTO>();
    const final = deferred<AuthUserDTO>();
    mount();
    await ready();
    vi.mocked(getSession).mockResolvedValueOnce(session()).mockReturnValueOnce(final.promise);
    vi.mocked(getAllocationRun).mockReturnValueOnce(pending.promise);
    const view = viewCapture();
    fireEvent.click(view);
    fireEvent.click(view);
    fireEvent.click(reload());
    await waitFor(() => expect(getAllocationRun).toHaveBeenCalledTimes(1));
    expect(getAllocationRun).toHaveBeenCalledWith(allocationHistory().runs[0].id, allocationScope);
    expect(rows()).toHaveLength(1);
    expect(detail()).not.toBeInTheDocument();
    await act(async () => pending.resolve(allocationHistory().runs[0]));
    expect(detail()).not.toBeInTheDocument();
    await act(async () => final.resolve(session()));
    await ready();
    expect(detail()).toBeInTheDocument();
    expect(listAllocationRuns).toHaveBeenCalledTimes(1);
  });

  it('clears previous detail immediately and retries the exact selected capture after a read failure', async () => {
    const page = allocationHistory(allocationScope, 2);
    vi.mocked(listAllocationRuns).mockResolvedValueOnce(page);
    vi.mocked(getAllocationRun)
      .mockResolvedValueOnce(page.runs[0])
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(page.runs[1]);
    mount();
    await ready();
    fireEvent.click(viewCapture());
    await ready();
    expect(detail()).toBeInTheDocument();
    fireEvent.click(viewCapture(1));
    expect(detail()).not.toBeInTheDocument();
    await screen.findByRole('alert');
    expect(rows()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Retry selected capture' }));
    await ready();
    expect(getAllocationRun).toHaveBeenNthCalledWith(3, page.runs[1].id, allocationScope);
    expect(detail()).toBeInTheDocument();
  });

  it.each(['wrongId', 'wrongScope', 'invalidTotals'] as const)(
    'rejects selected-run mismatches and malformed detail: %s',
    async (kind) => {
      const run = allocationHistory().runs[0];
      if (kind === 'wrongId') run.id = allocationRun().id;
      if (kind === 'wrongScope') run.result.scope.year = 2027;
      if (kind === 'invalidTotals') run.result.assignedStudentCount = 99;
      vi.mocked(getAllocationRun).mockResolvedValueOnce(run);
      mount();
      await ready();
      fireEvent.click(viewCapture());
      await screen.findByRole('alert');
      expect(detail()).not.toBeInTheDocument();
      expect(rows()).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Retry selected capture' })).toBeEnabled();
    },
  );

  it('clears history and detail when a selected capture detects a switched admin session', async () => {
    mount();
    await ready();
    vi.mocked(getSession)
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce({ ...session(), role: 'STUDENT' });
    fireEvent.click(viewCapture());
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Your admin session changed');
    expect(detail()).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Saved captures' })).not.toBeInTheDocument();
  });

  it.each(['owner', 'scope', 'unmount'] as const)(
    'ignores stale selected-run responses after %s',
    async (change) => {
      const pending = deferred<AllocationRunV1DTO>();
      vi.mocked(getAllocationRun).mockReturnValueOnce(pending.promise);
      const view = mount();
      await ready();
      fireEvent.click(viewCapture());
      await waitFor(() => expect(getAllocationRun).toHaveBeenCalledTimes(1));
      if (change === 'unmount') view.unmount();
      else {
        const nextScope = change === 'scope' ? { ...allocationScope, year: 2027 } : allocationScope;
        const nextOwner = change === 'owner' ? otherId : ownerId;
        vi.mocked(getSession).mockResolvedValue({ ...session(), id: nextOwner });
        vi.mocked(listAllocationRuns).mockResolvedValueOnce(allocationHistory(nextScope, 0));
        view.rerender(<AllocationRunHistoryPanel userId={nextOwner} scope={nextScope} />);
        await ready();
      }
      await act(async () => pending.resolve(allocationHistory().runs[0]));
      expect(detail()).not.toBeInTheDocument();
      expect(getSession).toHaveBeenCalledTimes(change === 'unmount' ? 3 : 5);
    },
  );

  it('resets selected inspection when reloading history and renders captured settings and simulation limits', async () => {
    mount();
    await ready();
    fireEvent.click(viewCapture());
    await ready();
    const panel = detail();
    expect(panel).toHaveTextContent('Students in captured cohort3');
    expect(panel).toHaveTextContent(
      'Captured resource revision 3. Professors: 1; classrooms: 1; lab rooms: 2; students per section: 1.',
    );
    expect(panel).toHaveTextContent(
      'Bayesian difficulty fit 70%, immediate prerequisite unlocks 30%',
    );
    expect(panel).toHaveTextContent(
      'student utility 60%, resource fit 25%, fairness 15%; congestion threshold 85%',
    );
    expect(panel).toHaveTextContent('Recommendation limits: 18 credits and 3.5 difficulty');
    expect(panel).toHaveTextContent('MA001IU · Scoped Calculus');
    expect(panel).toHaveTextContent(
      'no full-semester allocation or student assignments are stored',
    );
    expect(panel).toHaveTextContent('official offerings remain unverified');
    expect(
      panel?.querySelector(`time[datetime="${allocationHistory().runs[0].capturedAt}"]`),
    ).toBeInTheDocument();
    expect(
      panel?.querySelector(`time[datetime="${allocationHistory().runs[0].createdAt}"]`),
    ).toBeInTheDocument();
    fireEvent.click(reload());
    expect(detail()).not.toBeInTheDocument();
    await ready();
    expect(detail()).not.toBeInTheDocument();
  });
});
