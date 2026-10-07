import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ResourceScopeDTO,
  SemesterAllocationJobDTO,
  SemesterAllocationJobOutcomeDTO,
} from '@iu-study-planner/shared';
import {
  SemesterJobSessionChangedError,
  enqueueSemesterAllocationJob,
  executeSemesterAllocationJob,
  getSemesterAllocationJob,
  getSemesterAllocationJobOutcome,
} from '@/lib/semesterAllocationJobsApi';
import { SemesterAllocationJobPanel } from '../SemesterAllocationJobPanel';
import {
  readSemesterAllocationJobJournal,
  semesterAllocationJobRecoveryKey,
  type SemesterAllocationJobJournal,
} from '../semesterAllocationJobRecovery';

const buttonHandlers = vi.hoisted(
  () => new Map<string, Array<import('react').MouseEventHandler<HTMLButtonElement>>>(),
);
vi.mock('@/components/ui', async (original) => {
  const actual = await original<typeof import('@/components/ui')>();
  const react = await import('react');
  return {
    ...actual,
    Button: (props: import('react').ComponentProps<typeof actual.Button>) => {
      if (typeof props.children === 'string' && props.onClick) {
        const handlers = buttonHandlers.get(props.children) ?? [];
        handlers.push(props.onClick);
        buttonHandlers.set(props.children, handlers);
      }
      return react.createElement(actual.Button, props);
    },
  };
});

vi.mock('@/lib/semesterAllocationJobsApi', async (original) => {
  const actual = await original<typeof import('@/lib/semesterAllocationJobsApi')>();
  return {
    ...actual,
    enqueueSemesterAllocationJob: vi.fn(),
    getSemesterAllocationJob: vi.fn(),
    getSemesterAllocationJobOutcome: vi.fn(),
    executeSemesterAllocationJob: vi.fn(),
  };
});

const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const curriculumId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const jobId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const runId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const scope: ResourceScopeDTO = { curriculumId, semester: 'FALL', year: 2026 };
const receipt = (scenario = scope): SemesterAllocationJobDTO => ({
  id: jobId,
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  model: 'SEMESTER_CREDIT_BUDGET_V1',
  scope: { ...scenario },
  status: 'QUEUED',
  queuedAt: '2026-10-07T14:00:00.000Z',
  inputsCaptured: false,
});
const outcome = (
  status: SemesterAllocationJobOutcomeDTO['status'] = 'PENDING',
): SemesterAllocationJobOutcomeDTO => ({
  jobId,
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  model: 'SEMESTER_CREDIT_BUDGET_V1',
  scope: { ...scope },
  queuedAt: receipt().queuedAt,
  executionModel: 'ATOMIC_SINGLE_JOB',
  status,
  runId: status === 'SUCCEEDED' ? runId : null,
  completedAt: status === 'PENDING' ? null : '2026-10-07T14:01:00.000Z',
  failureCode: status === 'FAILED' ? 'PREVIEW_UNAVAILABLE' : null,
});
const pending = (): SemesterAllocationJobJournal => ({
  version: 1,
  ownerId,
  request: { ...scope, requestId, expectedActorId: ownerId },
  job: null,
});
const journal = (): SemesterAllocationJobJournal => ({ ...pending(), job: receipt() });
const key = semesterAllocationJobRecoveryKey(ownerId, scope);
const saved = new Map<string, string>();
const getItem = vi.fn((key: string): string | null => saved.get(key) ?? null);
const setItem = vi.fn((key: string, value: string) => {
  saved.set(key, value);
});
const removeItem = vi.fn((key: string) => {
  saved.delete(key);
});
const seed = (value: SemesterAllocationJobJournal = journal()) =>
  saved.set(key, JSON.stringify(value));
