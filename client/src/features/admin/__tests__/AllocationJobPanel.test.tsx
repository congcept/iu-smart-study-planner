import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AllocationJobDTO,
  AllocationJobOutcomeDTO,
  AuthUserDTO,
  ResourceScopeDTO,
} from '@iu-study-planner/shared';
import { getSession } from '@/lib/api';
import {
  enqueueAllocationJob,
  executeAllocationJob,
  getAllocationJob,
  getAllocationJobOutcome,
} from '@/lib/allocationJobsApi';
import { allocationScope } from '@/test/fixtures/allocationPreview';
import { ownerId, referenceSession } from '@/test/fixtures/curriculumReference';
import { AllocationJobPanel } from '../AllocationJobPanel';
import { allocationJobRecoveryKey } from '../allocationJobRecovery';

vi.mock('@/lib/api', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/allocationJobsApi', () => ({
  enqueueAllocationJob: vi.fn(),
  executeAllocationJob: vi.fn(),
  getAllocationJob: vi.fn(),
  getAllocationJobOutcome: vi.fn(),
}));
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const jobId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const runId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const queuedAt = '2026-10-06T01:00:00.000Z';
const completedAt = '2026-10-06T01:01:00.000Z';
const session = () => ({ ...referenceSession(null), role: 'ADMIN' as const });
const receipt = (): AllocationJobDTO => ({
  id: jobId,
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  scope: allocationScope,
  status: 'QUEUED',
  queuedAt,
  inputsCaptured: false,
});
const outcome = (
  status: AllocationJobOutcomeDTO['status'] = 'PENDING',
): AllocationJobOutcomeDTO => ({
  jobId,
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  executionModel: 'ATOMIC_SINGLE_JOB',
  scope: allocationScope,
  queuedAt,
  status,
  completedAt: status === 'PENDING' ? null : completedAt,
  runId: status === 'SUCCEEDED' ? runId : null,
  failureCode: status === 'FAILED' ? 'PREVIEW_UNAVAILABLE' : null,
});
const request = (scope = allocationScope, owner = ownerId) => ({
  ...scope,
  requestId,
  expectedActorId: owner,
});
const journal = (id?: string) => ({
  version: 1,
  ownerId,
  request: request(),
  ...(id ? { jobId: id } : {}),
});
const storageKey = () => allocationJobRecoveryKey(ownerId, allocationScope);
const seed = (id?: string) => sessionStorage.setItem(storageKey(), JSON.stringify(journal(id)));
const readJournal = () =>
  JSON.parse(sessionStorage.getItem(storageKey()) ?? 'null') as {
    request: { requestId: string };
    jobId?: string;
  } | null;
const mount = (userId = ownerId, scope: ResourceScopeDTO = allocationScope) =>
  render(<AllocationJobPanel userId={userId} scope={scope} />);
const queue = () => screen.getByRole('button', { name: 'Queue simulation request' });
const retry = () => screen.getByRole('button', { name: 'Retry queued request' });
const check = () => screen.getByRole('button', { name: 'Check request outcome' });
const execute = () => screen.getByRole('button', { name: 'Execute selected request' });
const recovery = () => screen.getByRole('button', { name: 'Retry request recovery' });
const ready = () =>
  waitFor(() => expect(screen.queryByText('Checking simulation request…')).not.toBeInTheDocument());
