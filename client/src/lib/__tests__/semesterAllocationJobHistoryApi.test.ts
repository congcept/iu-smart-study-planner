import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ListSemesterAllocationJobsDTO,
  SemesterAllocationJobDTO,
  SemesterAllocationJobHistoryDTO,
  SemesterAllocationJobOutcomeDTO,
} from '@iu-study-planner/shared';
import { referenceSession } from '@/test/fixtures/curriculumReference';
import apiClient, { getSession } from '../api';
import {
  listSemesterAllocationJobs,
  SemesterJobSessionChangedError,
} from '../semesterAllocationJobsApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() }, getSession: vi.fn() }));
const get = vi.mocked(apiClient.get);
const session = vi.mocked(getSession);
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const contextId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const otherId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const scope = { curriculumId: contextId, semester: 'FALL' as const, year: 2026 };
const admin = (id = actorId) => ({ ...referenceSession(null, id), role: 'ADMIN' as const });
const job = (index = 1): SemesterAllocationJobDTO => ({
  id: `dddddddd-dddd-4ddd-8ddd-${index.toString(16).padStart(12, '0')}`,
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  model: 'SEMESTER_CREDIT_BUDGET_V1',
  scope: { ...scope },
  status: 'QUEUED',
  queuedAt: '2026-10-08T01:00:00.000Z',
  inputsCaptured: false,
});
const entry = (
  receipt = job(),
  status: SemesterAllocationJobOutcomeDTO['status'] = 'PENDING',
): SemesterAllocationJobHistoryDTO['requests'][number] => ({
  job: receipt,
  outcome: {
    jobId: receipt.id,
    kind: 'SIMULATION' as const,
    usage: 'REFERENCE_ONLY' as const,
    model: 'SEMESTER_CREDIT_BUDGET_V1' as const,
    scope: { ...receipt.scope },
    queuedAt: receipt.queuedAt,
    executionModel: 'ATOMIC_SINGLE_JOB' as const,
    status,
    runId: status === 'SUCCEEDED' ? otherId : null,
    completedAt: status === 'PENDING' ? null : '2026-10-08T01:00:01.000Z',
    failureCode: status === 'FAILED' ? ('AUTHOR_UNAVAILABLE' as const) : null,
  },
});
const page = (
  requests = [entry()],
  after: string | null = null,
): SemesterAllocationJobHistoryDTO => ({
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  model: 'SEMESTER_CREDIT_BUDGET_V1',
  scope: { ...scope },
  order: 'QUEUED_NEWEST_FIRST',
  pageSize: 5,
  after,
  requests,
  nextAfter: null,
});
const respond = (data: unknown, success: unknown = true) =>
  get.mockResolvedValue({ data: { success, data } });
