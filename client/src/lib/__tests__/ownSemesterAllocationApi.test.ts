import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ListOwnSemesterAllocationRunsDTO,
  OwnSemesterAllocationRunV1DTO,
} from '@iu-study-planner/shared';
import { ownerId, referenceSession } from '@/test/fixtures/curriculumReference';
import { ownSemesterAllocationRun } from '@/test/fixtures/ownSemesterAllocationRun';
import apiClient, { getSession } from '../api';
import {
  getOwnSemesterAllocationRun,
  listOwnSemesterAllocationRuns,
  OwnSemesterSessionChangedError,
} from '../ownSemesterAllocationApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() }, getSession: vi.fn() }));
const get = vi.mocked(apiClient.get);
const session = vi.mocked(getSession);
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const page = (runs: unknown[] = [ownSemesterAllocationRun()], after: string | null = null) => ({
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  visibility: 'CURRENT_ACCOUNT_ONLY',
  order: 'STORED_NEWEST_FIRST',
  pageSize: 5,
  after,
  runs,
  nextAfter: null,
});
const respond = (data: unknown, success = true) =>
  get.mockResolvedValue({ data: { success, data } });
beforeEach(() => {
  vi.resetAllMocks();
  session.mockResolvedValue(referenceSession(null));
  respond(page());
});

