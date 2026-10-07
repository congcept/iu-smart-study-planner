import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateSemesterAllocationJobDTO,
  SemesterAllocationJobDTO,
  SemesterAllocationJobOutcomeDTO,
} from '@iu-study-planner/shared';
import { referenceSession } from '@/test/fixtures/curriculumReference';
import apiClient, { getSession } from '../api';
import {
  enqueueSemesterAllocationJob,
  executeSemesterAllocationJob,
  getSemesterAllocationJob,
  getSemesterAllocationJobOutcome,
  SemesterJobSessionChangedError,
} from '../semesterAllocationJobsApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() }, getSession: vi.fn() }));
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const session = vi.mocked(getSession);
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const curriculumId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const requestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const jobId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const scope = { curriculumId, semester: 'FALL' as const, year: 2026 };
const admin = (id = actorId) => ({ ...referenceSession(null, id), role: 'ADMIN' as const });
const input = (): CreateSemesterAllocationJobDTO => ({
  ...scope,
  requestId,
  expectedActorId: actorId,
});
const queued = (): SemesterAllocationJobDTO => ({
  id: jobId,
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  model: 'SEMESTER_CREDIT_BUDGET_V1',
  scope: { ...scope },
  status: 'QUEUED',
  queuedAt: '2026-10-07T02:00:00.000Z',
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
  queuedAt: queued().queuedAt,
  executionModel: 'ATOMIC_SINGLE_JOB',
  status,
  runId: status === 'SUCCEEDED' ? otherId : null,
  completedAt: status === 'PENDING' ? null : '2026-10-07T02:00:01.000Z',
  failureCode: status === 'FAILED' ? 'AUTHOR_UNAVAILABLE' : null,
});
const respond = (data: unknown, write = false) =>
  (write ? post : get).mockResolvedValue({ data: { success: true, data } });
const boundaries = [
  {
    name: 'enqueue',
    write: true,
    call: () => enqueueSemesterAllocationJob(input()),
    reply: () => queued(),
  },
  {
    name: 'receipt',
    write: false,
    call: () => getSemesterAllocationJob(actorId, queued()),
    reply: () => queued(),
  },
  {
    name: 'outcome',
    write: false,
    call: () => getSemesterAllocationJobOutcome(actorId, queued()),
    reply: () => outcome(),
  },
  {
    name: 'execution',
    write: true,
    call: () => executeSemesterAllocationJob(actorId, queued()),
    reply: () => ({ processed: false, outcome: outcome() }),
  },
] as const;
const guardedWrites = [
  {
    name: 'enqueue',
    call: (beforeSend: () => undefined) => enqueueSemesterAllocationJob(input(), beforeSend),
    reply: () => queued(),
  },
  {
    name: 'execute',
    call: (beforeSend: () => undefined) =>
      executeSemesterAllocationJob(actorId, queued(), undefined, beforeSend),
    reply: () => ({ processed: false, outcome: outcome() }),
  },
] as const;
const reset = () => {
  vi.resetAllMocks();
  session.mockResolvedValue(admin());
  respond(queued());
  respond(queued(), true);
};
const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
};

beforeEach(reset);
afterEach(() => vi.restoreAllMocks());