const reset = () => {
  vi.resetAllMocks();
  session.mockResolvedValue(admin());
  respond(page());
};
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(reset);
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('strict scenario semester request history API', () => {
  it('reads one first page with scoped parameters and fresh administrator checks on both sides', async () => {
    expect(await listSemesterAllocationJobs(actorId, scope)).toEqual(page());
    expect(get).toHaveBeenCalledExactlyOnceWith('/admin/semester-allocation-jobs', {
      timeout: 40000,
      params: scope,
    });
    expect(session).toHaveBeenCalledTimes(2);
    expect(session.mock.invocationCallOrder[0]).toBeLessThan(get.mock.invocationCallOrder[0]);
    expect(get.mock.invocationCallOrder[0]).toBeLessThan(session.mock.invocationCallOrder[1]);
    expect(apiClient.post).not.toHaveBeenCalled();
  });
  it('normalizes owner, scenario and confirmed continuation UUIDs without identity query fields', async () => {
    const boundary = job(5);
    respond(page([entry(job(4))], boundary.id));
    const request = {
      ...scope,
      curriculumId: contextId.toUpperCase(),
      after: boundary.id.toUpperCase(),
    };
    expect(
      await listSemesterAllocationJobs(actorId.toUpperCase(), request, {
        ...boundary,
        id: boundary.id.toUpperCase(),
      }),
    ).toEqual(page([entry(job(4))], boundary.id));
    expect(get).toHaveBeenCalledExactlyOnceWith('/admin/semester-allocation-jobs', {
      timeout: 40000,
      params: { ...scope, after: boundary.id },
    });
  });
  it('rejects malformed owner/scope/cursor and expanded input before session or data I/O', async () => {
    await expect(listSemesterAllocationJobs(`${actorId}\n`, scope)).rejects.toThrow();
    for (const fields of [
      { curriculumId: 'CS' },
      { year: 1999 },
      { after: `${job().id}\n` },
      { after: '' },
      { ownerId: actorId },
      { pageSize: 20 },
      { status: 'FAILED' },
    ])
      await expect(
        listSemesterAllocationJobs(actorId, {
          ...scope,
          ...fields,
        } as ListSemesterAllocationJobsDTO),
      ).rejects.toThrow();
    expect(session).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
  it('requires a strict receipt with the exact cursor and complete scope before requesting continuation', async () => {
    const boundary = job(5);
    for (const [request, expected] of [
      [{ ...scope, after: boundary.id }, undefined],
      [scope, boundary],
      [{ ...scope, after: boundary.id }, job(4)],
      [
        { ...scope, after: boundary.id },
        { ...boundary, scope: { ...scope, year: 2027 } },
      ],
      [
        { ...scope, after: boundary.id },
        { ...boundary, createdById: actorId },
      ],
    ] as const)
      await expect(
        listSemesterAllocationJobs(
          actorId,
          request,
          expected as SemesterAllocationJobDTO | undefined,
        ),
      ).rejects.toThrow();
    expect(session).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
  it('rejects a response that echoes a different continuation or scope', async () => {
    const boundary = job(5);
    respond(page([entry(job(4))]));
    await expect(
      listSemesterAllocationJobs(actorId, { ...scope, after: boundary.id }, boundary),
    ).rejects.toThrow();
    respond({ ...page([]), scope: { ...scope, year: 2027 } });
    await expect(listSemesterAllocationJobs(actorId, scope)).rejects.toThrow();
    expect(session).toHaveBeenCalledTimes(4);
  });
  it('rejects private participant/author fields and expanded receipt/outcome pairs', async () => {
    for (const corrupt of [
      { ...page(), students: [actorId] },
      page([{ ...entry(), authorId: actorId } as ReturnType<typeof entry>]),
      page([{ ...entry(), job: { ...job(), requestId: otherId } as SemesterAllocationJobDTO }]),
      page([
        {
          ...entry(),
          outcome: {
            ...entry().outcome,
            students: [{ studentId: actorId }],
          } as SemesterAllocationJobOutcomeDTO,
        },
      ]),
    ]) {
      respond(corrupt);
      await expect(listSemesterAllocationJobs(actorId, scope)).rejects.toThrow();
    }
  });
  it('binds each original receipt and outcome to one model, scenario, ID and exact enqueue time', async () => {
    for (const fields of [
      { jobId: otherId },
      { queuedAt: '2026-10-08T01:00:00.000001Z' },
      { model: 'ONE_COURSE_V1' },
      { scope: { ...scope, semester: 'SPRING' } },
    ]) {
      respond(
        page([
          {
            ...entry(),
            outcome: { ...entry().outcome, ...fields } as SemesterAllocationJobOutcomeDTO,
          },
        ]),
      );
      await expect(listSemesterAllocationJobs(actorId, scope)).rejects.toThrow();
    }
  });
  it('rejects duplicate, reordered and oversized pages rather than publishing a misleading history', async () => {
    for (const requests of [
      [entry(job(1)), entry(job(2))],
      [entry(), entry()],
      [6, 5, 4, 3, 2, 1].map((index) => entry(job(index))),
    ]) {
      respond(page(requests));
      await expect(listSemesterAllocationJobs(actorId, scope)).rejects.toThrow();
    }
    respond({ ...page(), nextAfter: job().id });
    await expect(listSemesterAllocationJobs(actorId, scope)).rejects.toThrow();
  });
  it('requires every continuation row to be strictly older than the confirmed timestamp and ID boundary', async () => {
    const boundary = job(5);
    for (const receipt of [job(6), boundary, { ...job(4), queuedAt: '2026-10-08T01:00:00.001Z' }]) {
      respond(page([entry(receipt)], boundary.id));
      await expect(
        listSemesterAllocationJobs(actorId, { ...scope, after: boundary.id }, boundary),
      ).rejects.toThrow();
    }
  });
  it('preserves submillisecond ordering across the boundary instead of comparing rounded dates', async () => {
    const boundary = { ...job(5), queuedAt: '2026-10-08T01:00:00.000002Z' };
    const older = { ...job(6), queuedAt: '2026-10-08T01:00:00.000001Z' };
    respond(page([entry(older)], boundary.id));
    expect(
      (await listSemesterAllocationJobs(actorId, { ...scope, after: boundary.id }, boundary))
        .requests,
    ).toEqual([entry(older)]);
  });
  it('blocks changed, invalid and non-administrator preflight sessions before history reads', async () => {
    for (const invalid of [admin(otherId), admin(''), { ...admin(), role: 'STUDENT' as const }]) {
      reset();
      session.mockResolvedValueOnce(invalid);
      await expect(listSemesterAllocationJobs(actorId, scope)).rejects.toBeInstanceOf(
        SemesterJobSessionChangedError,
      );
      expect(get).not.toHaveBeenCalled();
    }
  });
  it('keeps session-preflight failures ahead of any history request', async () => {
    const failure = new Error('Session offline');
    session.mockRejectedValueOnce(failure);
    await expect(listSemesterAllocationJobs(actorId, scope)).rejects.toBe(failure);
    expect(get).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'checks final administrator state after data failure=%s before publishing its result',
    async (failed) => {
      if (failed) get.mockRejectedValueOnce(new Error('Another account history failure'));
      session.mockResolvedValueOnce(admin()).mockResolvedValueOnce(admin(otherId));
      await expect(listSemesterAllocationJobs(actorId, scope)).rejects.toBeInstanceOf(
        SemesterJobSessionChangedError,
      );
      expect(session).toHaveBeenCalledTimes(2);
      expect(get).toHaveBeenCalledTimes(1);
    },
  );
  it('publishes neither a page nor a private data error when final authorization cannot be read', async () => {
    for (const failed of [false, true]) {
      reset();
      if (failed) get.mockRejectedValueOnce(new Error('Data failure'));
      const unavailable = new Error('Final session offline');
      session.mockResolvedValueOnce(admin()).mockRejectedValueOnce(unavailable);
      await expect(listSemesterAllocationJobs(actorId, scope)).rejects.toBe(unavailable);
      expect(session).toHaveBeenCalledTimes(2);
    }
  });
  it('preserves same-administrator HTTP failures without retries or fallback identity reads', async () => {
    for (const status of [401, 403, 409, 500]) {
      reset();
      const failure = Object.assign(new Error('History unavailable'), { response: { status } });
      get.mockRejectedValueOnce(failure);
      await expect(listSemesterAllocationJobs(actorId, scope)).rejects.toBe(failure);
      expect(get).toHaveBeenCalledTimes(1);
      expect(session).toHaveBeenCalledTimes(2);
      expect(apiClient.post).not.toHaveBeenCalled();
    }
  });
  it('rejects unconfirmed envelopes while still applying the final session barrier', async () => {
    for (const envelope of [
      { success: false, data: page() },
      { success: 'true', data: page() },
      { success: true },
      { success: true, data: null },
    ]) {
      reset();
      get.mockResolvedValueOnce({ data: envelope });
      await expect(listSemesterAllocationJobs(actorId, scope)).rejects.toThrow();
      expect(session).toHaveBeenCalledTimes(2);
    }
  });
  it('snapshots scope, cursor and immutable boundary before the asynchronous preflight', async () => {
    const gate = deferred<Awaited<ReturnType<typeof getSession>>>();
    session.mockImplementationOnce(() => gate.promise);
    const boundary = job(5);
    const request = { ...scope, after: boundary.id };
    respond(page([entry(job(4))], boundary.id));
    const pending = listSemesterAllocationJobs(actorId, request, boundary);
    boundary.id = otherId;
    boundary.scope.year = 2027;
    boundary.queuedAt = '2026-10-09T01:00:00.000Z';
    request.after = otherId;
    request.year = 2027;
    expect(get).not.toHaveBeenCalled();
    gate.resolve(admin());
    expect(await pending).toEqual(page([entry(job(4))], job(5).id));
    expect(get).toHaveBeenCalledExactlyOnceWith('/admin/semester-allocation-jobs', {
      timeout: 40000,
      params: { ...scope, after: job(5).id },
    });
  });
  it('does not write browser recovery, execute work, poll or reload on focus after one history read', async () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    await listSemesterAllocationJobs(actorId, scope);
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(get).toHaveBeenCalledTimes(1);
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });
  it('accepts empty and short terminal pages without inventing a continuation', async () => {
    for (const requests of [[], [entry(job(2), 'SUCCEEDED'), entry(job(1), 'FAILED')]]) {
      respond(page(requests));
      expect(await listSemesterAllocationJobs(actorId, scope)).toEqual(page(requests));
    }
  });
});
