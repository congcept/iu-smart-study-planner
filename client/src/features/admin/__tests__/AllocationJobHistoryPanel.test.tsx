import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AllocationJobHistoryDTO,
  AllocationJobOutcomeDTO,
  AuthUserDTO,
  ResourceScopeDTO,
} from '@iu-study-planner/shared';
import { getSession } from '@/lib/api';
import {
  enqueueAllocationJob,
  executeAllocationJob,
  getAllocationJobOutcome,
  listAllocationJobs,
} from '@/lib/allocationJobsApi';
import { allocationScope } from '@/test/fixtures/allocationPreview';
import { ownerId, referenceSession } from '@/test/fixtures/curriculumReference';
import { AllocationJobHistoryPanel } from '../AllocationJobHistoryPanel';

vi.mock('@/lib/api', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/allocationJobsApi', () => ({
  enqueueAllocationJob: vi.fn(),
  executeAllocationJob: vi.fn(),
  getAllocationJobOutcome: vi.fn(),
  listAllocationJobs: vi.fn(),
}));
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const runId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const id = (n: number) => `${(n + 1).toString(16).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const session = () => ({ ...referenceSession(null), role: 'ADMIN' as const });
const job = (
  n = 0,
  status: AllocationJobOutcomeDTO['status'] = 'PENDING',
): AllocationJobOutcomeDTO => ({
  jobId: id(n),
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  executionModel: 'ATOMIC_SINGLE_JOB',
  scope: allocationScope,
  queuedAt: new Date(Date.parse('2026-10-06T01:01:00.000Z') - n * 1000).toISOString(),
  status,
  completedAt: status === 'PENDING' ? null : '2026-10-06T01:02:00.000Z',
  runId: status === 'SUCCEEDED' ? runId : null,
  failureCode: status === 'FAILED' ? 'PREVIEW_UNAVAILABLE' : null,
});
const page = (jobs = [job()], nextAfter: string | null = null): AllocationJobHistoryDTO => ({
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  scope: allocationScope,
  order: 'QUEUED_NEWEST_FIRST',
  pageSize: 20,
  jobs,
  nextAfter,
});
const firstPage = () => {
  const jobs = Array.from({ length: 20 }, (_, n) => job(n));
  return page(jobs, jobs.at(-1)!.jobId);
};
const mount = (userId = ownerId, scope: ResourceScopeDTO = allocationScope) =>
  render(<AllocationJobHistoryPanel userId={userId} scope={scope} />);
const reload = () => screen.getByRole('button', { name: 'Reload request history' });
const older = () => screen.getByRole('button', { name: 'Load older requests' });
const retryPage = () => screen.getByRole('button', { name: 'Retry history page' });
const choose = (n = 0) =>
  screen.getByRole('button', { name: new RegExp(`View request outcome ${id(n)},`) });
const detail = () => screen.queryByRole('region', { name: 'Selected request outcome' });
const ready = () => waitFor(() => expect(reload()).toBeEnabled());
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
  const saved = new Map([
    ['pending_resource_save:owner', 'resource draft'],
    ['allocation_job_request:owner', 'queued receipt'],
    ['allocation_run_capture:owner', 'capture retry'],
  ]);
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn((key: string) => saved.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => saved.set(key, value)),
    removeItem: vi.fn((key: string) => saved.delete(key)),
  });
  vi.mocked(getSession).mockResolvedValue(session());
  vi.mocked(listAllocationJobs).mockResolvedValue(page());
  vi.mocked(getAllocationJobOutcome).mockResolvedValue(job());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('bounded read-only simulation request history', () => {
  it('loads newest history with fresh admin checks and never writes requests or journals', async () => {
    mount();
    await ready();
    expect(listAllocationJobs).toHaveBeenCalledExactlyOnceWith(allocationScope);
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('region', { name: 'Simulation request history' })).toHaveTextContent(
      'These reads never enqueue or execute a request',
    );
    expect(screen.getByText(id(0))).toBeInTheDocument();
    expect(screen.getByText('Pending · no terminal outcome committed')).toBeInTheDocument();
    fireEvent.click(choose());
    await screen.findByRole('region', { name: 'Selected request outcome' });
    expect(enqueueAllocationJob).not.toHaveBeenCalled();
    expect(executeAllocationJob).not.toHaveBeenCalled();
    expect(sessionStorage.getItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('pending_resource_save:owner')).toBe('resource draft');
    expect(sessionStorage.getItem('allocation_job_request:owner')).toBe('queued receipt');
    expect(sessionStorage.getItem('allocation_run_capture:owner')).toBe('capture retry');
  });
  it('reports an empty scenario without offering an older page or detail action', async () => {
    vi.mocked(listAllocationJobs).mockResolvedValueOnce(page([]));
    mount();
    await ready();
    expect(
      screen.getByText('No queued simulation requests for this scenario.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load older requests' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
  it('replaces twenty rows with the older page and reload always returns to newest', async () => {
    vi.mocked(listAllocationJobs)
      .mockResolvedValueOnce(firstPage())
      .mockResolvedValueOnce(page([job(20), job(21)]))
      .mockResolvedValueOnce(page([job()]));
    mount();
    await ready();
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    fireEvent.click(older());
    await ready();
    expect(listAllocationJobs).toHaveBeenNthCalledWith(2, { ...allocationScope, after: id(19) });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText(id(0))).not.toBeInTheDocument();
    expect(screen.getByText('No older requests.')).toBeInTheDocument();
    fireEvent.click(reload());
    await ready();
    expect(listAllocationJobs).toHaveBeenNthCalledWith(3, allocationScope);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
  it('retries the exact failed continuation and retains the trusted previous boundary', async () => {
    vi.mocked(listAllocationJobs)
      .mockResolvedValueOnce(firstPage())
      .mockRejectedValueOnce(new Error('SECRET'))
      .mockResolvedValueOnce(page([job(20)]));
    mount();
    await ready();
    fireEvent.click(older());
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).not.toHaveTextContent('SECRET');
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    fireEvent.click(retryPage());
    await ready();
    expect(listAllocationJobs).toHaveBeenNthCalledWith(3, { ...allocationScope, after: id(19) });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
  it('retries a failed first page without inventing a continuation', async () => {
    vi.mocked(listAllocationJobs).mockRejectedValueOnce(new Error('offline'));
    mount();
    await screen.findByRole('alert');
    fireEvent.click(retryPage());
    await ready();
    expect(listAllocationJobs).toHaveBeenNthCalledWith(2, allocationScope);
  });
  it.each([
    'duplicate',
    'wrongScope',
    'order',
    'cursor',
    'pageSize',
    'overLimit',
    'extra',
    'invalidStatus',
  ] as const)('rejects malformed page %s without displaying unverified rows', async (field) => {
    const malformed = structuredClone(page());
    if (field === 'duplicate') malformed.jobs.push(job());
    if (field === 'wrongScope') malformed.jobs[0].scope.year = 2027;
    if (field === 'order') malformed.jobs = [job(1), job(0)];
    if (field === 'cursor') malformed.nextAfter = id(0);
    if (field === 'overLimit') malformed.jobs = Array.from({ length: 21 }, (_, n) => job(n));
    const value =
      field === 'pageSize'
        ? { ...malformed, pageSize: 10 }
        : field === 'extra'
          ? { ...malformed, users: ['SECRET'] }
          : field === 'invalidStatus'
            ? { ...malformed, jobs: [{ ...job(), status: 'QUEUED' }] }
            : malformed;
    vi.mocked(listAllocationJobs).mockResolvedValueOnce(value as AllocationJobHistoryDTO);
    mount();
    await screen.findByRole('alert');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).not.toHaveTextContent('SECRET');
  });
  it('rejects a valid foreign page scope even when its rows match that foreign scope', async () => {
    const foreignScope = { ...allocationScope, year: 2027 };
    vi.mocked(listAllocationJobs).mockResolvedValueOnce({
      ...page(),
      scope: foreignScope,
      jobs: [{ ...job(), scope: foreignScope }],
    });
    mount();
    await screen.findByRole('alert');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
  it.each(['repeatsCursor', 'newerTime', 'sameTimeHigherId', 'newerFraction'] as const)(
    'rejects continuation crossing immutable boundary: %s',
    async (field) => {
      const trusted = firstPage();
      trusted.jobs[19].queuedAt = '2026-10-06T01:00:00.000500Z';
      const boundary = trusted.jobs[19];
      const row =
        field === 'repeatsCursor'
          ? boundary
          : field === 'newerTime'
            ? job(0)
            : field === 'sameTimeHigherId'
              ? { ...job(20), queuedAt: boundary.queuedAt }
              : { ...job(20), queuedAt: '2026-10-06T01:00:00.000600Z' };
      vi.mocked(listAllocationJobs)
        .mockResolvedValueOnce(trusted)
        .mockResolvedValueOnce(page([row]));
      mount();
      await ready();
      fireEvent.click(older());
      await screen.findByRole('alert');
      expect(screen.getAllByRole('listitem')).toHaveLength(20);
      expect(screen.queryByText(id(20))).not.toBeInTheDocument();
      vi.mocked(listAllocationJobs).mockResolvedValueOnce(
        page([{ ...job(20), queuedAt: '2026-10-06T01:00:00.000400Z' }]),
      );
      fireEvent.click(retryPage());
      await ready();
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      expect(listAllocationJobs).toHaveBeenNthCalledWith(3, {
        ...allocationScope,
        after: boundary.jobId,
      });
    },
  );
  it('accepts equal enqueue instants ordered by lower ID and normalized fractional precision', async () => {
    const trusted = firstPage();
    trusted.jobs[19].queuedAt = '2026-10-06T01:00:00.000500Z';
    const lower = { ...job(), jobId: id(1), queuedAt: '2026-10-06T01:00:00.0005000Z' };
    vi.mocked(listAllocationJobs)
      .mockResolvedValueOnce(trusted)
      .mockResolvedValueOnce(page([lower]));
    mount();
    await ready();
    fireEvent.click(older());
    await ready();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('locks rapid reloads and detail actions while a page read is pending', async () => {
    const pending = deferred<AllocationJobHistoryDTO>();
    mount();
    await ready();
    vi.mocked(listAllocationJobs).mockReturnValueOnce(pending.promise);
    const button = reload();
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(listAllocationJobs).toHaveBeenCalledTimes(2));
    expect(button).toBeDisabled();
    expect(screen.queryByRole('button', { name: /View request outcome/ })).not.toBeInTheDocument();
    await act(async () => pending.resolve(page()));
    await ready();
    expect(listAllocationJobs).toHaveBeenCalledTimes(2);
  });
});

describe('selected immutable request outcome', () => {
  it('pins a newly observed terminal outcome across row clicks, failed reads and exact retries', async () => {
    vi.mocked(getAllocationJobOutcome)
      .mockResolvedValueOnce(job(0, 'SUCCEEDED'))
      .mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce(job())
      .mockResolvedValueOnce(job(0, 'SUCCEEDED'));
    mount();
    await ready();
    fireEvent.click(choose());
    await screen.findByRole('region', { name: 'Selected request outcome' });
    expect(screen.getByText('Succeeded · aggregate capture saved')).toBeInTheDocument();
    fireEvent.click(choose());
    await screen.findByRole('alert');
    expect(detail()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry selected outcome' }));
    await ready();
    expect(detail()).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry selected outcome' }));
    await screen.findByRole('region', { name: 'Selected request outcome' });
    expect(detail()).toHaveTextContent('Simulation completed');
    expect(getAllocationJobOutcome).toHaveBeenCalledTimes(4);
  });
  it('does not forget a known terminal tuple on failed reload or a contradictory matching-ID page', async () => {
    vi.mocked(getAllocationJobOutcome).mockResolvedValueOnce(job(0, 'SUCCEEDED'));
    vi.mocked(listAllocationJobs)
      .mockResolvedValueOnce(page())
      .mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page([job(0, 'SUCCEEDED')]));
    mount();
    await ready();
    fireEvent.click(choose());
    await screen.findByRole('region', { name: 'Selected request outcome' });
    fireEvent.click(reload());
    await screen.findByRole('alert');
    expect(detail()).not.toBeInTheDocument();
    fireEvent.click(retryPage());
    await ready();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(retryPage());
    await ready();
    expect(screen.getByText('Succeeded · aggregate capture saved')).toBeInTheDocument();
  });
  it('discards off-page terminal observations when replacing history, keeping memory bounded to one page', async () => {
    vi.mocked(getAllocationJobOutcome).mockResolvedValueOnce(job(0, 'SUCCEEDED'));
    vi.mocked(listAllocationJobs)
      .mockResolvedValueOnce(firstPage())
      .mockResolvedValueOnce(page([job(20)]))
      .mockResolvedValueOnce(page());
    mount();
    await ready();
    fireEvent.click(choose());
    await screen.findByRole('region', { name: 'Selected request outcome' });
    fireEvent.click(older());
    await ready();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(reload());
    await ready();
    expect(screen.getByText('Pending · no terminal outcome committed')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('rejects conflicting terminal tuples on page refresh after a pending detail has completed', async () => {
    vi.mocked(getAllocationJobOutcome).mockResolvedValueOnce(job(0, 'SUCCEEDED'));
    vi.mocked(listAllocationJobs)
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page([{ ...job(0, 'SUCCEEDED'), runId: otherId }]));
    mount();
    await ready();
    fireEvent.click(choose());
    await screen.findByRole('region', { name: 'Selected request outcome' });
    fireEvent.click(reload());
    await screen.findByRole('alert');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(detail()).not.toBeInTheDocument();
  });
  it('reads the selected ID and permits pending rows to advance to a committed capture', async () => {
    vi.mocked(getAllocationJobOutcome).mockResolvedValueOnce(job(0, 'SUCCEEDED'));
    mount();
    await ready();
    fireEvent.click(choose());
    const panel = await screen.findByRole('region', { name: 'Selected request outcome' });
    expect(getAllocationJobOutcome).toHaveBeenCalledExactlyOnceWith(id(0), allocationScope);
    expect(getSession).toHaveBeenCalledTimes(4);
    expect(panel).toHaveTextContent('student plans and progress are unchanged');
    expect(within(panel).getByText(runId)).toBeInTheDocument();
    expect(panel.querySelector(`time[datetime="${job().queuedAt}"]`)).toBeInTheDocument();
  });
  it('explains PENDING without claiming an idle worker or starting work', async () => {
    mount();
    await ready();
    fireEvent.click(choose());
    await screen.findByRole('region', { name: 'Selected request outcome' });
    expect(detail()).toHaveTextContent('Another execution may be in progress');
    expect(enqueueAllocationJob).not.toHaveBeenCalled();
    expect(executeAllocationJob).not.toHaveBeenCalled();
  });
  it.each(['AUTHOR_UNAVAILABLE', 'PREVIEW_UNAVAILABLE'] as const)(
    'uses fixed public copy for %s',
    async (failureCode) => {
      vi.mocked(getAllocationJobOutcome).mockResolvedValueOnce({
        ...job(0, 'FAILED'),
        failureCode,
      });
      mount();
      await ready();
      fireEvent.click(choose());
      await screen.findByRole('region', { name: 'Selected request outcome' });
      expect(detail()).toHaveTextContent('No capture was saved');
    },
  );
  it('clears old detail immediately and retries the exact failed selection', async () => {
    vi.mocked(listAllocationJobs).mockResolvedValueOnce(page([job(0), job(1)]));
    vi.mocked(getAllocationJobOutcome)
      .mockResolvedValueOnce(job(0, 'SUCCEEDED'))
      .mockRejectedValueOnce(new Error('SECRET'))
      .mockResolvedValueOnce(job(1));
    mount();
    await ready();
    fireEvent.click(choose());
    await screen.findByRole('region', { name: 'Selected request outcome' });
    fireEvent.click(choose(1));
    expect(detail()).not.toBeInTheDocument();
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).not.toHaveTextContent('SECRET');
    fireEvent.click(screen.getByRole('button', { name: 'Retry selected outcome' }));
    await screen.findByRole('region', { name: 'Selected request outcome' });
    expect(getAllocationJobOutcome).toHaveBeenNthCalledWith(3, id(1), allocationScope);
  });
  it('clears detail when paging or reloading without automatic detail reads', async () => {
    vi.mocked(listAllocationJobs)
      .mockResolvedValueOnce(firstPage())
      .mockResolvedValueOnce(page([job(20)]))
      .mockResolvedValueOnce(page());
    mount();
    await ready();
    fireEvent.click(choose());
    await screen.findByRole('region', { name: 'Selected request outcome' });
    fireEvent.click(older());
    expect(detail()).not.toBeInTheDocument();
    await ready();
    fireEvent.click(reload());
    await ready();
    expect(getAllocationJobOutcome).toHaveBeenCalledTimes(1);
  });
  it.each(['id', 'scope', 'queuedAt', 'extra', 'invalidTerminal'] as const)(
    'rejects malformed or unbound detail %s',
    async (field) => {
      const value =
        field === 'id'
          ? { ...job(), jobId: otherId }
          : field === 'scope'
            ? { ...job(), scope: { ...allocationScope, year: 2027 } }
            : field === 'queuedAt'
              ? { ...job(), queuedAt: '2026-10-06T01:00:00.000Z' }
              : field === 'extra'
                ? { ...job(), privateError: 'SECRET' }
                : { ...job(), runId };
      vi.mocked(getAllocationJobOutcome).mockResolvedValueOnce(value);
      mount();
      await ready();
      fireEvent.click(choose());
      await screen.findByRole('alert');
      expect(detail()).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry selected outcome' })).toBeEnabled();
      expect(screen.getByRole('alert')).not.toHaveTextContent('SECRET');
    },
  );
  it.each(['status', 'runId', 'completedAt', 'failureCode'] as const)(
    'does not accept changed immutable terminal data %s',
    async (field) => {
      const terminal = job(0, field === 'failureCode' ? 'FAILED' : 'SUCCEEDED');
      vi.mocked(listAllocationJobs).mockResolvedValueOnce(page([terminal]));
      const value =
        field === 'status'
          ? job()
          : field === 'runId'
            ? { ...terminal, runId: otherId }
            : field === 'completedAt'
              ? { ...terminal, completedAt: '2026-10-06T01:03:00.000Z' }
              : { ...terminal, failureCode: 'AUTHOR_UNAVAILABLE' as const };
      vi.mocked(getAllocationJobOutcome).mockResolvedValueOnce(value);
      mount();
      await ready();
      fireEvent.click(choose());
      await screen.findByRole('alert');
      expect(detail()).not.toBeInTheDocument();
    },
  );
  it('serializes double selection while detail is pending', async () => {
    const pending = deferred<AllocationJobOutcomeDTO>();
    vi.mocked(getAllocationJobOutcome).mockReturnValueOnce(pending.promise);
    mount();
    await ready();
    const button = choose();
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(getAllocationJobOutcome).toHaveBeenCalledTimes(1));
    expect(reload()).toBeDisabled();
    expect(button).toBeDisabled();
    await act(async () => pending.resolve(job()));
    await ready();
    expect(getAllocationJobOutcome).toHaveBeenCalledTimes(1);
  });
});

describe('fresh role checks and stale context isolation', () => {
  it.each([
    ['page', 401],
    ['page', 403],
    ['detail', 401],
    ['detail', 403],
  ] as const)(
    'clears private history for a protected %s response with status %i',
    async (operation, status) => {
      const failure = { isAxiosError: true, response: { status, data: { error: 'SECRET' } } };
      if (operation === 'page') {
        vi.mocked(listAllocationJobs).mockRejectedValueOnce(failure);
        mount();
      } else {
        mount();
        await ready();
        vi.mocked(getAllocationJobOutcome).mockRejectedValueOnce(failure);
        fireEvent.click(choose());
      }
      await screen.findByRole('alert');
      expect(screen.getByRole('alert')).toHaveTextContent('admin session changed');
      expect(screen.getByRole('alert')).not.toHaveTextContent('SECRET');
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
      expect(detail()).not.toBeInTheDocument();
    },
  );
  it.each([null, { ...session(), role: 'STUDENT' as const }, { ...session(), id: otherId }])(
    'rejects current session before initial read %#',
    async (account) => {
      vi.mocked(getSession).mockResolvedValueOnce(account as unknown as AuthUserDTO);
      mount();
      await screen.findByRole('alert');
      expect(listAllocationJobs).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent('admin session changed');
    },
  );
  it.each(['page', 'detail'] as const)(
    'does not publish %s after the response authorization changes',
    async (operation) => {
      if (operation === 'page') {
        vi.mocked(getSession)
          .mockResolvedValueOnce(session())
          .mockResolvedValueOnce({ ...session(), role: 'STUDENT' });
        mount();
      } else {
        mount();
        await ready();
        vi.mocked(getSession)
          .mockResolvedValueOnce(session())
          .mockResolvedValueOnce({ ...session(), id: otherId });
        fireEvent.click(choose());
      }
      await screen.findByRole('alert');
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
      expect(detail()).not.toBeInTheDocument();
    },
  );
  it('checks role again before a selected read and does not leak old page on demotion', async () => {
    mount();
    await ready();
    vi.mocked(getSession).mockResolvedValueOnce({ ...session(), role: 'STUDENT' });
    fireEvent.click(choose());
    await screen.findByRole('alert');
    expect(getAllocationJobOutcome).not.toHaveBeenCalled();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
  it.each(['owner', 'scope'] as const)(
    'ignores stale initial authorization after %s changes',
    async (change) => {
      const pending = deferred<AuthUserDTO>();
      vi.mocked(getSession).mockReturnValueOnce(pending.promise);
      const view = mount();
      view.rerender(
        <AllocationJobHistoryPanel
          userId={change === 'owner' ? otherId : ownerId}
          scope={change === 'scope' ? { ...allocationScope, year: 2027 } : allocationScope}
        />,
      );
      vi.mocked(getSession).mockResolvedValue({
        ...session(),
        id: change === 'owner' ? otherId : ownerId,
      });
      await screen.findByRole('alert');
      const calls = vi.mocked(listAllocationJobs).mock.calls.length;
      await act(async () => pending.resolve(session()));
      expect(listAllocationJobs).toHaveBeenCalledTimes(calls);
    },
  );
  it.each(
    (
      [
        'pageSuccess',
        'pageFailure',
        'detailSuccess',
        'detailFailure',
        'pageFinalAuth',
        'detailFinalAuth',
      ] as const
    ).flatMap((stage) => (['owner', 'scope'] as const).map((change) => [stage, change] as const)),
  )('ignores stale %s after %s switch', async (stage, change) => {
    const pageRead = deferred<AllocationJobHistoryDTO>();
    const detailRead = deferred<AllocationJobOutcomeDTO>();
    const final = deferred<AuthUserDTO>();
    if (stage.startsWith('page')) {
      if (stage === 'pageFinalAuth')
        vi.mocked(getSession).mockResolvedValueOnce(session()).mockReturnValueOnce(final.promise);
      else vi.mocked(listAllocationJobs).mockReturnValueOnce(pageRead.promise);
    }
    const view = mount();
    if (stage.startsWith('detail')) {
      await ready();
      if (stage === 'detailFinalAuth')
        vi.mocked(getSession).mockResolvedValueOnce(session()).mockReturnValueOnce(final.promise);
      else vi.mocked(getAllocationJobOutcome).mockReturnValueOnce(detailRead.promise);
      fireEvent.click(choose());
      await waitFor(() => expect(getAllocationJobOutcome).toHaveBeenCalledTimes(1));
    } else await waitFor(() => expect(listAllocationJobs).toHaveBeenCalledTimes(1));
    if (stage.endsWith('FinalAuth'))
      await waitFor(() =>
        expect(getSession).toHaveBeenCalledTimes(stage === 'pageFinalAuth' ? 2 : 4),
      );
    view.rerender(
      <AllocationJobHistoryPanel
        userId={change === 'owner' ? otherId : ownerId}
        scope={change === 'scope' ? { ...allocationScope, year: 2027 } : allocationScope}
      />,
    );
    await screen.findByRole('alert');
    const authCalls = vi.mocked(getSession).mock.calls.length;
    await act(async () => {
      if (stage.endsWith('FinalAuth')) final.resolve(session());
      else if (stage === 'pageSuccess') pageRead.resolve(page());
      else if (stage === 'pageFailure') pageRead.reject(new Error('SECRET'));
      else if (stage === 'detailSuccess') detailRead.resolve(job(0, 'SUCCEEDED'));
      else detailRead.reject(new Error('SECRET'));
    });
    expect(getSession).toHaveBeenCalledTimes(authCalls);
    expect(detail()).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).not.toHaveTextContent('SECRET');
    expect(enqueueAllocationJob).not.toHaveBeenCalled();
    expect(executeAllocationJob).not.toHaveBeenCalled();
  });
});