describe('strict semester simulation job browser adapters', () => {
  it('enqueues the normalized stable key once with both fresh administrator barriers', async () => {
    expect(await enqueueSemesterAllocationJob(input())).toEqual(queued());
    expect(post).toHaveBeenCalledExactlyOnceWith('/admin/semester-allocation-jobs', input(), {
      timeout: 40000,
    });
    expect(get).not.toHaveBeenCalled();
    expect(session).toHaveBeenCalledTimes(2);
    expect(session.mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[0]);
    expect(post.mock.invocationCallOrder[0]).toBeLessThan(session.mock.invocationCallOrder[1]);
  });

  it('reads an exact immutable receipt with no owner or scenario query overrides', async () => {
    expect(await getSemesterAllocationJob(actorId, queued())).toEqual(queued());
    expect(get).toHaveBeenCalledExactlyOnceWith(`/admin/semester-allocation-jobs/${jobId}`, {
      timeout: 40000,
    });
    expect(post).not.toHaveBeenCalled();
    expect(session).toHaveBeenCalledTimes(2);
  });

  it('permits a previous pending outcome to advance to a verified terminal result', async () => {
    respond(outcome('SUCCEEDED'));
    expect(await getSemesterAllocationJobOutcome(actorId, queued(), outcome())).toEqual(
      outcome('SUCCEEDED'),
    );
    expect(get).toHaveBeenCalledExactlyOnceWith(
      `/admin/semester-allocation-jobs/${jobId}/outcome`,
      { timeout: 40000 },
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('executes only the receipt path ID with scope and expected actor, without a replacement retry key', async () => {
    const result = { processed: true, outcome: outcome('SUCCEEDED') };
    respond(result, true);
    expect(await executeSemesterAllocationJob(actorId, queued())).toEqual(result);
    expect(post).toHaveBeenCalledExactlyOnceWith(
      `/admin/semester-allocation-jobs/${jobId}/execute`,
      { ...scope, expectedActorId: actorId },
      { timeout: 40000 },
    );
    expect(get).not.toHaveBeenCalled();
    expect(session).toHaveBeenCalledTimes(2);
  });

  it('normalizes UUIDs across sessions, requests, receipt identity and returned terminal outcomes', async () => {
    session.mockResolvedValue(admin(actorId.toUpperCase()));
    const upper = {
      ...queued(),
      id: jobId.toUpperCase(),
      scope: { ...scope, curriculumId: curriculumId.toUpperCase() },
    };
    respond(upper, true);
    expect(
      await enqueueSemesterAllocationJob({
        ...input(),
        curriculumId: curriculumId.toUpperCase(),
        requestId: requestId.toUpperCase(),
        expectedActorId: actorId.toUpperCase(),
      }),
    ).toEqual(queued());
    respond(upper);
    expect(await getSemesterAllocationJob(actorId.toUpperCase(), upper)).toEqual(queued());
    const terminal = {
      ...outcome('SUCCEEDED'),
      jobId: jobId.toUpperCase(),
      runId: otherId.toUpperCase(),
      scope: upper.scope,
    };
    respond(terminal);
    expect(await getSemesterAllocationJobOutcome(actorId.toUpperCase(), upper)).toEqual(
      outcome('SUCCEEDED'),
    );
    respond({ processed: false, outcome: terminal }, true);
    expect(await executeSemesterAllocationJob(actorId.toUpperCase(), upper)).toEqual({
      processed: false,
      outcome: outcome('SUCCEEDED'),
    });
    expect(post).toHaveBeenNthCalledWith(1, '/admin/semester-allocation-jobs', input(), {
      timeout: 40000,
    });
    expect(post).toHaveBeenNthCalledWith(
      2,
      `/admin/semester-allocation-jobs/${jobId}/execute`,
      { ...scope, expectedActorId: actorId },
      { timeout: 40000 },
    );
  });

  it('rejects malformed or expanded enqueue input before any session or data request', async () => {
    for (const fields of [
      { expectedActorId: undefined },
      { expectedActorId: `${actorId}\n` },
      { requestId: `${requestId}\n` },
      { model: 'SEMESTER_CREDIT_BUDGET_V1' },
      { students: [] },
      { year: 1999 },
    ])
      await expect(
        enqueueSemesterAllocationJob({ ...input(), ...fields } as CreateSemesterAllocationJobDTO),
      ).rejects.toThrow();
    expect(session).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects malformed owners or expanded expected receipts before all selected-job I/O', async () => {
    const readers = [
      getSemesterAllocationJob,
      getSemesterAllocationJobOutcome,
      executeSemesterAllocationJob,
    ];
    for (const read of readers) {
      await expect(read(`${actorId}\n`, queued())).rejects.toThrow();
      await expect(
        read(actorId, { ...queued(), createdById: otherId } as SemesterAllocationJobDTO),
      ).rejects.toThrow();
      await expect(read(actorId, { ...queued(), id: `${jobId}\n` })).rejects.toThrow();
    }
    expect(session).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('validates and binds previous outcomes to the exact receipt before either read or execution', async () => {
    for (const previous of [
      { ...outcome(), jobId: otherId },
      { ...outcome(), scope: { ...scope, year: 2027 } },
      { ...outcome(), queuedAt: '2026-10-07T02:00:00.001Z' },
      { ...outcome(), students: [] },
    ]) {
      await expect(
        getSemesterAllocationJobOutcome(
          actorId,
          queued(),
          previous as SemesterAllocationJobOutcomeDTO,
        ),
      ).rejects.toThrow();
      await expect(
        executeSemesterAllocationJob(
          actorId,
          queued(),
          previous as SemesterAllocationJobOutcomeDTO,
        ),
      ).rejects.toThrow();
    }
    expect(session).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it.each(boundaries)(
    'blocks invalid, changed or non-admin preflight sessions before $name',
    async (boundary) => {
      for (const blocked of [admin(otherId), admin(''), { ...admin(), role: 'STUDENT' as const }]) {
        reset();
        session.mockResolvedValueOnce(blocked);
        await expect(boundary.call()).rejects.toBeInstanceOf(SemesterJobSessionChangedError);
        expect(get).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
      }
    },
  );

  it('does not send data requests when fresh session preflight itself fails', async () => {
    for (const boundary of boundaries) {
      reset();
      const failure = new Error('Session unavailable');
      session.mockRejectedValueOnce(failure);
      await expect(boundary.call()).rejects.toBe(failure);
      expect(get).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    }
  });

  it.each(boundaries)(
    'discards a successful $name result after final session changes',
    async (boundary) => {
      respond(boundary.reply(), boundary.write);
      session.mockResolvedValueOnce(admin()).mockResolvedValueOnce(admin(otherId));
      await expect(boundary.call()).rejects.toBeInstanceOf(SemesterJobSessionChangedError);
      expect(session).toHaveBeenCalledTimes(2);
      expect(boundary.write ? post : get).toHaveBeenCalledTimes(1);
    },
  );

  it('checks final account and role even after failed data requests, suppressing another account error', async () => {
    for (const boundary of boundaries) {
      reset();
      const failure = new Error('Private other-account error');
      (boundary.write ? post : get).mockRejectedValueOnce(failure);
      session.mockResolvedValueOnce(admin()).mockResolvedValueOnce({ ...admin(), role: 'STUDENT' });
      await expect(boundary.call()).rejects.toBeInstanceOf(SemesterJobSessionChangedError);
      expect(session).toHaveBeenCalledTimes(2);
      expect(boundary.write ? post : get).toHaveBeenCalledTimes(1);
    }
  });

  it('publishes neither success nor data failure when the final fresh session read is unavailable', async () => {
    for (const failedData of [false, true]) {
      for (const boundary of boundaries) {
        reset();
        respond(boundary.reply(), boundary.write);
        if (failedData)
          (boundary.write ? post : get).mockRejectedValueOnce(new Error('Data unavailable'));
        const sessionFailure = new Error('Final session unavailable');
        session.mockResolvedValueOnce(admin()).mockRejectedValueOnce(sessionFailure);
        await expect(boundary.call()).rejects.toBe(sessionFailure);
        expect(session).toHaveBeenCalledTimes(2);
      }
    }
  });

  it.each(boundaries)(
    'preserves same-admin HTTP failures after checking the final session for $name',
    async (boundary) => {
      const failure = Object.assign(new Error('Request conflict'), { response: { status: 409 } });
      (boundary.write ? post : get).mockRejectedValueOnce(failure);
      await expect(boundary.call()).rejects.toBe(failure);
      expect(session).toHaveBeenCalledTimes(2);
      expect(boundary.write ? post : get).toHaveBeenCalledTimes(1);
      expect(boundary.write ? get : post).not.toHaveBeenCalled();
    },
  );

  it('rejects unsuccessful and private-field response envelopes after a final session confirmation', async () => {
    for (const boundary of boundaries) {
      for (const envelope of [
        { success: false, data: boundary.reply() },
        { success: true },
        { success: true, data: { ...boundary.reply(), students: [otherId] } },
      ]) {
        reset();
        (boundary.write ? post : get).mockResolvedValueOnce({ data: envelope });
        await expect(boundary.call()).rejects.toThrow();
        expect(session).toHaveBeenCalledTimes(2);
      }
    }
  });

  it('requires the entire immutable receipt and model to match, including exact queued timestamp precision', async () => {
    for (const changed of [
      { ...queued(), id: otherId },
      { ...queued(), scope: { ...scope, year: 2027 } },
      { ...queued(), queuedAt: '2026-10-07T02:00:00.000001Z' },
      { ...queued(), model: 'ONE_COURSE_V1' },
      { ...queued(), inputsCaptured: true },
    ]) {
      respond(changed);
      await expect(getSemesterAllocationJob(actorId, queued())).rejects.toThrow();
    }
    respond({ ...queued(), scope: { ...scope, year: 2027 } }, true);
    await expect(enqueueSemesterAllocationJob(input())).rejects.toThrow();
  });

  it('binds both read and execution outcomes to the expected job, model, complete scope and exact enqueue timestamp', async () => {
    for (const fields of [
      { jobId: otherId },
      { scope: { ...scope, curriculumId: otherId } },
      { scope: { ...scope, semester: 'SPRING' } },
      { scope: { ...scope, year: 2027 } },
      { queuedAt: '2026-10-07T02:00:00.000001Z' },
      { model: 'ONE_COURSE_V1' },
      { createdById: actorId },
    ]) {
      const changed = { ...outcome(), ...fields };
      respond(changed);
      await expect(getSemesterAllocationJobOutcome(actorId, queued())).rejects.toThrow();
      respond({ processed: false, outcome: changed }, true);
      await expect(executeSemesterAllocationJob(actorId, queued())).rejects.toThrow();
    }
  });

  it('rejects terminal regression or any changed immutable terminal detail on reads and execution', async () => {
    const previous = outcome('SUCCEEDED');
    for (const changed of [
      outcome(),
      outcome('FAILED'),
      { ...previous, runId: requestId },
      { ...previous, completedAt: '2026-10-07T02:00:01.000001Z' },
    ]) {
      respond(changed);
      await expect(getSemesterAllocationJobOutcome(actorId, queued(), previous)).rejects.toThrow();
      respond({ processed: false, outcome: changed }, true);
      await expect(executeSemesterAllocationJob(actorId, queued(), previous)).rejects.toThrow();
    }
  });

  it('accepts unchanged successful or failed terminal recovery without inventing another run', async () => {
    for (const status of ['SUCCEEDED', 'FAILED'] as const) {
      const previous = outcome(status);
      respond(previous);
      expect(await getSemesterAllocationJobOutcome(actorId, queued(), previous)).toEqual(previous);
      respond({ processed: false, outcome: previous }, true);
      expect(await executeSemesterAllocationJob(actorId, queued(), previous)).toEqual({
        processed: false,
        outcome: previous,
      });
    }
  });

  it('rejects processed-pending and expanded execution wrappers rather than publishing an unconfirmed result', async () => {
    for (const result of [
      { processed: true, outcome: outcome() },
      { processed: 'false', outcome: outcome() },
      { processed: false, outcome: outcome(), requestId },
      { processed: false, outcome: { ...outcome(), runId: otherId } },
    ]) {
      respond(result, true);
      await expect(executeSemesterAllocationJob(actorId, queued())).rejects.toThrow();
    }
  });

  it('snapshots enqueue actor, scenario and durable key before its asynchronous preflight', async () => {
    const gate = deferred<Awaited<ReturnType<typeof getSession>>>();
    session.mockImplementationOnce(() => gate.promise);
    const mutable = input();
    const pending = enqueueSemesterAllocationJob(mutable);
    mutable.curriculumId = otherId;
    mutable.requestId = otherId;
    mutable.expectedActorId = otherId;
    mutable.year = 2027;
    expect(post).not.toHaveBeenCalled();
    gate.resolve(admin());
    expect(await pending).toEqual(queued());
    expect(post).toHaveBeenCalledExactlyOnceWith('/admin/semester-allocation-jobs', input(), {
      timeout: 40000,
    });
  });

  it('snapshots selected receipts and prior terminal evidence before any awaited session check', async () => {
    for (const kind of ['receipt', 'outcome', 'execution'] as const) {
      reset();
      const gate = deferred<Awaited<ReturnType<typeof getSession>>>();
      session.mockImplementationOnce(() => gate.promise);
      const expected = queued();
      const previous = outcome('SUCCEEDED');
      respond(kind === 'receipt' ? queued() : outcome('SUCCEEDED'));
      respond({ processed: false, outcome: outcome('SUCCEEDED') }, true);
      const pending =
        kind === 'receipt'
          ? getSemesterAllocationJob(actorId, expected)
          : kind === 'outcome'
            ? getSemesterAllocationJobOutcome(actorId, expected, previous)
            : executeSemesterAllocationJob(actorId, expected, previous);
      expected.id = otherId;
      expected.scope.year = 2027;
      previous.runId = requestId;
      previous.scope.year = 2027;
      expect(get).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
      gate.resolve(admin());
      await expect(pending).resolves.toEqual(
        kind === 'receipt'
          ? queued()
          : kind === 'outcome'
            ? outcome('SUCCEEDED')
            : { processed: false, outcome: outcome('SUCCEEDED') },
      );
      if (kind === 'execution')
        expect(post).toHaveBeenCalledExactlyOnceWith(
          `/admin/semester-allocation-jobs/${jobId}/execute`,
          { ...scope, expectedActorId: actorId },
          { timeout: 40000 },
        );
      else
        expect(get).toHaveBeenCalledExactlyOnceWith(
          `/admin/semester-allocation-jobs/${jobId}${kind === 'outcome' ? '/outcome' : ''}`,
          { timeout: 40000 },
        );
    }
  });

  it('leaves lost enqueue/execution replies to explicit recovery without automatic POST retries or browser storage writes', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    const failure = new Error('Response lost after commit');
    post.mockRejectedValue(failure);
    await expect(enqueueSemesterAllocationJob(input())).rejects.toBe(failure);
    await expect(executeSemesterAllocationJob(actorId, queued())).rejects.toBe(failure);
    expect(post).toHaveBeenCalledTimes(2);
    expect(get).not.toHaveBeenCalled();
    expect(session).toHaveBeenCalledTimes(4);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(input().requestId).toBe(requestId);
  });

  it.each(guardedWrites)(
    'confirms durable recovery synchronously after $name preflight and immediately before its sole POST',
    async (write) => {
      const gate = deferred<Awaited<ReturnType<typeof getSession>>>();
      const events: string[] = [];
      session
        .mockImplementationOnce(() => {
          events.push('preflight');
          return gate.promise;
        })
        .mockImplementationOnce(async () => {
          events.push('postflight');
          return admin();
        });
      post.mockImplementationOnce(async () => {
        events.push('POST');
        return { data: { success: true, data: write.reply() } };
      });
      const confirm = vi.fn(() => {
        events.push('confirm');
        return undefined;
      });
      const pending = write.call(confirm);
      expect(events).toEqual(['preflight']);
      expect(confirm).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
      gate.resolve(admin());
      await expect(pending).resolves.toEqual(write.reply());
      expect(events).toEqual(['preflight', 'confirm', 'POST', 'postflight']);
      expect(confirm).toHaveBeenCalledExactlyOnceWith();
      expect(post).toHaveBeenCalledTimes(1);
    },
  );

  it.each(guardedWrites)(
    'blocks $name when durable confirmation changed during preflight and still verifies final authorization',
    async (write) => {
      const gate = deferred<Awaited<ReturnType<typeof getSession>>>();
      session.mockImplementationOnce(() => gate.promise);
      let durableBytes = 'original';
      const failure = new Error('Durable request was replaced in another tab');
      const confirm = vi.fn(() => {
        if (durableBytes !== 'original') throw failure;
        return undefined;
      });
      const pending = write.call(confirm);
      const rejected = expect(pending).rejects.toBe(failure);
      durableBytes = 'replaced';
      gate.resolve(admin());
      await rejected;
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(post).not.toHaveBeenCalled();
      expect(session).toHaveBeenCalledTimes(2);
      session.mockResolvedValueOnce(admin()).mockResolvedValueOnce(admin(otherId));
      await expect(write.call(confirm)).rejects.toBeInstanceOf(SemesterJobSessionChangedError);
      expect(post).not.toHaveBeenCalled();
      expect(session).toHaveBeenCalledTimes(4);
    },
  );

  it('rejects malformed callbacks before I/O and any nonundefined or asynchronous return before POST', async () => {
    for (const write of guardedWrites) {
      for (const invalid of [null, 'confirm', {}]) {
        reset();
        await expect(write.call(invalid as unknown as () => undefined)).rejects.toThrow();
        expect(session).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
      }
      for (const returned of [true, Promise.resolve(undefined), { then: () => undefined }]) {
        reset();
        const confirm = vi.fn(() => returned) as unknown as () => undefined;
        await expect(write.call(confirm)).rejects.toThrow();
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(post).not.toHaveBeenCalled();
        expect(session).toHaveBeenCalledTimes(2);
      }
    }
  });
});
