import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  SemesterAllocationJobDTO,
  SemesterAllocationJobHistoryDTO,
  SemesterAllocationJobOutcomeDTO,
} from '@iu-study-planner/shared';
import {
  SemesterJobSessionChangedError,
  enqueueSemesterAllocationJob,
  executeSemesterAllocationJob,
  getSemesterAllocationJob,
  getSemesterAllocationJobOutcome,
  listSemesterAllocationJobs,
} from '@/lib/semesterAllocationJobsApi';
import { SemesterAllocationJobHistoryPanel } from '../SemesterAllocationJobHistoryPanel';

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
    listSemesterAllocationJobs: vi.fn(),
    getSemesterAllocationJob: vi.fn(),
    getSemesterAllocationJobOutcome: vi.fn(),
    enqueueSemesterAllocationJob: vi.fn(),
    executeSemesterAllocationJob: vi.fn(),
  };
});
const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const scope = {
  curriculumId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  semester: 'FALL' as const,
  year: 2026,
};
const runId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const job = (index = 0): SemesterAllocationJobDTO => ({
  id: `eeeeeeee-eeee-4eee-8eee-${(50 - index).toString(16).padStart(12, '0')}`,
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  model: 'SEMESTER_CREDIT_BUDGET_V1',
  scope: { ...scope },
  status: 'QUEUED',
  queuedAt: new Date(Date.parse('2026-10-08T01:00:00.000Z') - index * 1000).toISOString(),
  inputsCaptured: false,
});
const outcome = (
  receipt = job(),
  status: SemesterAllocationJobOutcomeDTO['status'] = 'PENDING',
): SemesterAllocationJobOutcomeDTO => ({
  jobId: receipt.id,
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  model: receipt.model,
  scope: { ...receipt.scope },
  queuedAt: receipt.queuedAt,
  executionModel: 'ATOMIC_SINGLE_JOB',
  status,
  runId: status === 'SUCCEEDED' ? runId : null,
  completedAt: status === 'PENDING' ? null : '2026-10-08T01:01:00.000Z',
  failureCode: status === 'FAILED' ? 'PREVIEW_UNAVAILABLE' : null,
});
const page = (
  length = 2,
  more = false,
  start = 0,
  after: string | null = null,
): SemesterAllocationJobHistoryDTO => {
  const requests = Array.from({ length }, (_, index) => {
    const receipt = job(index + start);
    return { job: receipt, outcome: outcome(receipt) };
  });
  return {
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    model: 'SEMESTER_CREDIT_BUDGET_V1',
    scope: { ...scope },
    order: 'QUEUED_NEWEST_FIRST',
    pageSize: 5,
    after,
    requests,
    nextAfter: more ? requests.at(-1)!.job.id : null,
  };
};
const mount = () => render(<SemesterAllocationJobHistoryPanel userId={ownerId} scope={scope} />);
const reload = () => screen.getByRole('button', { name: 'Reload semester request history' });
const older = () => screen.getByRole('button', { name: 'Load older semester requests' });
const retryPage = () => screen.getByRole('button', { name: 'Retry semester history page' });
const select = (index = 0) =>
  screen.getByRole('button', { name: `Check semester request outcome ${job(index).id}` });