const mount = () => render(<SemesterAllocationJobPanel userId={ownerId} scope={scope} />);
const queue = () => screen.getByRole('button', { name: 'Queue semester request' });
const retryQueue = () => screen.getByRole('button', { name: 'Retry semester queue' });
const check = () => screen.getByRole('button', { name: 'Check semester request outcome' });
const recovery = () => screen.getByRole('button', { name: 'Retry semester request recovery' });
const execute = () => screen.getByRole('button', { name: 'Execute selected semester request' });
const ready = () =>
  waitFor(() => expect(screen.queryByText('Checking semester request…')).not.toBeInTheDocument());
async function showPending() {
  seed();
  const view = mount();
  await screen.findByRole('button', { name: 'Execute selected semester request' });
  return view;
}
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
  buttonHandlers.clear();
  saved.clear();
  getItem.mockImplementation((key) => saved.get(key) ?? null);
  setItem.mockImplementation((key, value) => {
    saved.set(key, value);
  });
  vi.stubGlobal('sessionStorage', { getItem, setItem, removeItem });
  vi.mocked(enqueueSemesterAllocationJob).mockImplementation(async (_input, beforeSend) => {
    expect(beforeSend?.()).toBeUndefined();
    return receipt();
  });
  vi.mocked(getSemesterAllocationJob).mockResolvedValue(receipt());
  vi.mocked(getSemesterAllocationJobOutcome).mockResolvedValue(outcome());
  vi.mocked(executeSemesterAllocationJob).mockImplementation(
    async (_owner, _receipt, _previous, beforeSend) => {
      expect(beforeSend?.()).toBeUndefined();
      return { processed: true, outcome: outcome('SUCCEEDED') };
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('explicit semester simulation job panel', () => {
  it('starts empty without network calls, journal writes, polling or capture lookup', async () => {
    mount();
    await ready();
    expect(queue()).toBeEnabled();
    expect(enqueueSemesterAllocationJob).not.toHaveBeenCalled();
    expect(getSemesterAllocationJob).not.toHaveBeenCalled();
    expect(getSemesterAllocationJobOutcome).not.toHaveBeenCalled();
    expect(executeSemesterAllocationJob).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    fireEvent.focus(window);
    fireEvent(document, new Event('visibilitychange'));
    expect(getSemesterAllocationJob).not.toHaveBeenCalled();
    const panel = screen.getByRole('region', { name: 'Queued semester simulation request' });
    expect(panel).toHaveTextContent(
      'When you run it, it uses the current cohort and saved resource settings.',
    );
    expect(panel).toHaveTextContent('Unsaved edits are excluded.');
  });

  it('does not auto-enqueue a durable uncertain request and explicitly retries its original key', async () => {
    seed(pending());
    mount();
    await ready();
    expect(enqueueSemesterAllocationJob).not.toHaveBeenCalled();
    fireEvent.click(retryQueue());
    await screen.findByRole('button', { name: 'Execute selected semester request' });
    expect(vi.mocked(enqueueSemesterAllocationJob).mock.calls[0][0]).toEqual(pending().request);
    expect(readSemesterAllocationJobJournal(ownerId, scope)?.job).toEqual(receipt());
  });

  it('writes and confirms a retry key only inside the synchronous pre-send hook', async () => {
    const preflight = deferred<void>();
    let posted = false;
    vi.mocked(enqueueSemesterAllocationJob).mockImplementation(async (input, beforeSend) => {
      expect(setItem).not.toHaveBeenCalled();
      await preflight.promise;
      expect(beforeSend?.()).toBeUndefined();
      expect(readSemesterAllocationJobJournal(ownerId, scope)?.request).toEqual(input);
      posted = true;
      return receipt();
    });
    mount();
    await ready();
    fireEvent.click(queue());
    expect(setItem).not.toHaveBeenCalled();
    expect(queue()).toBeDisabled();
    await act(async () => {
      preflight.resolve();
    });
    await screen.findByRole('button', { name: 'Execute selected semester request' });
    expect(posted).toBe(true);
    expect(saved.get(key)).not.toContain('ATOMIC_SINGLE_JOB');
  });

  it('publishes the receipt and outcome together only after both reads finish', async () => {
    const finalRead = deferred<SemesterAllocationJobOutcomeDTO>();
    vi.mocked(getSemesterAllocationJobOutcome).mockReturnValue(finalRead.promise);
    seed();
    mount();
    await waitFor(() => expect(getSemesterAllocationJobOutcome).toHaveBeenCalled());
    expect(screen.queryByText(jobId)).not.toBeInTheDocument();
    expect(screen.queryByText(/No terminal outcome/)).not.toBeInTheDocument();
    await act(async () => {
      finalRead.resolve(outcome());
    });
    await screen.findByText(jobId);
    expect(execute()).toBeEnabled();
    expect(enqueueSemesterAllocationJob).not.toHaveBeenCalled();
  });

  it('recovers a known receipt through exact immutable GET and outcome reads only', async () => {
    await showPending();
    expect(getSemesterAllocationJob).toHaveBeenCalledExactlyOnceWith(ownerId, receipt());
    expect(getSemesterAllocationJobOutcome).toHaveBeenCalledExactlyOnceWith(
      ownerId,
      receipt(),
      undefined,
    );
    expect(setItem).not.toHaveBeenCalled();
    expect(queue()).toBeDisabled();
    expect(screen.getByText(/Checking the outcome never starts work/)).toBeInTheDocument();
  });

  it('preserves an ambiguous enqueue key across remount and never retries automatically', async () => {
    vi.mocked(enqueueSemesterAllocationJob).mockImplementationOnce(async (_input, hook) => {
      hook?.();
      throw new Error('lost private response');
    });
    const view = mount();
    await ready();
    fireEvent.click(queue());
    await screen.findByRole('alert');
    const original = vi.mocked(enqueueSemesterAllocationJob).mock.calls[0][0];
    expect(readSemesterAllocationJobJournal(ownerId, scope)?.request).toEqual(original);
    expect(screen.queryByText(jobId)).not.toBeInTheDocument();
    view.unmount();
    mount();
    await ready();
    expect(enqueueSemesterAllocationJob).toHaveBeenCalledTimes(1);
    fireEvent.click(retryQueue());
    await screen.findByRole('button', { name: 'Execute selected semester request' });
    expect(vi.mocked(enqueueSemesterAllocationJob).mock.calls[1][0]).toEqual(original);
  });

  it('explains a first-queue failure before the durable hook without inventing an original job', async () => {
    vi.mocked(enqueueSemesterAllocationJob).mockRejectedValueOnce(
      new Error('preflight transport failed'),
    );
    mount();
    await ready();
    fireEvent.click(queue());
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not start the semester request. No enqueue request was sent. Restore your admin session or connection and try again.',
    );
    expect(setItem).not.toHaveBeenCalled();
    expect(saved.has(key)).toBe(false);
    expect(getSemesterAllocationJob).not.toHaveBeenCalled();
    expect(getSemesterAllocationJobOutcome).not.toHaveBeenCalled();
    expect(queue()).toBeEnabled();
    expect(screen.queryByText(/original request key/)).not.toBeInTheDocument();
  });

  it('requires read-only recovery when receipt storage failed, then retries the same pending key', async () => {
    vi.mocked(enqueueSemesterAllocationJob).mockImplementationOnce(async (_input, hook) => {
      hook?.();
      setItem.mockImplementationOnce(() => {
        throw new Error('full');
      });
      return receipt();
    });
    mount();
    await ready();
    fireEvent.click(queue());
    await screen.findByRole('alert');
    const original = vi.mocked(enqueueSemesterAllocationJob).mock.calls[0][0];
    expect(retryQueue()).toBeDisabled();
    expect(screen.queryByText(jobId)).not.toBeInTheDocument();
    fireEvent.click(recovery());
    await ready();
    expect(enqueueSemesterAllocationJob).toHaveBeenCalledTimes(1);
    fireEvent.click(retryQueue());
    await screen.findByRole('button', { name: 'Execute selected semester request' });
    expect(vi.mocked(enqueueSemesterAllocationJob).mock.calls[1][0]).toEqual(original);
  });

  it('recovers a physically saved receipt after its confirming read was denied', async () => {
    vi.mocked(enqueueSemesterAllocationJob).mockImplementationOnce(async (_input, hook) => {
      hook?.();
      const normal = getItem.getMockImplementation()!;
      getItem.mockImplementationOnce(normal).mockImplementationOnce(() => {
        throw new Error('readback denied');
      });
      return receipt();
    });
    mount();
    await ready();
    fireEvent.click(queue());
    await screen.findByRole('alert');
    expect(readSemesterAllocationJobJournal(ownerId, scope)?.job).toEqual(receipt());
    fireEvent.click(recovery());
    await screen.findByRole('button', { name: 'Execute selected semester request' });
    expect(enqueueSemesterAllocationJob).toHaveBeenCalledTimes(1);
  });

  it('executes only a confirmed pending job and retains the journal unchanged', async () => {
    await showPending();
    const before = saved.get(key);
    fireEvent.click(execute());
    await screen.findByText(/Semester simulation completed/);
    expect(vi.mocked(executeSemesterAllocationJob).mock.calls[0].slice(0, 3)).toEqual([
      ownerId,
      receipt(),
      outcome(),
    ]);
    expect(saved.get(key)).toBe(before);
    expect(screen.getByText(runId)).toBeInTheDocument();
    expect(
      screen.getByText(/Participating students can review their own result in Planner/),
    ).toBeInTheDocument();
    expect(enqueueSemesterAllocationJob).not.toHaveBeenCalled();
  });

  it('hides all evidence on lost execution reply and requires read-only outcome recovery before retry', async () => {
    vi.mocked(executeSemesterAllocationJob).mockImplementationOnce(
      async (_owner, _job, _prior, hook) => {
        hook?.();
        throw new Error('lost');
      },
    );
    await showPending();
    fireEvent.click(execute());
    await screen.findByRole('alert');
    expect(screen.queryByText(jobId)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Execute selected semester request' }),
    ).not.toBeInTheDocument();
    fireEvent.click(recovery());
    await screen.findByRole('button', { name: 'Execute selected semester request' });
    expect(executeSemesterAllocationJob).toHaveBeenCalledTimes(1);
    fireEvent.click(execute());
    await screen.findByText(/Semester simulation completed/);
    expect(vi.mocked(executeSemesterAllocationJob).mock.calls[1][1]).toEqual(receipt());
  });

  it('recovers a committed execution after a lost reply without submitting execution again', async () => {
    vi.mocked(executeSemesterAllocationJob).mockImplementationOnce(
      async (_owner, _job, _prior, hook) => {
        hook?.();
        throw new Error('lost');
      },
    );
    await showPending();
    fireEvent.click(execute());
    await screen.findByRole('alert');
    vi.mocked(getSemesterAllocationJobOutcome).mockResolvedValue(outcome('SUCCEEDED'));
    fireEvent.click(recovery());
    await screen.findByText(/Semester simulation completed/);
    expect(executeSemesterAllocationJob).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: 'Execute selected semester request' }),
    ).not.toBeInTheDocument();
  });

  it('reports processed:false pending without claiming execution completed', async () => {
    vi.mocked(executeSemesterAllocationJob).mockImplementation(
      async (_owner, _job, _prior, hook) => {
        hook?.();
        return { processed: false, outcome: outcome() };
      },
    );
    await showPending();
    fireEvent.click(execute());
    await ready();
    expect(screen.getByText(/No terminal outcome is committed/)).toBeInTheDocument();
    expect(screen.queryByText(/Semester simulation completed/)).not.toBeInTheDocument();
    expect(execute()).toBeEnabled();
  });

  it('reports an already completed result when execution merely returns a terminal replay', async () => {
    vi.mocked(executeSemesterAllocationJob).mockImplementation(
      async (_owner, _job, _prior, hook) => {
        hook?.();
        return { processed: false, outcome: outcome('SUCCEEDED') };
      },
    );
    await showPending();
    fireEvent.click(execute());
    await screen.findByText(/was already completed/);
  });

  it.each(['AUTHOR_UNAVAILABLE', 'PREVIEW_UNAVAILABLE'] as const)(
    'shows terminal failure %s without a capture or execution action',
    async (failureCode) => {
      vi.mocked(getSemesterAllocationJobOutcome).mockResolvedValue({
        ...outcome('FAILED'),
        failureCode,
      });
      seed();
      mount();
      await screen.findByText(
        failureCode === 'AUTHOR_UNAVAILABLE'
          ? /original administrator is no longer available/
          : /current scenario is unsupported/,
      );
      expect(screen.queryByText(runId)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Queue another semester request' })).toBeEnabled();
    },
  );

  it('freshly verifies receipt and terminal outcome before replacing a request key', async () => {
    vi.mocked(getSemesterAllocationJobOutcome).mockResolvedValue(outcome('SUCCEEDED'));
    seed();
    mount();
    await screen.findByText(/Semester simulation completed/);
    const old = saved.get(key);
    const recheck = deferred<SemesterAllocationJobOutcomeDTO>();
    vi.mocked(getSemesterAllocationJobOutcome).mockReturnValueOnce(recheck.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Queue another semester request' }));
    await waitFor(() => expect(getSemesterAllocationJobOutcome).toHaveBeenCalledTimes(2));
    expect(saved.get(key)).toBe(old);
    expect(enqueueSemesterAllocationJob).not.toHaveBeenCalled();
    expect(screen.queryByText(jobId)).not.toBeInTheDocument();
    await act(async () => {
      recheck.resolve(outcome('SUCCEEDED'));
    });
    await ready();
    expect(getSemesterAllocationJob).toHaveBeenCalledTimes(3);
    expect(vi.mocked(enqueueSemesterAllocationJob).mock.calls[0][0].requestId).not.toBe(requestId);
  });

  it('never replaces a terminal receipt after an unverified or regressed fresh outcome', async () => {
    vi.mocked(getSemesterAllocationJobOutcome)
      .mockResolvedValueOnce(outcome('SUCCEEDED'))
      .mockResolvedValueOnce(outcome());
    seed();
    mount();
    await screen.findByText(/Semester simulation completed/);
    const old = saved.get(key);
    fireEvent.click(screen.getByRole('button', { name: 'Queue another semester request' }));
    await screen.findByRole('alert');
    expect(saved.get(key)).toBe(old);
    expect(enqueueSemesterAllocationJob).not.toHaveBeenCalled();
    expect(screen.queryByText(runId)).not.toBeInTheDocument();
  });

  it('keeps a terminal result immutable across explicit subsequent reads', async () => {
    vi.mocked(getSemesterAllocationJobOutcome)
      .mockResolvedValueOnce(outcome('SUCCEEDED'))
      .mockResolvedValueOnce({ ...outcome('SUCCEEDED'), runId: otherId });
    seed();
    mount();
    await screen.findByText(/Semester simulation completed/);
    fireEvent.click(check());
    await screen.findByRole('alert');
    expect(screen.queryByText(runId)).not.toBeInTheDocument();
    expect(screen.queryByText(otherId)).not.toBeInTheDocument();
    expect(vi.mocked(getSemesterAllocationJobOutcome).mock.calls[1][2]).toEqual(
      outcome('SUCCEEDED'),
    );
  });

  it('reconfirms unchanged journal bytes after asynchronous read checks before displaying evidence', async () => {
    const finalRead = deferred<SemesterAllocationJobOutcomeDTO>();
    vi.mocked(getSemesterAllocationJobOutcome).mockReturnValue(finalRead.promise);
    seed();
    mount();
    await waitFor(() => expect(getSemesterAllocationJobOutcome).toHaveBeenCalled());
    const changed = JSON.stringify(journal(), null, 2);
    saved.set(key, changed);
    await act(async () => {
      finalRead.resolve(outcome());
    });
    await screen.findByRole('alert');
    expect(screen.queryByText(jobId)).not.toBeInTheDocument();
    expect(saved.get(key)).toBe(changed);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('blocks a journal changed during execution authorization before the POST hook', async () => {
    const preflight = deferred<void>();
    let posted = false;
    vi.mocked(executeSemesterAllocationJob).mockImplementation(
      async (_owner, _job, _prior, hook) => {
        await preflight.promise;
        hook?.();
        posted = true;
        return { processed: true, outcome: outcome('SUCCEEDED') };
      },
    );
    await showPending();
    fireEvent.click(execute());
    const changed = JSON.stringify(journal(), null, 2);
    saved.set(key, changed);
    await act(async () => {
      preflight.resolve();
    });
    await screen.findByRole('alert');
    expect(posted).toBe(false);
    expect(saved.get(key)).toBe(changed);
    expect(screen.queryByText(jobId)).not.toBeInTheDocument();
  });

  it('blocks another view’s key during enqueue preflight without overwriting its evidence', async () => {
    const preflight = deferred<void>();
    let posted = false;
    vi.mocked(enqueueSemesterAllocationJob).mockImplementation(async (_input, hook) => {
      await preflight.promise;
      hook?.();
      posted = true;
      return receipt();
    });
    mount();
    await ready();
    fireEvent.click(queue());
    seed(pending());
    const raw = saved.get(key);
    await act(async () => {
      preflight.resolve();
    });
    await screen.findByRole('alert');
    expect(posted).toBe(false);
    expect(saved.get(key)).toBe(raw);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('blocks invalid or denied recovery without deleting existing evidence', async () => {
    saved.set(key, '{corrupt');
    mount();
    await screen.findByRole('alert');
    expect(queue()).toBeDisabled();
    expect(getSemesterAllocationJob).not.toHaveBeenCalled();
    expect(saved.get(key)).toBe('{corrupt');
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('does not submit queue when storage writes are denied', async () => {
    let posted = false;
    vi.mocked(enqueueSemesterAllocationJob).mockImplementation(async (_input, hook) => {
      hook?.();
      posted = true;
      return receipt();
    });
    setItem.mockImplementation(() => {
      throw new Error('denied');
    });
    mount();
    await ready();
    fireEvent.click(queue());
    await screen.findByRole('alert');
    expect(posted).toBe(false);
    expect(saved.has(key)).toBe(false);
  });

  it('blocks denied journal reads without erasing or publishing known request bytes', async () => {
    seed();
    getItem.mockImplementation(() => {
      throw new Error('denied');
    });
    mount();
    await screen.findByRole('alert');
    expect(queue()).toBeDisabled();
    expect(saved.get(key)).toBe(JSON.stringify(journal()));
    expect(getSemesterAllocationJob).not.toHaveBeenCalled();
    expect(screen.queryByText(jobId)).not.toBeInTheDocument();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it.each(['receipt', 'outcome'] as const)(
    'rejects unexpected private %s fields at the component boundary',
    async (kind) => {
      const privateMarker = 'PRIVATE_STUDENT_EVIDENCE';
      if (kind === 'receipt')
        vi.mocked(getSemesterAllocationJob).mockResolvedValue({
          ...receipt(),
          students: [privateMarker],
        } as unknown as SemesterAllocationJobDTO);
      else
        vi.mocked(getSemesterAllocationJobOutcome).mockResolvedValue({
          ...outcome(),
          students: [privateMarker],
        } as unknown as SemesterAllocationJobOutcomeDTO);
      seed();
      mount();
      await screen.findByRole('alert');
      expect(screen.queryByText(jobId)).not.toBeInTheDocument();
      expect(screen.queryByText(privateMarker)).not.toBeInTheDocument();
      expect(saved.get(key)).toBe(JSON.stringify(journal()));
    },
  );

  it('refuses deleted or replaced known journals on recovery instead of authorizing a new key', async () => {
    await showPending();
    saved.delete(key);
    fireEvent.click(check());
    await screen.findByRole('alert');
    expect(queue()).toBeDisabled();
    expect(screen.queryByText(jobId)).not.toBeInTheDocument();
    expect(enqueueSemesterAllocationJob).not.toHaveBeenCalled();
  });

  it.each(['receipt', 'outcome', 'execution'] as const)(
    'rejects wrong or private %s replies without displaying details',
    async (kind) => {
      if (kind === 'receipt')
        vi.mocked(getSemesterAllocationJob).mockResolvedValue({
          ...receipt(),
          queuedAt: '2026-10-07T14:00:00.001Z',
        });
      if (kind === 'outcome')
        vi.mocked(getSemesterAllocationJobOutcome).mockResolvedValue({
          ...outcome(),
          jobId: otherId,
        });
      seed();
      mount();
      if (kind === 'execution') {
        await screen.findByRole('button', { name: 'Execute selected semester request' });
        vi.mocked(executeSemesterAllocationJob).mockImplementation(
          async (_owner, _job, _prior, hook) => {
            hook?.();
            return { processed: true, outcome: { ...outcome('SUCCEEDED'), jobId: otherId } };
          },
        );
        fireEvent.click(execute());
      }
      await screen.findByRole('alert');
      expect(screen.queryByText(jobId)).not.toBeInTheDocument();
      expect(screen.queryByText(otherId)).not.toBeInTheDocument();
    },
  );

  it('hides previously confirmed evidence after a fresh-session failure', async () => {
    await showPending();
    vi.mocked(getSemesterAllocationJobOutcome).mockRejectedValueOnce(
      new SemesterJobSessionChangedError(),
    );
    fireEvent.click(check());
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Your admin session changed');
    expect(screen.queryByText(jobId)).not.toBeInTheDocument();
    expect(screen.queryByText(/No terminal outcome/)).not.toBeInTheDocument();
  });

  it('ignores late receipt/outcome successes and failures from the previous owner', async () => {
    const old = deferred<SemesterAllocationJobOutcomeDTO>();
    vi.mocked(getSemesterAllocationJobOutcome).mockReturnValueOnce(old.promise);
    seed();
    const view = mount();
    await waitFor(() => expect(getSemesterAllocationJobOutcome).toHaveBeenCalled());
    view.rerender(<SemesterAllocationJobPanel userId={otherId} scope={scope} />);
    await ready();
    await act(async () => {
      old.reject(new Error('old owner private failure'));
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(jobId)).not.toBeInTheDocument();
    expect(queue()).toBeEnabled();
  });

  it('isolates a new scenario while an old success is waiting for its final guard', async () => {
    const old = deferred<SemesterAllocationJobOutcomeDTO>();
    vi.mocked(getSemesterAllocationJobOutcome).mockReturnValueOnce(old.promise);
    seed();
    const view = mount();
    await waitFor(() => expect(getSemesterAllocationJobOutcome).toHaveBeenCalled());
    view.rerender(<SemesterAllocationJobPanel userId={ownerId} scope={{ ...scope, year: 2027 }} />);
    await ready();
    await act(async () => {
      old.resolve(outcome());
    });
    expect(screen.queryByText(jobId)).not.toBeInTheDocument();
    expect(queue()).toBeEnabled();
    expect(saved.get(key)).toBe(JSON.stringify(journal()));
  });

  it('prevents a stale enqueue hook from writing or submitting after unmount', async () => {
    const preflight = deferred<void>();
    let posted = false;
    vi.mocked(enqueueSemesterAllocationJob).mockImplementation(async (_input, hook) => {
      await preflight.promise;
      hook?.();
      posted = true;
      return receipt();
    });
    const view = mount();
    await ready();
    fireEvent.click(queue());
    view.unmount();
    await act(async () => {
      preflight.resolve();
    });
    expect(posted).toBe(false);
    expect(saved.has(key)).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('prevents a stale execution hook from submitting after account remount', async () => {
    const preflight = deferred<void>();
    let posted = false;
    vi.mocked(executeSemesterAllocationJob).mockImplementation(
      async (_owner, _job, _prior, hook) => {
        await preflight.promise;
        hook?.();
        posted = true;
        return { processed: true, outcome: outcome('SUCCEEDED') };
      },
    );
    const view = await showPending();
    fireEvent.click(execute());
    view.rerender(<SemesterAllocationJobPanel userId={otherId} scope={scope} />);
    await ready();
    await act(async () => {
      preflight.resolve();
    });
    expect(posted).toBe(false);
    expect(saved.get(key)).toBe(JSON.stringify(journal()));
  });

  it('blocks overlapping actions and hides old evidence during a read', async () => {
    await showPending();
    const read = deferred<SemesterAllocationJobDTO>();
    vi.mocked(getSemesterAllocationJob).mockReturnValueOnce(read.promise);
    const oldExecute = execute();
    fireEvent.click(check());
    fireEvent.click(oldExecute);
    expect(screen.queryByText(jobId)).not.toBeInTheDocument();
    expect(executeSemesterAllocationJob).not.toHaveBeenCalled();
    await act(async () => {
      read.resolve(receipt());
    });
    await ready();
  });

  it('ignores an old same-mounted pending execute handler after the result became terminal', async () => {
    await showPending();
    const previousHandler = buttonHandlers.get('Execute selected semester request')!.at(-1)!;
    fireEvent.click(execute());
    await screen.findByText(/Semester simulation completed/);
    await act(async () => {
      previousHandler({} as import('react').MouseEvent<HTMLButtonElement>);
    });
    expect(executeSemesterAllocationJob).toHaveBeenCalledTimes(1);
    expect(screen.getByText(runId)).toBeInTheDocument();
  });

  it('ignores an old same-mounted terminal queue handler after a read failed', async () => {
    vi.mocked(getSemesterAllocationJobOutcome).mockResolvedValueOnce(outcome('SUCCEEDED'));
    seed();
    mount();
    await screen.findByText(/Semester simulation completed/);
    const previousHandler = buttonHandlers.get('Queue another semester request')!.at(-1)!;
    vi.mocked(getSemesterAllocationJob).mockRejectedValueOnce(new Error('read failed'));
    fireEvent.click(check());
    await screen.findByRole('alert');
    await act(async () => {
      previousHandler({} as import('react').MouseEvent<HTMLButtonElement>);
    });
    expect(enqueueSemesterAllocationJob).not.toHaveBeenCalled();
    expect(getSemesterAllocationJob).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(jobId)).not.toBeInTheDocument();
  });

  it('provides semantic timestamps, wrapping identifiers and large action controls', async () => {
    await showPending();
    const id = screen.getByText(jobId);
    expect(id).toHaveClass('[overflow-wrap:anywhere]');
    expect(id.closest('dl')).not.toBeNull();
    expect(screen.getByText(new Date(receipt().queuedAt).toLocaleString()).tagName).toBe('TIME');
    for (const button of screen.getAllByRole('button')) expect(button).toHaveClass('min-h-11');
    expect(screen.getByRole('region', { name: 'Queued semester simulation request' })).toHaveClass(
      'min-w-0',
    );
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('normalizes owner/scope casing without restarting a confirmed same-scenario read', async () => {
    const view = await showPending();
    view.rerender(
      <SemesterAllocationJobPanel
        userId={ownerId.toUpperCase()}
        scope={{ ...scope, curriculumId: curriculumId.toUpperCase() }}
      />,
    );
    await ready();
    expect(getSemesterAllocationJob).toHaveBeenCalledTimes(1);
    expect(screen.getByText(jobId)).toBeInTheDocument();
  });
});
