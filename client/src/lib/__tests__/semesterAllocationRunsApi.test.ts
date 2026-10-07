import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateSemesterAllocationRunDTO,
  SemesterAllocationRunV1DTO,
} from '@iu-study-planner/shared';
import { semesterAllocationRun } from '@/test/fixtures/semesterAllocationRun';
import apiClient from '../api';
import {
  createSemesterAllocationRun,
  getSemesterAllocationRun,
} from '../semesterAllocationRunsApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const actorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const requestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const otherId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const scope = semesterAllocationRun().result.scope;
const input: CreateSemesterAllocationRunDTO = { ...scope, requestId, expectedActorId: actorId };

beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ data: { success: true, data: semesterAllocationRun() } });
  post.mockResolvedValue({ data: { success: true, data: semesterAllocationRun() } });
});

describe('immutable semester allocation aggregate API', () => {
  it('sends only the normalized actor, scenario and stable retry key on capture', async () => {
    expect(
      await createSemesterAllocationRun({
        ...input,
        curriculumId: input.curriculumId.toUpperCase(),
        requestId: requestId.toUpperCase(),
        expectedActorId: actorId.toUpperCase(),
      }),
    ).toEqual(semesterAllocationRun());
    expect(post).toHaveBeenCalledExactlyOnceWith('/admin/semester-allocation-runs', input);
    expect(get).not.toHaveBeenCalled();
  });

  it('loads the exact normalized historical run without creating another capture', async () => {
    const run = semesterAllocationRun();
    get.mockResolvedValue({ data: { success: true, data: { ...run, id: run.id.toUpperCase() } } });
    expect(
      await getSemesterAllocationRun(run.id.toUpperCase(), {
        ...scope,
        curriculumId: scope.curriculumId.toUpperCase(),
      }),
    ).toEqual(run);
    expect(get).toHaveBeenCalledExactlyOnceWith(`/admin/semester-allocation-runs/${run.id}`);
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    { expectedActorId: undefined },
    { requestId: `${requestId}\n` },
    { result: semesterAllocationRun().result },
  ])(
    'rejects a missing actor, noncanonical UUID or supplied result before POST %#',
    async (fields) => {
      await expect(
        createSemesterAllocationRun({ ...input, ...fields } as CreateSemesterAllocationRunDTO),
      ).rejects.toThrow();
      expect(post).not.toHaveBeenCalled();
    },
  );

  it('rejects an expanded scenario or noncanonical historical ID before GET', async () => {
    await expect(
      getSemesterAllocationRun(`${semesterAllocationRun().id}\n`, scope),
    ).rejects.toThrow();
    await expect(
      getSemesterAllocationRun(semesterAllocationRun().id, { ...scope, year: 1999 }),
    ).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });

  const corruptions: [string, (run: SemesterAllocationRunV1DTO) => unknown][] = [
    [
      'private participant data',
      (run) => ({ ...run, result: { ...run.result, students: [{ studentId: actorId }] } }),
    ],
    ['unconfirmed assignment storage', (run) => ({ ...run, simulationAssignmentsStored: false })],
    [
      'inconsistent credits',
      (run) => ({
        ...run,
        result: { ...run.result, totalAssignedCredits: run.result.totalAssignedCredits + 1 },
      }),
    ],
    ['unsupported format', (run) => ({ ...run, formatVersion: 2 })],
  ];
  it.each(corruptions)(
    'rejects %s for both creation and historical reads',
    async (_name, corrupt) => {
      const data = corrupt(semesterAllocationRun());
      get.mockResolvedValue({ data: { success: true, data } });
      post.mockResolvedValue({ data: { success: true, data } });
      await expect(createSemesterAllocationRun(input)).rejects.toThrow('Could not verify');
      await expect(getSemesterAllocationRun(semesterAllocationRun().id, scope)).rejects.toThrow(
        'Could not verify',
      );
    },
  );

  it('rejects valid aggregate evidence from another scenario on POST and GET', async () => {
    const data = semesterAllocationRun({ ...scope, year: 2027 });
    get.mockResolvedValue({ data: { success: true, data } });
    post.mockResolvedValue({ data: { success: true, data } });
    await expect(createSemesterAllocationRun(input)).rejects.toThrow('Could not verify');
    await expect(getSemesterAllocationRun(semesterAllocationRun().id, scope)).rejects.toThrow(
      'Could not verify',
    );
  });

  it('rejects a valid same-scope historical run that does not match the receipt ID', async () => {
    get.mockResolvedValue({
      data: { success: true, data: { ...semesterAllocationRun(), id: otherId } },
    });
    await expect(getSemesterAllocationRun(semesterAllocationRun().id, scope)).rejects.toThrow(
      'Could not verify',
    );
  });

  it.each([{ success: false, data: semesterAllocationRun() }, { success: true }])(
    'rejects unconfirmed response envelopes %#',
    async (data) => {
      get.mockResolvedValue({ data });
      post.mockResolvedValue({ data });
      await expect(createSemesterAllocationRun(input)).rejects.toThrow('Could not verify');
      await expect(getSemesterAllocationRun(semesterAllocationRun().id, scope)).rejects.toThrow(
        'Could not verify',
      );
    },
  );

  it('propagates a lost response and conflict without automatically issuing another request', async () => {
    const lost = new Error('Response lost');
    const conflict = { isAxiosError: true, response: { status: 409, data: { error: 'private' } } };
    post.mockRejectedValue(lost);
    get.mockRejectedValue(conflict);
    await expect(createSemesterAllocationRun(input)).rejects.toBe(lost);
    await expect(getSemesterAllocationRun(semesterAllocationRun().id, scope)).rejects.toBe(
      conflict,
    );
    expect(post).toHaveBeenCalledExactlyOnceWith('/admin/semester-allocation-runs', input);
    expect(get).toHaveBeenCalledTimes(1);
    expect(input.requestId).toBe(requestId);
  });
});