const retrySelected = () => screen.getByRole('button', { name: 'Retry selected semester outcome' });
const list = () => screen.getByRole('list', { name: 'Semester requests on this page' });
const detail = () => screen.getByRole('region', { name: 'Selected semester request outcome' });
const ready = () =>
  waitFor(() =>
    expect(
      screen.queryByText(/Loading semester request history|Checking selected semester outcome/),
    ).not.toBeInTheDocument(),
  );
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const httpFailure = (status: number) => ({ isAxiosError: true, response: { status } });
beforeEach(() => {
  vi.resetAllMocks();
  buttonHandlers.clear();
  vi.mocked(listSemesterAllocationJobs).mockImplementation(async (_owner, input) =>
    input.after ? page(2, false, 5, input.after) : page(),
  );
  vi.mocked(getSemesterAllocationJob).mockImplementation(async (_owner, expected) => ({
    ...expected,
    scope: { ...expected.scope },
  }));
  vi.mocked(getSemesterAllocationJobOutcome).mockImplementation(
    async (_owner, expected, previous) => previous ?? outcome(expected),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('focus while a read is in flight', () => {
  it('returns focus to the reload control after reading finishes', async () => {
    mount();
    await ready();
    const pendingRead = deferred<Awaited<ReturnType<typeof listSemesterAllocationJobs>>>();
    vi.mocked(listSemesterAllocationJobs).mockReturnValueOnce(pendingRead.promise);
    const target = reload();

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
});

describe('read-only semester request history', () => {
  it('reads one bounded page and never writes, polls, reloads on focus or takes passive focus', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    mount();
    await screen.findByRole('list');
    expect(listSemesterAllocationJobs).toHaveBeenCalledExactlyOnceWith(ownerId, scope, undefined);
    expect(screen.getByRole('region', { name: 'Semester request history' })).toHaveTextContent(
      'up to five requests',
    );
    vi.useFakeTimers();
    fireEvent.focus(window);
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(listSemesterAllocationJobs).toHaveBeenCalledTimes(1);
    expect(enqueueSemesterAllocationJob).not.toHaveBeenCalled();
    expect(executeSemesterAllocationJob).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it.each(['invalid owner', 'owner newline', 'invalid curriculum', 'invalid year'] as const)(
    'rejects %s locally before history transport or evidence publication',
    async (kind) => {
      const requestedOwner =
        kind === 'invalid owner'
          ? 'not-a-uuid'
          : kind === 'owner newline'
            ? `${ownerId}\n`
            : ownerId;
      const requested = { ...scope };
      if (kind === 'invalid curriculum') requested.curriculumId = 'CS';
      if (kind === 'invalid year') requested.year = 1999;
      render(<SemesterAllocationJobHistoryPanel userId={requestedOwner} scope={requested} />);
      await screen.findByRole('alert');
      expect(listSemesterAllocationJobs).not.toHaveBeenCalled();
      expect(getSemesterAllocationJob).not.toHaveBeenCalled();
      expect(getSemesterAllocationJobOutcome).not.toHaveBeenCalled();
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    },
  );

  it('shows an empty latest page distinctly from an empty older page', async () => {
    vi.mocked(listSemesterAllocationJobs).mockResolvedValueOnce(page(0));
    mount();
    await screen.findByText('No semester requests have been queued for this scenario.');
    vi.mocked(listSemesterAllocationJobs).mockResolvedValueOnce(page(5, true));
    fireEvent.click(reload());
    await screen.findByRole('button', { name: 'Load older semester requests' });
    vi.mocked(listSemesterAllocationJobs).mockResolvedValueOnce(page(0, false, 5, job(4).id));
    fireEvent.click(older());
    await screen.findByText('No older semester requests.');
    expect(
      screen.queryByText('No semester requests have been queued for this scenario.'),
    ).not.toBeInTheDocument();
  });

  it('loads an older page using the exact last confirmed queued receipt', async () => {
    vi.mocked(listSemesterAllocationJobs).mockResolvedValueOnce(page(5, true));
    mount();
    await screen.findByRole('list');
    fireEvent.click(older());
    await screen.findByText(job(5).id);
    expect(vi.mocked(listSemesterAllocationJobs).mock.calls[1]).toEqual([
      ownerId,
      { ...scope, after: job(4).id },
      job(4),
    ]);
    expect(screen.queryByText(job(0).id)).not.toBeInTheDocument();
  });

  it('retains the original failed page input and boundary for exact retry', async () => {
    vi.mocked(listSemesterAllocationJobs)
      .mockResolvedValueOnce(page(5, true))
      .mockRejectedValueOnce(new Error('lost'));
    mount();
    await screen.findByRole('list');
    fireEvent.click(older());
    await screen.findByRole('alert');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    fireEvent.click(retryPage());
    await screen.findByText(job(5).id);
    expect(vi.mocked(listSemesterAllocationJobs).mock.calls[2]).toEqual(
      vi.mocked(listSemesterAllocationJobs).mock.calls[1],
    );
    fireEvent.click(reload());
    await screen.findByText(job(0).id);
    expect(vi.mocked(listSemesterAllocationJobs).mock.calls[3]).toEqual([
      ownerId,
      scope,
      undefined,
    ]);
  });

  it('hides all previous page and selection evidence while a page check is pending or failed', async () => {
    mount();
    await screen.findByRole('list');
    fireEvent.click(select());
    await screen.findByRole('region', { name: 'Selected semester request outcome' });
    const pending = deferred<SemesterAllocationJobHistoryDTO>();
    vi.mocked(listSemesterAllocationJobs).mockReturnValueOnce(pending.promise);
    fireEvent.click(reload());
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText(job(0).id)).not.toBeInTheDocument();
    await act(async () => {
      pending.reject(new Error('unverified'));
    });
    await screen.findByRole('alert');
    expect(
      screen.queryByRole('region', { name: 'Selected semester request outcome' }),
    ).not.toBeInTheDocument();
  });

  it('reads the entire selected receipt and then its outcome, preserving immutable receipt metadata', async () => {
    mount();
    await screen.findByRole('list');
    fireEvent.click(select());
    await screen.findByRole('region', { name: 'Selected semester request outcome' });
    expect(getSemesterAllocationJob).toHaveBeenCalledExactlyOnceWith(ownerId, job());
    expect(getSemesterAllocationJobOutcome).toHaveBeenCalledExactlyOnceWith(
      ownerId,
      job(),
      outcome(),
    );
    expect(detail()).toHaveTextContent('Checking this outcome never starts work');
    expect(enqueueSemesterAllocationJob).not.toHaveBeenCalled();
    expect(executeSemesterAllocationJob).not.toHaveBeenCalled();
  });

  it('reflects a freshly confirmed pending-to-terminal outcome in its row and selected detail', async () => {
    vi.mocked(getSemesterAllocationJobOutcome).mockResolvedValueOnce(outcome(job(), 'SUCCEEDED'));
    mount();
    await screen.findByRole('list');
    fireEvent.click(select());
    await screen.findByText(runId);
    expect(detail()).toHaveTextContent('Student results are saved');
    expect(within(list()).getAllByText('Pending · no terminal outcome committed')).toHaveLength(1);
    expect(within(list()).getByText('Completed · student results saved')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Semester request history' })).toHaveTextContent(
      'History reflects its last check',
    );
  });

  it('focuses the confirmed selected outcome heading after an explicit check only', async () => {
    mount();
    await screen.findByRole('list');
    expect(document.activeElement).toBe(document.body);
    select().focus();
    fireEvent.click(select());
    await screen.findByRole('region', { name: 'Selected semester request outcome' });
    expect(
      screen.getByRole('heading', { name: 'Selected semester request outcome' }),
    ).toHaveFocus();
  });

  it('hides page and detail while selected outcome confirmation is still pending', async () => {
    const final = deferred<SemesterAllocationJobOutcomeDTO>();
    vi.mocked(getSemesterAllocationJobOutcome).mockReturnValueOnce(final.promise);
    mount();
    await screen.findByRole('list');
    fireEvent.click(select());
    await waitFor(() => expect(getSemesterAllocationJobOutcome).toHaveBeenCalled());
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText(job(0).id)).not.toBeInTheDocument();
    await act(async () => {
      final.resolve(outcome());
    });
    await screen.findByRole('list');
    expect(detail()).toBeInTheDocument();
  });

  it('retries the exact selected receipt and prior outcome after a failed read', async () => {
    vi.mocked(getSemesterAllocationJobOutcome).mockRejectedValueOnce(new Error('failed'));
    mount();
    await screen.findByRole('list');
    fireEvent.click(select());
    await screen.findByRole('alert');
    expect(screen.queryByText(job(0).id)).not.toBeInTheDocument();
    fireEvent.click(retrySelected());
    await screen.findByRole('list');
    expect(vi.mocked(getSemesterAllocationJob).mock.calls[1]).toEqual(
      vi.mocked(getSemesterAllocationJob).mock.calls[0],
    );
    expect(vi.mocked(getSemesterAllocationJobOutcome).mock.calls[1]).toEqual(
      vi.mocked(getSemesterAllocationJobOutcome).mock.calls[0],
    );
  });

  it.each(['receipt', 'outcome'] as const)(
    'rejects changed %s metadata and reveals no selected evidence',
    async (kind) => {
      if (kind === 'receipt')
        vi.mocked(getSemesterAllocationJob).mockResolvedValueOnce({
          ...job(),
          queuedAt: '2026-10-08T01:00:00.001Z',
        });
      else
        vi.mocked(getSemesterAllocationJobOutcome).mockResolvedValueOnce({
          ...outcome(),
          jobId: otherId,
        });
      mount();
      await screen.findByRole('list');
      fireEvent.click(select());
      await screen.findByRole('alert');
      expect(screen.queryByText(job(0).id)).not.toBeInTheDocument();
      expect(screen.queryByText(otherId)).not.toBeInTheDocument();
    },
  );

  it('never downgrades or changes a terminal outcome supplied by the history page', async () => {
    const terminal = page();
    terminal.requests[0].outcome = outcome(job(), 'SUCCEEDED');
    vi.mocked(listSemesterAllocationJobs).mockResolvedValueOnce(terminal);
    vi.mocked(getSemesterAllocationJobOutcome).mockResolvedValueOnce(outcome());
    mount();
    await screen.findByRole('list');
    fireEvent.click(select());
    await screen.findByRole('alert');
    expect(screen.queryByText(runId)).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(vi.mocked(getSemesterAllocationJobOutcome).mock.calls[0][2]).toEqual(
      terminal.requests[0].outcome,
    );
  });

  it('retains a selected terminal observation when the original page row was pending', async () => {
    vi.mocked(getSemesterAllocationJobOutcome)
      .mockResolvedValueOnce(outcome(job(), 'SUCCEEDED'))
      .mockResolvedValueOnce(outcome());
    mount();
    await screen.findByRole('list');
    fireEvent.click(select());
    await screen.findByText(runId);
    fireEvent.click(select());
    await screen.findByRole('alert');
    expect(vi.mocked(getSemesterAllocationJobOutcome).mock.calls[1][2]).toEqual(
      outcome(job(), 'SUCCEEDED'),
    );
    expect(screen.queryByText(runId)).not.toBeInTheDocument();
  });

  it('rejects a terminal regression when reloading a page containing a known terminal request', async () => {
    const terminal = page();
    terminal.requests[0].outcome = outcome(job(), 'SUCCEEDED');
    vi.mocked(listSemesterAllocationJobs)
      .mockResolvedValueOnce(terminal)
      .mockResolvedValueOnce(page());
    mount();
    await screen.findByRole('list');
    fireEvent.click(reload());
    await screen.findByRole('alert');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it.each(['scope', 'after', 'private'] as const)(
    'rejects unverified history %s replies before displaying them',
    async (change) => {
      const value = page();
      if (change === 'scope') value.scope.curriculumId = otherId;
      if (change === 'after') value.after = otherId;
      if (change === 'private')
        Object.assign(value.requests[0].job, { students: ['private_marker'] });
      vi.mocked(listSemesterAllocationJobs).mockResolvedValueOnce(value);
      mount();
      await screen.findByRole('alert');
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
      expect(screen.queryByText('private_marker')).not.toBeInTheDocument();
    },
  );

  it('checks sub-millisecond continuation ordering independently of a mocked API', async () => {
    const first = page(5, true);
    first.requests.forEach((entry, index) => {
      entry.job.queuedAt = `2026-10-08T01:00:00.00000${9 - index}Z`;
      entry.outcome.queuedAt = entry.job.queuedAt;
    });
    const wrong = page(1, false, 5, first.nextAfter);
    wrong.requests[0].job.queuedAt = '2026-10-08T01:00:00.000006Z';
    wrong.requests[0].outcome.queuedAt = wrong.requests[0].job.queuedAt;
    vi.mocked(listSemesterAllocationJobs).mockResolvedValueOnce(first).mockResolvedValueOnce(wrong);
    mount();
    await screen.findByRole('list');
    fireEvent.click(older());
    await screen.findByRole('alert');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('keeps retry boundaries intact when an API mock mutates its supplied copies', async () => {
    vi.mocked(listSemesterAllocationJobs)
      .mockResolvedValueOnce(page(5, true))
      .mockImplementationOnce(async (_owner, input, boundary) => {
        input.after = otherId;
        if (boundary) boundary.queuedAt = '2026-10-08T02:00:00.000Z';
        throw new Error('lost');
      });
    mount();
    await screen.findByRole('list');
    fireEvent.click(older());
    await screen.findByRole('alert');
    fireEvent.click(retryPage());
    await screen.findByText(job(5).id);
    expect(vi.mocked(listSemesterAllocationJobs).mock.calls[2]).toEqual([
      ownerId,
      { ...scope, after: job(4).id },
      job(4),
    ]);
  });

  it.each(['page', 'detail'] as const)(
    'masks all old evidence after fresh-session failure during %s read',
    async (kind) => {
      mount();
      await screen.findByRole('list');
      if (kind === 'page') {
        vi.mocked(listSemesterAllocationJobs).mockRejectedValueOnce(
          new SemesterJobSessionChangedError(),
        );
        fireEvent.click(reload());
      } else {
        vi.mocked(getSemesterAllocationJobOutcome).mockRejectedValueOnce(
          new SemesterJobSessionChangedError(),
        );
        fireEvent.click(select());
      }
      await screen.findByRole('alert');
      expect(screen.getByRole('alert')).toHaveTextContent('Your admin session changed');
      expect(screen.queryByText(job(0).id)).not.toBeInTheDocument();
    },
  );

  it('offers latest reload after a missing continuation rather than substituting a new cursor', async () => {
    vi.mocked(listSemesterAllocationJobs)
      .mockResolvedValueOnce(page(5, true))
      .mockRejectedValueOnce(httpFailure(409));
    mount();
    await screen.findByRole('list');
    fireEvent.click(older());
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('continuation is unavailable');
    fireEvent.click(reload());
    await screen.findByRole('list');
    expect(vi.mocked(listSemesterAllocationJobs).mock.calls[2]).toEqual([
      ownerId,
      scope,
      undefined,
    ]);
  });

  it('offers reload and exact selected retry after an unavailable request', async () => {
    vi.mocked(getSemesterAllocationJob).mockRejectedValueOnce(httpFailure(404));
    mount();
    await screen.findByRole('list');
    fireEvent.click(select());
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('selected semester request is unavailable');
    expect(reload()).toBeEnabled();
    expect(retrySelected()).toBeEnabled();
  });

  it('ignores an old owner’s late history error while the new owner has its own confirmed page', async () => {
    const old = deferred<SemesterAllocationJobHistoryDTO>();
    vi.mocked(listSemesterAllocationJobs).mockReturnValueOnce(old.promise);
    const view = mount();
    view.rerender(<SemesterAllocationJobHistoryPanel userId={otherId} scope={scope} />);
    await screen.findByRole('list');
    await act(async () => {
      old.reject(new Error('old private error'));
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(list()).toBeInTheDocument();
    expect(vi.mocked(listSemesterAllocationJobs).mock.calls[1][0]).toBe(otherId);
  });

  it('ignores selected success waiting on a final guard after scenario remount', async () => {
    const old = deferred<SemesterAllocationJobOutcomeDTO>();
    vi.mocked(getSemesterAllocationJobOutcome).mockReturnValueOnce(old.promise);
    const view = mount();
    await screen.findByRole('list');
    fireEvent.click(select());
    await waitFor(() => expect(getSemesterAllocationJobOutcome).toHaveBeenCalled());
    vi.mocked(listSemesterAllocationJobs).mockResolvedValueOnce({
      ...page(0),
      scope: { ...scope, year: 2027 },
    });
    view.rerender(
      <SemesterAllocationJobHistoryPanel userId={ownerId} scope={{ ...scope, year: 2027 }} />,
    );
    await ready();
    await act(async () => {
      old.resolve(outcome(job(), 'SUCCEEDED'));
    });
    expect(screen.queryByText(runId)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Selected semester request outcome' }),
    ).not.toBeInTheDocument();
  });

  it('ignores same-mounted stale older-page and selection handlers after a new page read', async () => {
    vi.mocked(listSemesterAllocationJobs).mockResolvedValueOnce(page(5, true));
    mount();
    await screen.findByRole('list');
    const oldOlder = buttonHandlers.get('Load older semester requests')!.at(-1)!;
    const oldSelection = buttonHandlers.get('Check request outcome')![0];
    fireEvent.click(reload());
    await screen.findByRole('list');
    await act(async () => {
      const event = {} as import('react').MouseEvent<HTMLButtonElement>;
      oldOlder(event);
      oldSelection(event);
    });
    expect(listSemesterAllocationJobs).toHaveBeenCalledTimes(2);
    expect(getSemesterAllocationJob).not.toHaveBeenCalled();
  });

  it('blocks overlapping reads and ignores replies after unmount', async () => {
    const pending = deferred<SemesterAllocationJobHistoryDTO>();
    vi.mocked(listSemesterAllocationJobs).mockReturnValueOnce(pending.promise);
    const view = mount();
    fireEvent.click(reload());
    expect(listSemesterAllocationJobs).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => {
      pending.resolve(page());
    });
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it.each(['run', 'completion time', 'failure code'] as const)(
    'rejects changed terminal %s even when the selected request identity stays the same',
    async (field) => {
      const terminal = page();
      const prior = outcome(job(), field === 'failure code' ? 'FAILED' : 'SUCCEEDED');
      terminal.requests[0].outcome = prior;
      const changed = { ...prior };
      if (field === 'run') changed.runId = otherId;
      if (field === 'completion time') changed.completedAt = '2026-10-08T01:02:00.000Z';
      if (field === 'failure code') changed.failureCode = 'AUTHOR_UNAVAILABLE';
      vi.mocked(listSemesterAllocationJobs).mockResolvedValueOnce(terminal);
      vi.mocked(getSemesterAllocationJobOutcome).mockResolvedValueOnce(changed);
      mount();
      await screen.findByRole('list');
      fireEvent.click(select());
      await screen.findByRole('alert');
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('region', { name: 'Selected semester request outcome' }),
      ).not.toBeInTheDocument();
      expect(getSemesterAllocationJobOutcome).toHaveBeenCalledExactlyOnceWith(
        ownerId,
        job(),
        prior,
      );
    },
  );

  it('never starts an outcome read from an old account receipt that resolves after remount', async () => {
    const old = deferred<SemesterAllocationJobDTO>();
    vi.mocked(getSemesterAllocationJob).mockReturnValueOnce(old.promise);
    const view = mount();
    await screen.findByRole('list');
    fireEvent.click(select());
    await waitFor(() => expect(getSemesterAllocationJob).toHaveBeenCalled());
    view.rerender(<SemesterAllocationJobHistoryPanel userId={otherId} scope={scope} />);
    await screen.findByRole('list');
    await act(async () => old.resolve(job()));
    expect(getSemesterAllocationJobOutcome).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('region', { name: 'Selected semester request outcome' }),
    ).not.toBeInTheDocument();
  });

  it('preserves the exact selected recovery intent when a failing transport mutates its copied arguments', async () => {
    vi.mocked(getSemesterAllocationJobOutcome).mockImplementationOnce(
      async (_owner, expected, prior) => {
        expected.id = otherId;
        if (prior) prior.jobId = otherId;
        throw new Error('Response lost');
      },
    );
    mount();
    await screen.findByRole('list');
    fireEvent.click(select());
    await screen.findByRole('alert');
    fireEvent.click(retrySelected());
    await screen.findByRole('region', { name: 'Selected semester request outcome' });
    expect(vi.mocked(getSemesterAllocationJobOutcome).mock.calls[1]).toEqual([
      ownerId,
      job(),
      outcome(),
    ]);
  });

  it('keeps semantic times, wrapping IDs and 44px controls without casing-only rereads', async () => {
    const view = mount();
    await screen.findByRole('list');
    expect(screen.getByText(job().id)).toHaveClass('[overflow-wrap:anywhere]');
    const time = screen.getByText(new Date(job().queuedAt).toLocaleString());
    expect(time.tagName).toBe('TIME');
    for (const button of screen.getAllByRole('button')) expect(button).toHaveClass('min-h-11');
    view.rerender(
      <SemesterAllocationJobHistoryPanel
        userId={ownerId.toUpperCase()}
        scope={{ ...scope, curriculumId: scope.curriculumId.toUpperCase() }}
      />,
    );
    await ready();
    expect(listSemesterAllocationJobs).toHaveBeenCalledTimes(1);
  });
});