async function showPending() {
  seed(jobId);
  mount();
  await screen.findByRole('button', { name: 'Execute selected request' });
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
  const saved = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn((key: string) => saved.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      saved.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      saved.delete(key);
    }),
  });
  vi.mocked(getSession).mockResolvedValue(session());
  vi.mocked(enqueueAllocationJob).mockResolvedValue(receipt());
  vi.mocked(getAllocationJob).mockResolvedValue(receipt());
  vi.mocked(getAllocationJobOutcome).mockResolvedValue(outcome());
  vi.mocked(executeAllocationJob).mockResolvedValue({
    processed: true,
    outcome: outcome('SUCCEEDED'),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('explicit queued simulation panel', () => {
  it('mounts with no POST, no session check and honest one-course simulation limits', async () => {
    mount();
    await ready();
    expect(queue()).toBeEnabled();
    expect(enqueueAllocationJob).not.toHaveBeenCalled();
    expect(executeAllocationJob).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
    const panel = screen.getByRole('region', { name: 'Queued simulation request' });
    expect(panel).toHaveTextContent('one-course allocation round');
    expect(panel).toHaveTextContent(
      'Unsaved edits are excluded. No student assignments are saved.',
    );
  });
  it('confirms a durable request before POST and a receipt before outcome GET', async () => {
    vi.mocked(enqueueAllocationJob).mockImplementation(async (input) => {
      expect(readJournal()).toMatchObject({ request: input });
      return receipt();
    });
    vi.mocked(getAllocationJobOutcome).mockImplementation(async () => {
      expect(readJournal()?.jobId).toBe(jobId);
      return outcome();
    });
    mount();
    await ready();
    fireEvent.click(queue());
    await screen.findByRole('button', { name: 'Execute selected request' });
    expect(enqueueAllocationJob).toHaveBeenCalledExactlyOnceWith({
      ...allocationScope,
      expectedActorId: ownerId,
      requestId: expect.stringMatching(/^[\da-f-]{36}$/),
    });
    expect(getAllocationJobOutcome).toHaveBeenCalledExactlyOnceWith(jobId, allocationScope);
    expect(getSession).toHaveBeenCalledTimes(4);
    expect(executeAllocationJob).not.toHaveBeenCalled();
    expect(queue()).toBeDisabled();
    expect(sessionStorage.getItem(storageKey())).not.toContain('ATOMIC_SINGLE_JOB');
  });
  it('uses the original durable key after a lost response and remount never retries automatically', async () => {
    vi.mocked(enqueueAllocationJob).mockRejectedValueOnce(new Error('lost'));
    const view = mount();
    await ready();
    fireEvent.click(queue());
    await screen.findByRole('alert');
    const original = vi.mocked(enqueueAllocationJob).mock.calls[0][0];
    expect(readJournal()?.request.requestId).toBe(original.requestId);
    view.unmount();
    mount();
    await ready();
    expect(enqueueAllocationJob).toHaveBeenCalledTimes(1);
    expect(retry()).toBeEnabled();
    fireEvent.click(retry());
    await screen.findByRole('button', { name: 'Execute selected request' });
    expect(vi.mocked(enqueueAllocationJob).mock.calls[1][0]).toEqual(original);
    expect(executeAllocationJob).not.toHaveBeenCalled();
  });
  it('recovers a stored pending key only through an explicit retry', async () => {
    seed();
    mount();
    await ready();
    expect(retry()).toBeEnabled();
    expect(getSession).not.toHaveBeenCalled();
    expect(enqueueAllocationJob).not.toHaveBeenCalled();
    fireEvent.click(retry());
    await screen.findByRole('button', { name: 'Execute selected request' });
    expect(enqueueAllocationJob).toHaveBeenCalledExactlyOnceWith(request());
  });
  it('recovers a receipt with read-only job and outcome checks', async () => {
    await showPending();
    expect(getAllocationJob).toHaveBeenCalledExactlyOnceWith(jobId, allocationScope);
    expect(getAllocationJobOutcome).toHaveBeenCalledExactlyOnceWith(jobId, allocationScope);
    expect(getSession).toHaveBeenCalledTimes(4);
    expect(enqueueAllocationJob).not.toHaveBeenCalled();
    expect(executeAllocationJob).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Another execution may be in progress');
  });
  it('executes only the selected request and permits a new key only after a terminal result', async () => {
    await showPending();
    const before = readJournal();
    fireEvent.click(execute());
    await screen.findByText(/Simulation completed/);
    expect(executeAllocationJob).toHaveBeenCalledExactlyOnceWith(jobId, {
      ...allocationScope,
      expectedActorId: ownerId,
    });
    expect(enqueueAllocationJob).not.toHaveBeenCalled();
    expect(readJournal()).toEqual(before);
    expect(screen.getByText(runId)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Queue another request' }));
    await screen.findByRole('button', { name: 'Execute selected request' });
    expect(enqueueAllocationJob).toHaveBeenCalledTimes(1);
    expect(readJournal()?.request.requestId).not.toBe(requestId);
  });
  it('requires explicit outcome checking after an ambiguous execution before retrying the same job', async () => {
    vi.mocked(executeAllocationJob).mockRejectedValueOnce(new Error('response lost'));
    await showPending();
    fireEvent.click(execute());
    await screen.findByRole('alert');
    expect(
      screen.queryByRole('button', { name: 'Execute selected request' }),
    ).not.toBeInTheDocument();
    expect(queue()).toBeDisabled();
    expect(getAllocationJobOutcome).toHaveBeenCalledTimes(1);
    fireEvent.click(check());
    await screen.findByRole('button', { name: 'Execute selected request' });
    fireEvent.click(execute());
    await screen.findByText(/Simulation completed/);
    expect(executeAllocationJob).toHaveBeenCalledTimes(2);
    expect(vi.mocked(executeAllocationJob).mock.calls[1]).toEqual(
      vi.mocked(executeAllocationJob).mock.calls[0],
    );
    expect(enqueueAllocationJob).not.toHaveBeenCalled();
  });
  it('a committed lost execution is recovered by GET without another execution', async () => {
    vi.mocked(executeAllocationJob).mockRejectedValueOnce(new Error('lost'));
    await showPending();
    fireEvent.click(execute());
    await screen.findByRole('alert');
    vi.mocked(getAllocationJobOutcome).mockResolvedValueOnce(outcome('SUCCEEDED'));
    fireEvent.click(check());
    await screen.findByText(/Simulation completed/);
    expect(executeAllocationJob).toHaveBeenCalledTimes(1);
    expect(enqueueAllocationJob).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Queue another request' })).toBeEnabled();
  });
  it.each(['AUTHOR_UNAVAILABLE', 'PREVIEW_UNAVAILABLE'] as const)(
    'renders only fixed public failure copy for %s',
    async (failureCode) => {
      vi.mocked(getAllocationJobOutcome).mockResolvedValueOnce({
        ...outcome('FAILED'),
        failureCode,
      });
      seed(jobId);
      mount();
      await ready();
      expect(screen.getByRole('status')).toHaveTextContent('No capture was saved');
      expect(screen.getByRole('button', { name: 'Queue another request' })).toBeEnabled();
      expect(
        screen.queryByRole('button', { name: 'Execute selected request' }),
      ).not.toBeInTheDocument();
    },
  );
  it.each(['queue', 'execute'] as const)(
    'prevents rapid duplicate %s writes',
    async (operation) => {
      if (operation === 'queue') {
        const pending = deferred<AllocationJobDTO>();
        vi.mocked(enqueueAllocationJob).mockReturnValueOnce(pending.promise);
        mount();
        await ready();
        const button = queue();
        fireEvent.click(button);
        fireEvent.click(button);
        await waitFor(() => expect(enqueueAllocationJob).toHaveBeenCalledTimes(1));
        expect(button).toBeDisabled();
        await act(async () => pending.resolve(receipt()));
        await ready();
        expect(enqueueAllocationJob).toHaveBeenCalledTimes(1);
      } else {
        const pending = deferred<{ processed: boolean; outcome: AllocationJobOutcomeDTO }>();
        vi.mocked(executeAllocationJob).mockReturnValueOnce(pending.promise);
        await showPending();
        const button = execute();
        fireEvent.click(button);
        fireEvent.click(button);
        await waitFor(() => expect(executeAllocationJob).toHaveBeenCalledTimes(1));
        expect(check()).toBeDisabled();
        await act(async () => pending.resolve({ processed: true, outcome: outcome('SUCCEEDED') }));
        await ready();
        expect(executeAllocationJob).toHaveBeenCalledTimes(1);
      }
    },
  );
});

describe('fresh administrator and generation boundaries', () => {
  it.each(['enqueue', 'outcome', 'execute'] as const)(
    'ignores a stale final-session response after %s without publishing or further reads',
    async (stage) => {
      const final = deferred<AuthUserDTO>();
      let view;
      if (stage === 'execute') {
        seed(jobId);
        view = mount();
        await screen.findByRole('button', { name: 'Execute selected request' });
        vi.mocked(getSession).mockClear();
        vi.mocked(getSession).mockResolvedValueOnce(session()).mockReturnValueOnce(final.promise);
        fireEvent.click(execute());
        await waitFor(() => expect(getSession).toHaveBeenCalledTimes(2));
      } else {
        const beforeFinal = stage === 'enqueue' ? 1 : 3;
        for (let i = 0; i < beforeFinal; i++)
          vi.mocked(getSession).mockResolvedValueOnce(session());
        vi.mocked(getSession).mockReturnValueOnce(final.promise);
        view = mount();
        await ready();
        fireEvent.click(queue());
        await waitFor(() => expect(getSession).toHaveBeenCalledTimes(beforeFinal + 1));
      }
      const before = readJournal();
      const calls = vi.mocked(getSession).mock.calls.length;
      const reads = vi.mocked(getAllocationJobOutcome).mock.calls.length;
      view.rerender(<AllocationJobPanel userId={otherId} scope={allocationScope} />);
      await ready();
      await act(async () => final.resolve(session()));
      expect(readJournal()).toEqual(before);
      expect(getSession).toHaveBeenCalledTimes(calls);
      expect(getAllocationJobOutcome).toHaveBeenCalledTimes(reads);
      expect(screen.queryByText(jobId)).not.toBeInTheDocument();
      expect(screen.queryByText(/Simulation completed/)).not.toBeInTheDocument();
    },
  );
  it.each(['receipt', 'outcome', 'execute'] as const)(
    'ignores stale %s failure after an account changes',
    async (stage) => {
      const receiptRead = deferred<AllocationJobDTO>();
      const outcomeRead = deferred<AllocationJobOutcomeDTO>();
      const execution = deferred<{ processed: boolean; outcome: AllocationJobOutcomeDTO }>();
      seed(jobId);
      if (stage === 'receipt') vi.mocked(getAllocationJob).mockReturnValueOnce(receiptRead.promise);
      if (stage === 'outcome')
        vi.mocked(getAllocationJobOutcome).mockReturnValueOnce(outcomeRead.promise);
      const view = mount();
      if (stage === 'receipt')
        await waitFor(() => expect(getAllocationJob).toHaveBeenCalledTimes(1));
      else if (stage === 'outcome')
        await waitFor(() => expect(getAllocationJobOutcome).toHaveBeenCalledTimes(1));
      else {
        await screen.findByRole('button', { name: 'Execute selected request' });
        vi.mocked(executeAllocationJob).mockReturnValueOnce(execution.promise);
        fireEvent.click(execute());
        await waitFor(() => expect(executeAllocationJob).toHaveBeenCalledTimes(1));
      }
      view.rerender(<AllocationJobPanel userId={otherId} scope={allocationScope} />);
      await ready();
      await act(async () => {
        if (stage === 'receipt') receiptRead.reject(new Error('SECRET'));
        else if (stage === 'outcome') outcomeRead.reject(new Error('SECRET'));
        else execution.reject(new Error('SECRET'));
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(queue()).toBeEnabled();
      expect(enqueueAllocationJob).not.toHaveBeenCalled();
    },
  );
  it.each([null, { ...session(), role: 'STUDENT' as const }, { ...session(), id: otherId }])(
    'rejects changed authorization before enqueue %#',
    async (account) => {
      vi.mocked(getSession).mockResolvedValueOnce(account as unknown as AuthUserDTO);
      mount();
      await ready();
      fireEvent.click(queue());
      await screen.findByRole('alert');
      expect(enqueueAllocationJob).not.toHaveBeenCalled();
      expect(readJournal()).toBeNull();
      expect(screen.getByRole('alert')).toHaveTextContent('admin session changed');
    },
  );
  it.each([2, 3, 4])(
    'does not publish a pending outcome after authorization check %i changes',
    async (at) => {
      for (let i = 1; i < at; i++) vi.mocked(getSession).mockResolvedValueOnce(session());
      vi.mocked(getSession).mockResolvedValueOnce({ ...session(), role: 'STUDENT' });
      mount();
      await ready();
      fireEvent.click(queue());
      await screen.findByRole('alert');
      expect(
        screen.queryByRole('button', { name: 'Execute selected request' }),
      ).not.toBeInTheDocument();
      expect(getAllocationJobOutcome).toHaveBeenCalledTimes(at === 4 ? 1 : 0);
      expect(executeAllocationJob).not.toHaveBeenCalled();
      expect(readJournal()?.jobId).toBe(at === 2 ? undefined : jobId);
    },
  );
  it.each(['before', 'after'] as const)('checks current admin %s execution', async (stage) => {
    await showPending();
    vi.mocked(getSession).mockClear();
    if (stage === 'after') vi.mocked(getSession).mockResolvedValueOnce(session());
    vi.mocked(getSession).mockResolvedValueOnce({ ...session(), id: otherId });
    fireEvent.click(execute());
    await screen.findByRole('alert');
    expect(executeAllocationJob).toHaveBeenCalledTimes(stage === 'before' ? 0 : 1);
    expect(screen.queryByText(/Simulation completed/)).not.toBeInTheDocument();
    expect(readJournal()?.jobId).toBe(jobId);
  });
  it.each(['owner', 'scope'] as const)(
    'ignores a stale pre-enqueue session after %s switches',
    async (change) => {
      const pending = deferred<AuthUserDTO>();
      vi.mocked(getSession).mockReturnValueOnce(pending.promise);
      const view = mount();
      await ready();
      fireEvent.click(queue());
      view.rerender(
        <AllocationJobPanel
          userId={change === 'owner' ? otherId : ownerId}
          scope={change === 'scope' ? { ...allocationScope, year: 2027 } : allocationScope}
        />,
      );
      await ready();
      await act(async () => pending.resolve(session()));
      expect(enqueueAllocationJob).not.toHaveBeenCalled();
      expect(readJournal()).toBeNull();
      expect(queue()).toBeEnabled();
    },
  );
  it.each(['owner', 'scope'] as const)(
    'ignores stale enqueue success after %s switches without receipt persistence or outcome GET',
    async (change) => {
      const pending = deferred<AllocationJobDTO>();
      vi.mocked(enqueueAllocationJob).mockReturnValueOnce(pending.promise);
      const view = mount();
      await ready();
      fireEvent.click(queue());
      await waitFor(() => expect(enqueueAllocationJob).toHaveBeenCalledTimes(1));
      const before = readJournal();
      view.rerender(
        <AllocationJobPanel
          userId={change === 'owner' ? otherId : ownerId}
          scope={change === 'scope' ? { ...allocationScope, year: 2027 } : allocationScope}
        />,
      );
      await ready();
      await act(async () => pending.resolve(receipt()));
      expect(readJournal()).toEqual(before);
      expect(getSession).toHaveBeenCalledTimes(1);
      expect(getAllocationJobOutcome).not.toHaveBeenCalled();
      expect(screen.queryByText(jobId)).not.toBeInTheDocument();
    },
  );
  it.each(['owner', 'scope'] as const)(
    'ignores stale enqueue failures after %s switches',
    async (change) => {
      const pending = deferred<AllocationJobDTO>();
      vi.mocked(enqueueAllocationJob).mockReturnValueOnce(pending.promise);
      const view = mount();
      await ready();
      fireEvent.click(queue());
      await waitFor(() => expect(enqueueAllocationJob).toHaveBeenCalledTimes(1));
      view.rerender(
        <AllocationJobPanel
          userId={change === 'owner' ? otherId : ownerId}
          scope={change === 'scope' ? { ...allocationScope, year: 2027 } : allocationScope}
        />,
      );
      await ready();
      await act(async () => pending.reject(new Error('SECRET OLD ERROR')));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(queue()).toBeEnabled();
    },
  );
  it.each(['receipt', 'outcome', 'execute'] as const)(
    'ignores stale %s success after a scenario changes',
    async (stage) => {
      const receiptRead = deferred<AllocationJobDTO>();
      const outcomeRead = deferred<AllocationJobOutcomeDTO>();
      const execution = deferred<{ processed: boolean; outcome: AllocationJobOutcomeDTO }>();
      seed(jobId);
      if (stage === 'receipt') vi.mocked(getAllocationJob).mockReturnValueOnce(receiptRead.promise);
      if (stage === 'outcome')
        vi.mocked(getAllocationJobOutcome).mockReturnValueOnce(outcomeRead.promise);
      const view = mount();
      if (stage === 'receipt')
        await waitFor(() => expect(getAllocationJob).toHaveBeenCalledTimes(1));
      else if (stage === 'outcome')
        await waitFor(() => expect(getAllocationJobOutcome).toHaveBeenCalledTimes(1));
      else {
        await screen.findByRole('button', { name: 'Execute selected request' });
        vi.mocked(executeAllocationJob).mockReturnValueOnce(execution.promise);
        fireEvent.click(execute());
        await waitFor(() => expect(executeAllocationJob).toHaveBeenCalledTimes(1));
      }
      const calls = vi.mocked(getSession).mock.calls.length;
      view.rerender(
        <AllocationJobPanel userId={ownerId} scope={{ ...allocationScope, year: 2027 }} />,
      );
      await ready();
      await act(async () => {
        if (stage === 'receipt') receiptRead.resolve(receipt());
        else if (stage === 'outcome') outcomeRead.resolve(outcome('SUCCEEDED'));
        else execution.resolve({ processed: true, outcome: outcome('SUCCEEDED') });
      });
      expect(getSession).toHaveBeenCalledTimes(calls);
      expect(screen.queryByText(jobId)).not.toBeInTheDocument();
      expect(screen.queryByText(/Simulation completed/)).not.toBeInTheDocument();
      expect(enqueueAllocationJob).not.toHaveBeenCalled();
    },
  );
});

describe('immutable receipts and strict runtime replies', () => {
  it.each(['id', 'scope', 'extra'] as const)(
    'rejects malformed recovered receipt %s',
    async (field) => {
      seed(jobId);
      const input =
        field === 'id'
          ? { ...receipt(), id: otherId }
          : field === 'scope'
            ? { ...receipt(), scope: { ...allocationScope, year: 2027 } }
            : { ...receipt(), students: ['PRIVATE'] };
      vi.mocked(getAllocationJob).mockResolvedValueOnce(input);
      mount();
      await screen.findByRole('alert');
      expect(getAllocationJobOutcome).not.toHaveBeenCalled();
      expect(readJournal()?.jobId).toBe(jobId);
      expect(screen.queryByText(jobId)).not.toBeInTheDocument();
      expect(recovery()).toBeEnabled();
    },
  );
  it.each(['id', 'scope', 'queuedAt', 'extra', 'contradiction'] as const)(
    'rejects unverified outcome %s',
    async (field) => {
      const input =
        field === 'id'
          ? { ...outcome(), jobId: otherId }
          : field === 'scope'
            ? { ...outcome(), scope: { ...allocationScope, year: 2027 } }
            : field === 'queuedAt'
              ? { ...outcome(), queuedAt: '2026-10-06T01:00:01.000Z' }
              : field === 'extra'
                ? { ...outcome(), privateError: 'SECRET' }
                : { ...outcome(), runId };
      vi.mocked(getAllocationJobOutcome).mockResolvedValueOnce(input);
      seed(jobId);
      mount();
      await screen.findByRole('alert');
      expect(queue()).toBeDisabled();
      expect(
        screen.queryByRole('button', { name: 'Execute selected request' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).not.toHaveTextContent('SECRET');
      expect(readJournal()?.jobId).toBe(jobId);
    },
  );
  it('rejects a malformed enqueue result without losing the pending key', async () => {
    vi.mocked(enqueueAllocationJob).mockResolvedValueOnce({
      ...receipt(),
      scope: { ...allocationScope, year: 2027 },
    });
    mount();
    await ready();
    fireEvent.click(queue());
    await screen.findByRole('alert');
    expect(readJournal()?.jobId).toBeUndefined();
    expect(retry()).toBeEnabled();
    expect(getAllocationJobOutcome).not.toHaveBeenCalled();
  });
  it.each(['scope', 'queuedAt', 'extra', 'pendingProcessed'] as const)(
    'rejects malformed execution %s and requires read recovery',
    async (field) => {
      await showPending();
      const input =
        field === 'scope'
          ? {
              processed: true,
              outcome: { ...outcome('SUCCEEDED'), scope: { ...allocationScope, year: 2027 } },
            }
          : field === 'queuedAt'
            ? {
                processed: true,
                outcome: { ...outcome('SUCCEEDED'), queuedAt: '2026-10-06T01:00:01.000Z' },
              }
            : field === 'extra'
              ? { processed: true, outcome: outcome('SUCCEEDED'), privateError: 'SECRET' }
              : { processed: true, outcome: outcome() };
      vi.mocked(executeAllocationJob).mockResolvedValueOnce(input);
      fireEvent.click(execute());
      await screen.findByRole('alert');
      expect(
        screen.queryByRole('button', { name: 'Execute selected request' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/Simulation completed/)).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).not.toHaveTextContent('SECRET');
      expect(check()).toBeEnabled();
    },
  );
});

describe('durable tab recovery and compare-and-save protection', () => {
  it('rechecks recovery after asynchronous execution authorization before sending a write', async () => {
    await showPending();
    const auth = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockReturnValueOnce(auth.promise);
    fireEvent.click(execute());
    seed();
    await act(async () => auth.resolve(session()));
    await screen.findByRole('alert');
    expect(executeAllocationJob).not.toHaveBeenCalled();
    expect(readJournal()).toEqual(journal());
    expect(recovery()).toBeEnabled();
  });
  it('blocks all writes while storage is denied and retries recovery only after access returns', async () => {
    const denied = vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    mount();
    await ready();
    expect(queue()).toBeDisabled();
    expect(recovery()).toBeEnabled();
    fireEvent.click(recovery());
    await ready();
    expect(enqueueAllocationJob).not.toHaveBeenCalled();
    denied.mockRestore();
    fireEvent.click(recovery());
    await ready();
    expect(queue()).toBeEnabled();
    expect(enqueueAllocationJob).not.toHaveBeenCalled();
  });
  it('never sends POST when the pending key cannot be saved', async () => {
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    mount();
    await ready();
    fireEvent.click(queue());
    await screen.findByRole('alert');
    expect(enqueueAllocationJob).not.toHaveBeenCalled();
    expect(queue()).toBeDisabled();
    expect(recovery()).toBeEnabled();
  });
  it.each([
    '{broken',
    JSON.stringify({ ...journal(), version: 2 }),
    JSON.stringify({ ...journal(), ownerId: otherId }),
    JSON.stringify({ ...journal(), request: { ...request(), expectedActorId: otherId } }),
    JSON.stringify({ ...journal(), request: { ...request(), year: 2027 } }),
    JSON.stringify({ ...journal(), jobId: 'invalid' }),
    JSON.stringify({ ...journal(), private: ['PRIVATE'] }),
  ])('preserves tampered data and never overwrites it %#', async (raw) => {
    sessionStorage.setItem(storageKey(), raw);
    vi.mocked(sessionStorage.setItem).mockClear();
    mount();
    await ready();
    fireEvent.click(recovery());
    await ready();
    expect(sessionStorage.getItem(storageKey())).toBe(raw);
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    expect(enqueueAllocationJob).not.toHaveBeenCalled();
    expect(executeAllocationJob).not.toHaveBeenCalled();
  });
  it('blocks writes when another pending journal changed before the initial session check completes', async () => {
    const pending = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockReturnValueOnce(pending.promise);
    mount();
    await ready();
    fireEvent.click(queue());
    seed();
    await act(async () => pending.resolve(session()));
    await screen.findByRole('alert');
    expect(enqueueAllocationJob).not.toHaveBeenCalled();
    expect(readJournal()).toEqual(journal());
  });
  it('does not overwrite a journal changed while an enqueue reply was pending', async () => {
    const pending = deferred<AllocationJobDTO>();
    vi.mocked(enqueueAllocationJob).mockReturnValueOnce(pending.promise);
    mount();
    await ready();
    fireEvent.click(queue());
    await waitFor(() => expect(enqueueAllocationJob).toHaveBeenCalledTimes(1));
    seed();
    const raw = sessionStorage.getItem(storageKey());
    await act(async () => pending.resolve(receipt()));
    await screen.findByRole('alert');
    expect(sessionStorage.getItem(storageKey())).toBe(raw);
    expect(getAllocationJobOutcome).not.toHaveBeenCalled();
    expect(recovery()).toBeEnabled();
  });
  it('receipt storage failure prevents execution until original-key recovery succeeds', async () => {
    const native = vi.mocked(sessionStorage.setItem).getMockImplementation();
    let writes = 0;
    const broken = vi.spyOn(sessionStorage, 'setItem').mockImplementation((key, value) => {
      if (++writes === 2) throw new Error('receipt denied');
      native?.(key, value);
    });
    mount();
    await ready();
    fireEvent.click(queue());
    await screen.findByRole('alert');
    const original = vi.mocked(enqueueAllocationJob).mock.calls[0][0];
    expect(readJournal()?.jobId).toBeUndefined();
    expect(getAllocationJobOutcome).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Execute selected request' }),
    ).not.toBeInTheDocument();
    broken.mockRestore();
    fireEvent.click(recovery());
    await ready();
    fireEvent.click(retry());
    await screen.findByRole('button', { name: 'Execute selected request' });
    expect(vi.mocked(enqueueAllocationJob).mock.calls[1][0]).toEqual(original);
  });
  it('blocks execution when the selected journal changed after receipt recovery', async () => {
    await showPending();
    seed();
    fireEvent.click(execute());
    await screen.findByRole('alert');
    expect(executeAllocationJob).not.toHaveBeenCalled();
    expect(readJournal()).toEqual(journal());
    expect(recovery()).toBeEnabled();
  });
});
