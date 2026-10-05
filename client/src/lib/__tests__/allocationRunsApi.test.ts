import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AllocationRunV1DTO,
  CreateAllocationRunDTO,
  ResourceScopeDTO,
} from '@iu-study-planner/shared';
import { allocationRun } from '@/test/fixtures/allocationRun';
import apiClient from '../api';
import { createAllocationRun, getAllocationRun } from '../allocationRunsApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
type CaptureRequest = CreateAllocationRunDTO & { expectedActorId: string };
const actorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const requestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const otherId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const run = allocationRun();
const scope = run.result.scope;
const input: CaptureRequest = { ...scope, requestId, expectedActorId: actorId };
const verificationError = 'Could not verify the saved simulation capture. Retry to recover it.';

beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ data: { success: true, data: allocationRun() } });
  post.mockResolvedValue({ data: { success: true, data: allocationRun() } });
});

describe('immutable aggregate allocation run adapter', () => {
  it('captures one server run using the verified actor and immutable retry identity', async () => {
    expect(await createAllocationRun(input)).toEqual(run);
    expect(post).toHaveBeenCalledExactlyOnceWith('/admin/allocation-runs', input);
    expect(get).not.toHaveBeenCalled();
  });

  it('reads one historical run by its UUID and verifies its requested scenario', async () => {
    expect(await getAllocationRun(run.id, scope)).toEqual(run);
    expect(get).toHaveBeenCalledExactlyOnceWith(`/admin/allocation-runs/${run.id}`);
    expect(post).not.toHaveBeenCalled();
  });

  it('normalizes every outgoing POST UUID and returned run, curriculum and course identity', async () => {
    const response = allocationRun();
    response.id = response.id.toUpperCase();
    response.result.scope.curriculumId = response.result.scope.curriculumId.toUpperCase();
    response.result.curriculum.id = response.result.curriculum.id.toUpperCase();
    response.result.courses = response.result.courses.map((course) => ({
      ...course,
      id: course.id.toUpperCase(),
    }));
    post.mockResolvedValue({ data: { success: true, data: response } });
    expect(
      await createAllocationRun({
        ...input,
        curriculumId: input.curriculumId.toUpperCase(),
        requestId: requestId.toUpperCase(),
        expectedActorId: actorId.toUpperCase(),
      }),
    ).toEqual(run);
    expect(post).toHaveBeenCalledExactlyOnceWith('/admin/allocation-runs', input);
  });

  it('normalizes the GET run and scope UUIDs before checking returned history', async () => {
    get.mockResolvedValue({ data: { success: true, data: { ...run, id: run.id.toUpperCase() } } });
    expect(
      await getAllocationRun(run.id.toUpperCase(), {
        ...scope,
        curriculumId: scope.curriculumId.toUpperCase(),
      }),
    ).toEqual(run);
    expect(get).toHaveBeenCalledExactlyOnceWith(`/admin/allocation-runs/${run.id}`);
  });

  it.each([
    { expectedActorId: undefined },
    { expectedActorId: null },
    { expectedActorId: '' },
    { expectedActorId: 'student-id' },
    { requestId: undefined },
    { requestId: 'retry' },
    { curriculumId: 'CS' },
    { semester: 'WINTER' },
    { year: 1999 },
    { year: 2101 },
    { year: 2026.5 },
    { actorId },
    { role: 'ADMIN' },
    { result: run.result },
  ])('rejects invalid or expanded capture input %# before any request', async (override) => {
    await expect(
      createAllocationRun({ ...input, ...override } as CaptureRequest),
    ).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it.each(['', 'run-id', `${run.id} `, null, undefined])(
    'rejects invalid run UUID %j before reading',
    async (id) => {
      await expect(getAllocationRun(id as string, scope)).rejects.toThrow();
      expect(get).not.toHaveBeenCalled();
    },
  );

  it.each([
    { curriculumId: 'CS' },
    { semester: 'WINTER' },
    { year: 1999 },
    { year: 2101 },
    { year: 2026.5 },
    { actorId },
  ])('rejects invalid or expanded historical scope %# before reading', async (override) => {
    await expect(
      getAllocationRun(run.id, { ...scope, ...override } as ResourceScopeDTO),
    ).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });

  const corruptions: [string, (value: AllocationRunV1DTO) => unknown][] = [
    ['unsupported format', (value) => ({ ...value, formatVersion: 2 })],
    ['storage not confirmed', (value) => ({ ...value, snapshotStored: false })],
    ['invalid capture time', (value) => ({ ...value, capturedAt: 'yesterday' })],
    ['capture after storage', (value) => ({ ...value, capturedAt: '2026-10-06T00:00:00.000Z' })],
    ['private actor', (value) => ({ ...value, actorId })],
    ['private request', (value) => ({ ...value, requestId })],
    ['private student', (value) => ({ ...value, result: { ...value.result, studentId: actorId } })],
    [
      'individual assignments',
      (value) => ({ ...value, result: { ...value.result, assignments: [{ studentId: actorId }] } }),
    ],
    [
      'incorrect validation',
      (value) => ({ ...value, result: { ...value.result, allocationValidated: true } }),
    ],
    [
      'claimed assignment persistence',
      (value) => ({ ...value, result: { ...value.result, assignmentsPersisted: true } }),
    ],
    [
      'cohort partition',
      (value) => ({
        ...value,
        result: { ...value.result, cohortStudentCount: value.result.cohortStudentCount + 1 },
      }),
    ],
    [
      'invalid utility',
      (value) => ({
        ...value,
        result: {
          ...value.result,
          utilityPolicy: { difficultyFitWeight: 0.9, immediateUnlockWeight: 0.3 },
        },
      }),
    ],
    [
      'unknown utility field',
      (value) => ({
        ...value,
        result: {
          ...value.result,
          utilityPolicy: { ...value.result.utilityPolicy, categoryWeight: 0.1 },
        },
      }),
    ],
    [
      'private course scores',
      (value) => ({
        ...value,
        result: {
          ...value.result,
          courses: value.result.courses.map((course) => ({ ...course, studentUtility: 0.5 })),
        },
      }),
    ],
    [
      'incorrect course seats',
      (value) => ({
        ...value,
        result: {
          ...value.result,
          courses: value.result.courses.map((course, index) =>
            index === 0 ? { ...course, seatCapacity: course.seatCapacity + 1 } : course,
          ),
        },
      }),
    ],
    [
      'inconsistent ceiling',
      (value) => ({
        ...value,
        result: {
          ...value.result,
          resources: { ...value.result.resources, sharedSeatCeiling: 123456 },
        },
      }),
    ],
  ];
  it.each(corruptions)('rejects %s on capture and historical retrieval', async (_name, corrupt) => {
    const data = corrupt(allocationRun());
    post.mockResolvedValue({ data: { success: true, data } });
    get.mockResolvedValue({ data: { success: true, data } });
    await expect(createAllocationRun(input)).rejects.toThrow(verificationError);
    await expect(getAllocationRun(run.id, scope)).rejects.toThrow(verificationError);
  });

  it.each([{ curriculumId: otherId }, { semester: 'SPRING' as const }, { year: 2027 }])(
    'rejects valid history from a different requested scenario %#',
    async (override) => {
      const different = allocationRun({ ...scope, ...override });
      post.mockResolvedValue({ data: { success: true, data: different } });
      get.mockResolvedValue({ data: { success: true, data: different } });
      await expect(createAllocationRun(input)).rejects.toThrow(verificationError);
      await expect(getAllocationRun(run.id, scope)).rejects.toThrow(verificationError);
    },
  );

  it('rejects a valid same-scope historical response with a different run identity', async () => {
    get.mockResolvedValue({ data: { success: true, data: { ...run, id: otherId } } });
    await expect(getAllocationRun(run.id, scope)).rejects.toThrow(verificationError);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    {},
    { success: true },
    { success: false, data: run },
    { success: 'true', data: run },
    { success: true, data: null },
  ])('rejects incomplete or unsuccessful response envelope %#', async (envelope) => {
    post.mockResolvedValue({ data: envelope });
    get.mockResolvedValue({ data: envelope });
    await expect(createAllocationRun(input)).rejects.toThrow(verificationError);
    await expect(getAllocationRun(run.id, scope)).rejects.toThrow(verificationError);
  });

  it.each([401, 403, 409, 500])(
    'propagates HTTP %s without substituting or automatically retrying history',
    async (status) => {
      const failure = Object.assign(new Error('server rejected request'), {
        response: { status, data: { success: false, error: 'server rejected request' } },
      });
      post.mockRejectedValue(failure);
      get.mockRejectedValue(failure);
      await expect(createAllocationRun(input)).rejects.toBe(failure);
      await expect(getAllocationRun(run.id, scope)).rejects.toBe(failure);
      expect(post).toHaveBeenCalledTimes(1);
      expect(get).toHaveBeenCalledTimes(1);
    },
  );

  it('propagates a lost capture response with its original retry key available to the caller', async () => {
    const failure = new Error('lost response');
    post.mockRejectedValueOnce(failure);
    await expect(createAllocationRun(input)).rejects.toBe(failure);
    expect(post).toHaveBeenCalledExactlyOnceWith('/admin/allocation-runs', input);
    expect(input.requestId).toBe(requestId);
  });
});