describe('strict current-account own semester readers', () => {
  it('reads the first page with owner checks and no identity or scope query', async () => {
    expect(await listOwnSemesterAllocationRuns(ownerId.toUpperCase())).toEqual(page());
    expect(get).toHaveBeenCalledExactlyOnceWith('/users/me/semester-allocation-runs', {
      timeout: 40000,
      params: {},
    });
    expect(session).toHaveBeenCalledTimes(2);
    expect(apiClient.post).not.toHaveBeenCalled();
  });
  it('accepts historical owner access after role or curriculum changes', async () => {
    session.mockResolvedValue({ ...referenceSession(otherId), role: 'ADMIN' });
    expect(await listOwnSemesterAllocationRuns(ownerId)).toEqual(page());
  });
  it('returns an empty terminal page without inventing a continuation', async () => {
    respond(page([]));
    expect((await listOwnSemesterAllocationRuns(ownerId)).nextAfter).toBeNull();
  });
  it('normalizes and checks the confirmed boundary before sending a continuation', async () => {
    const boundary = ownSemesterAllocationRun(5);
    const request = { after: boundary.id.toUpperCase() };
    respond(page([ownSemesterAllocationRun(4)], boundary.id));
    expect((await listOwnSemesterAllocationRuns(ownerId, request, boundary)).after).toBe(
      boundary.id,
    );
    expect(get).toHaveBeenCalledWith('/users/me/semester-allocation-runs', {
      timeout: 40000,
      params: { after: boundary.id },
    });
  });
  it('requires the exact validated previous boundary rather than an arbitrary supplied cursor', async () => {
    const boundary = ownSemesterAllocationRun(5);
    for (const call of [
      () => listOwnSemesterAllocationRuns(ownerId, { after: boundary.id }),
      () =>
        listOwnSemesterAllocationRuns(ownerId, { after: boundary.id }, ownSemesterAllocationRun(4)),
      () => listOwnSemesterAllocationRuns(ownerId, {}, boundary),
    ])
      await expect(call()).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
  });
  it('rejects invalid owners, identifiers and extra query fields before network access', async () => {
    await expect(listOwnSemesterAllocationRuns('invalid')).rejects.toThrow();
    await expect(
      getOwnSemesterAllocationRun(ownerId, `${ownSemesterAllocationRun().id}\n`),
    ).rejects.toThrow();
    await expect(
      listOwnSemesterAllocationRuns(ownerId, {
        userId: otherId,
      } as ListOwnSemesterAllocationRunsDTO),
    ).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
  });
  it('rejects a response from a different requested continuation', async () => {
    const boundary = ownSemesterAllocationRun(5);
    respond(page([ownSemesterAllocationRun(4)], null));
    await expect(
      listOwnSemesterAllocationRuns(ownerId, { after: boundary.id }, boundary),
    ).rejects.toThrow(/boundary/);
    expect(session).toHaveBeenCalledTimes(2);
  });
  it.each(['newer', 'same', 'repeated'] as const)(
    'rejects a %s record across a confirmed page boundary',
    async (kind) => {
      const boundary = ownSemesterAllocationRun(5);
      const row =
        kind === 'repeated' ? boundary : ownSemesterAllocationRun(kind === 'same' ? 6 : 4);
      if (kind === 'newer') row.createdAt = '2026-10-07T02:00:02.000Z';
      respond(page([row], boundary.id));
      await expect(
        listOwnSemesterAllocationRuns(ownerId, { after: boundary.id }, boundary),
      ).rejects.toThrow();
      expect(session).toHaveBeenCalledTimes(2);
    },
  );
  it('preserves submillisecond boundary precision instead of comparing rounded dates', async () => {
    const boundary = { ...ownSemesterAllocationRun(5), createdAt: '2026-10-07T02:00:01.000002Z' };
    const older = { ...ownSemesterAllocationRun(6), createdAt: '2026-10-07T02:00:01.000001Z' };
    respond(page([older], boundary.id));
    expect(
      (await listOwnSemesterAllocationRuns(ownerId, { after: boundary.id }, boundary)).runs,
    ).toEqual([older]);
  });
  it.each([
    ['private roster', () => ({ ...page(), students: [{ studentId: otherId }] })],
    [
      'private result',
      () =>
        page([
          {
            ...ownSemesterAllocationRun(),
            result: { ...ownSemesterAllocationRun().result, studentId: otherId },
          },
        ]),
    ],
    [
      'inconsistent credits',
      () =>
        page([
          {
            ...ownSemesterAllocationRun(),
            courses: [{ courseId: ownSemesterAllocationRun().courses[0].courseId, credits: 5 }],
          },
        ]),
    ],
    ['official claim', () => page([{ ...ownSemesterAllocationRun(), academicPlansChanged: true }])],
    ['oversized page', () => page([6, 5, 4, 3, 2, 1].map(ownSemesterAllocationRun))],
  ] as const)('rejects %s without publishing an unvalidated page', async (_, make) => {
    respond(make());
    await expect(listOwnSemesterAllocationRuns(ownerId)).rejects.toThrow();
    expect(session).toHaveBeenCalledTimes(2);
  });
  it('checks the exact run identifier without writing or transmitting owner identity', async () => {
    const run = ownSemesterAllocationRun();
    respond({ ...run, id: run.id.toUpperCase() });
    expect(await getOwnSemesterAllocationRun(ownerId, run.id.toUpperCase())).toEqual(run);
    expect(get).toHaveBeenCalledExactlyOnceWith(`/users/me/semester-allocation-runs/${run.id}`, {
      timeout: 40000,
    });
    expect(apiClient.post).not.toHaveBeenCalled();
  });
  it('rejects a different returned run or selected receipt before publishing detail', async () => {
    const run = ownSemesterAllocationRun();
    respond(ownSemesterAllocationRun(2));
    await expect(getOwnSemesterAllocationRun(ownerId, run.id)).rejects.toThrow(/receipt/);
    await expect(
      getOwnSemesterAllocationRun(ownerId, run.id, ownSemesterAllocationRun(2)),
    ).rejects.toThrow(/identifier/);
  });
  it('requires selected history and exact reads to agree on the entire immutable owner receipt', async () => {
    const expected = ownSemesterAllocationRun();
    respond(expected);
    expect(await getOwnSemesterAllocationRun(ownerId, expected.id, expected)).toEqual(expected);
    const altered: OwnSemesterAllocationRunV1DTO = {
      ...expected,
      scope: { ...expected.scope, semester: 'SPRING' },
    };
    respond(altered);
    await expect(getOwnSemesterAllocationRun(ownerId, expected.id, expected)).rejects.toThrow(
      /immutable/,
    );
  });
  it('blocks an invalid or different preflight account before reading private history', async () => {
    session
      .mockResolvedValueOnce({ ...referenceSession(null), id: "" })
      .mockResolvedValueOnce({ ...referenceSession(null), id: otherId });
    await expect(listOwnSemesterAllocationRuns(ownerId)).rejects.toBeInstanceOf(
      OwnSemesterSessionChangedError,
    );
    await expect(
      getOwnSemesterAllocationRun(ownerId, ownSemesterAllocationRun().id),
    ).rejects.toBeInstanceOf(OwnSemesterSessionChangedError);
    expect(get).not.toHaveBeenCalled();
  });
  it('does not read history when session preflight is unavailable', async () => {
    const failed = new Error('Session unavailable');
    session.mockRejectedValueOnce(failed);
    await expect(listOwnSemesterAllocationRuns(ownerId)).rejects.toBe(failed);
    expect(get).not.toHaveBeenCalled();
  });
  it.each(['page', 'detail'] as const)(
    'discards a successful %s read after a final account change',
    async (kind) => {
      session
        .mockResolvedValueOnce(referenceSession(null))
        .mockResolvedValueOnce({ ...referenceSession(null), id: otherId });
      respond(kind === 'page' ? page() : ownSemesterAllocationRun());
      const read =
        kind === 'page'
          ? listOwnSemesterAllocationRuns(ownerId)
          : getOwnSemesterAllocationRun(ownerId, ownSemesterAllocationRun().id);
      await expect(read).rejects.toBeInstanceOf(OwnSemesterSessionChangedError);
      expect(get).toHaveBeenCalledTimes(1);
    },
  );
  it('checks final account state on failed reads before exposing their error', async () => {
    const failure = new Error('Other-account response');
    get.mockRejectedValueOnce(failure);
    session
      .mockResolvedValueOnce(referenceSession(null))
      .mockResolvedValueOnce({ ...referenceSession(null), id: otherId });
    await expect(listOwnSemesterAllocationRuns(ownerId)).rejects.toBeInstanceOf(
      OwnSemesterSessionChangedError,
    );
    expect(session).toHaveBeenCalledTimes(2);
  });
  it('preserves a recoverable read failure for the same confirmed owner', async () => {
    const failure = new Error('Read unavailable');
    get.mockRejectedValueOnce(failure);
    await expect(listOwnSemesterAllocationRuns(ownerId)).rejects.toBe(failure);
    expect(session).toHaveBeenCalledTimes(2);
  });
  it('rejects failed envelopes and unavailable final session confirmation', async () => {
    respond(page(), false);
    await expect(listOwnSemesterAllocationRuns(ownerId)).rejects.toThrow(/history/);
    session
      .mockResolvedValueOnce(referenceSession(null))
      .mockRejectedValueOnce(new Error('Final session unavailable'));
    respond(page());
    await expect(listOwnSemesterAllocationRuns(ownerId)).rejects.toThrow(/Final session/);
  });
});
