import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AllocationJobDTO,
  AllocationJobOutcomeDTO,
  CreateAllocationJobDTO,
  ExecuteAllocationJobDTO,
  ResourceScopeDTO,
} from '@iu-study-planner/shared';
import apiClient from '../api';
import {
  enqueueAllocationJob,
  executeAllocationJob,
  getAllocationJob,
  getAllocationJobOutcome,
} from '../allocationJobsApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const curriculumId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const requestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const jobId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const scope: ResourceScopeDTO = { curriculumId, semester: 'FALL', year: 2026 };
const input: CreateAllocationJobDTO = { ...scope, requestId, expectedActorId: actorId };
const executionInput: ExecuteAllocationJobDTO = { ...scope, expectedActorId: actorId };
const queued = (scenario = scope): AllocationJobDTO => ({
  id: jobId,
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  scope: scenario,
  status: 'QUEUED',
  queuedAt: '2026-10-05T08:00:00.000Z',
  inputsCaptured: false,
});
const outcome = (
  scenario = scope,
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' = 'PENDING',
): AllocationJobOutcomeDTO => ({
  jobId,
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  executionModel: 'ATOMIC_SINGLE_JOB',
  scope: scenario,
  queuedAt: '2026-10-05T08:00:00.000Z',
  status,
  runId: status === 'SUCCEEDED' ? otherId : null,
  completedAt: status === 'PENDING' ? null : '2026-10-05T08:00:01.000Z',
  failureCode: status === 'FAILED' ? 'AUTHOR_UNAVAILABLE' : null,
});
const verificationError = 'Could not verify the simulation job. Retry to recover its saved state.';

beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ data: { success: true, data: queued() } });
  post.mockResolvedValue({ data: { success: true, data: queued() } });
});

describe('validated simulation allocation job browser adapters', () => {
  it('enqueues the supplied immutable retry key and actor precondition once', async () => {
    expect(await enqueueAllocationJob(input)).toEqual(queued());
    expect(post).toHaveBeenCalledExactlyOnceWith('/admin/allocation-jobs', input);
    expect(get).not.toHaveBeenCalled();
  });

  it('reads a selected queue receipt without query parameters or a request body', async () => {
    expect(await getAllocationJob(jobId, scope)).toEqual(queued());
    expect(get).toHaveBeenCalledExactlyOnceWith(`/admin/allocation-jobs/${jobId}`);
    expect(post).not.toHaveBeenCalled();
  });

  it('reads a selected outcome without query parameters, writes or execution', async () => {
    get.mockResolvedValue({ data: { success: true, data: outcome() } });
    expect(await getAllocationJobOutcome(jobId, scope)).toEqual(outcome());
    expect(get).toHaveBeenCalledExactlyOnceWith(`/admin/allocation-jobs/${jobId}/outcome`);
    expect(post).not.toHaveBeenCalled();
  });

  it('executes only the selected job once with a timeout covering the bounded worker', async () => {
    const result = { processed: true, outcome: outcome(scope, 'SUCCEEDED') };
    post.mockResolvedValue({ data: { success: true, data: result } });
    expect(await executeAllocationJob(jobId, executionInput)).toEqual(result);
    expect(post).toHaveBeenCalledExactlyOnceWith(
      `/admin/allocation-jobs/${jobId}/execute`,
      executionInput,
      { timeout: 20_000 },
    );
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    ['PENDING', false],
    ['SUCCEEDED', false],
    ['SUCCEEDED', true],
    ['FAILED', false],
    ['FAILED', true],
  ] as const)(
    'accepts a verified %s execution reply with processed=%s',
    async (status, processed) => {
      const result = { processed, outcome: outcome(scope, status) };
      post.mockResolvedValue({ data: { success: true, data: result } });
      expect(await executeAllocationJob(jobId, executionInput)).toEqual(result);
      expect(post).toHaveBeenCalledTimes(1);
    },
  );

  it('normalizes outgoing and returned job, actor, request, curriculum and run UUIDs', async () => {
    const upperScope = { ...scope, curriculumId: curriculumId.toUpperCase() };
    const upperQueued = { ...queued(upperScope), id: jobId.toUpperCase() };
    const upperOutcome = {
      ...outcome(upperScope, 'SUCCEEDED'),
      jobId: jobId.toUpperCase(),
      runId: otherId.toUpperCase(),
    };
    post.mockResolvedValueOnce({ data: { success: true, data: upperQueued } });
    post.mockResolvedValueOnce({
      data: { success: true, data: { processed: true, outcome: upperOutcome } },
    });
    get.mockResolvedValueOnce({ data: { success: true, data: upperQueued } });
    get.mockResolvedValueOnce({ data: { success: true, data: upperOutcome } });
    expect(
      await enqueueAllocationJob({
        ...input,
        ...upperScope,
        requestId: requestId.toUpperCase(),
        expectedActorId: actorId.toUpperCase(),
      }),
    ).toEqual(queued());
    expect(await getAllocationJob(jobId.toUpperCase(), upperScope)).toEqual(queued());
    expect(await getAllocationJobOutcome(jobId.toUpperCase(), upperScope)).toEqual(
      outcome(scope, 'SUCCEEDED'),
    );
    expect(
      await executeAllocationJob(jobId.toUpperCase(), {
        ...executionInput,
        ...upperScope,
        expectedActorId: actorId.toUpperCase(),
      }),
    ).toEqual({ processed: true, outcome: outcome(scope, 'SUCCEEDED') });
    expect(post).toHaveBeenNthCalledWith(1, '/admin/allocation-jobs', input);
    expect(post).toHaveBeenNthCalledWith(
      2,
      `/admin/allocation-jobs/${jobId}/execute`,
      executionInput,
      { timeout: 20_000 },
    );
    expect(get).toHaveBeenNthCalledWith(1, `/admin/allocation-jobs/${jobId}`);
    expect(get).toHaveBeenNthCalledWith(2, `/admin/allocation-jobs/${jobId}/outcome`);
  });

  it.each([
    { expectedActorId: undefined },
    { expectedActorId: null },
    { expectedActorId: 'ADMIN' },
    { expectedActorId: `${actorId}\n` },
    { requestId: undefined },
    { requestId: 'retry' },
    { requestId: `${requestId}\n` },
    { curriculumId: 'CS' },
    { year: '2026' },
    { semester: 'WINTER' },
    { actorId },
    { status: 'QUEUED' },
    { result: {} },
  ])('rejects invalid or expanded enqueue input %# before HTTP', async (fields) => {
    await expect(
      enqueueAllocationJob({ ...input, ...fields } as CreateAllocationJobDTO),
    ).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    { expectedActorId: undefined },
    { expectedActorId: null },
    { expectedActorId: 'ADMIN' },
    { expectedActorId: `${actorId}\n` },
    { requestId },
    { jobId },
    { runId: otherId },
    { policy: {} },
    { students: [] },
  ])('rejects invalid or uploaded execute input %# before HTTP', async (fields) => {
    await expect(
      executeAllocationJob(jobId, { ...executionInput, ...fields } as ExecuteAllocationJobDTO),
    ).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it.each(['', 'job', `${jobId}\n`, `${jobId} `, null, undefined])(
    'rejects malformed selected ID %j before any read or execution',
    async (id) => {
      await expect(getAllocationJob(id as string, scope)).rejects.toThrow();
      await expect(getAllocationJobOutcome(id as string, scope)).rejects.toThrow();
      await expect(executeAllocationJob(id as string, executionInput)).rejects.toThrow();
      expect(post).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    },
  );

  it.each([
    { curriculumId: 'CS' },
    { curriculumId: `${curriculumId}\n` },
    { year: 1999 },
    { year: 2101 },
    { year: 2026.5 },
    { year: '2026' },
    { semester: 'WINTER' },
    { actorId },
  ])('rejects malformed or expanded read scope %# before HTTP', async (fields) => {
    const invalid = { ...scope, ...fields } as ResourceScopeDTO;
    await expect(getAllocationJob(jobId, invalid)).rejects.toThrow();
    await expect(getAllocationJobOutcome(jobId, invalid)).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });

  it.each([{ curriculumId: otherId }, { semester: 'SPRING' as const }, { year: 2027 }])(
    'rejects valid but different scenario responses %# on all four boundaries',
    async (fields) => {
      const different = { ...scope, ...fields };
      post.mockResolvedValueOnce({ data: { success: true, data: queued(different) } });
      post.mockResolvedValueOnce({
        data: { success: true, data: { processed: false, outcome: outcome(different) } },
      });
      get.mockResolvedValueOnce({ data: { success: true, data: queued(different) } });
      get.mockResolvedValueOnce({ data: { success: true, data: outcome(different) } });
      await expect(enqueueAllocationJob(input)).rejects.toThrow(verificationError);
      await expect(getAllocationJob(jobId, scope)).rejects.toThrow(verificationError);
      await expect(getAllocationJobOutcome(jobId, scope)).rejects.toThrow(verificationError);
      await expect(executeAllocationJob(jobId, executionInput)).rejects.toThrow(verificationError);
    },
  );

  it('rejects a valid same-scope response for another selected job on GET and execute', async () => {
    get.mockResolvedValueOnce({ data: { success: true, data: { ...queued(), id: otherId } } });
    get.mockResolvedValueOnce({ data: { success: true, data: { ...outcome(), jobId: otherId } } });
    post.mockResolvedValueOnce({
      data: {
        success: true,
        data: { processed: false, outcome: { ...outcome(), jobId: otherId } },
      },
    });
    await expect(getAllocationJob(jobId, scope)).rejects.toThrow(verificationError);
    await expect(getAllocationJobOutcome(jobId, scope)).rejects.toThrow(verificationError);
    await expect(executeAllocationJob(jobId, executionInput)).rejects.toThrow(verificationError);
  });

  it.each([
    { kind: 'ENROLLMENT' },
    { usage: 'VALIDATED' },
    { queuedAt: 'yesterday' },
    { createdById: actorId },
    { requestId },
    { actorId },
    { studentIds: [actorId] },
    { result: {} },
  ])('rejects malformed or private shared reply fields %#', async (fields) => {
    post.mockResolvedValueOnce({ data: { success: true, data: { ...queued(), ...fields } } });
    post.mockResolvedValueOnce({
      data: { success: true, data: { processed: false, outcome: { ...outcome(), ...fields } } },
    });
    get.mockResolvedValueOnce({ data: { success: true, data: { ...queued(), ...fields } } });
    get.mockResolvedValueOnce({ data: { success: true, data: { ...outcome(), ...fields } } });
    await expect(enqueueAllocationJob(input)).rejects.toThrow(verificationError);
    await expect(getAllocationJob(jobId, scope)).rejects.toThrow(verificationError);
    await expect(getAllocationJobOutcome(jobId, scope)).rejects.toThrow(verificationError);
    await expect(executeAllocationJob(jobId, executionInput)).rejects.toThrow(verificationError);
  });

  it.each([{ status: 'RUNNING' }, { inputsCaptured: true }, { id: `${jobId}\n` }])(
    'rejects unsupported receipt metadata %# on POST and GET',
    async (fields) => {
      const data = { ...queued(), ...fields };
      get.mockResolvedValue({ data: { success: true, data } });
      post.mockResolvedValue({ data: { success: true, data } });
      await expect(enqueueAllocationJob(input)).rejects.toThrow(verificationError);
      await expect(getAllocationJob(jobId, scope)).rejects.toThrow(verificationError);
    },
  );

  it.each([
    { status: 'RUNNING' },
    { runId: otherId },
    { failureCode: 'AUTHOR_UNAVAILABLE' },
    { completedAt: '2026-10-05T08:00:01.000Z' },
    { inputsCaptured: false },
    { executionModel: 'LEASED_WORKER' },
  ])('rejects inconsistent or expanded pending outcome metadata %#', async (fields) => {
    const data = { ...outcome(), ...fields };
    get.mockResolvedValue({ data: { success: true, data } });
    post.mockResolvedValue({ data: { success: true, data: { processed: false, outcome: data } } });
    await expect(getAllocationJobOutcome(jobId, scope)).rejects.toThrow(verificationError);
    await expect(executeAllocationJob(jobId, executionInput)).rejects.toThrow(verificationError);
  });

  it.each([
    { processed: true },
    { processed: 'false' },
    { processed: undefined },
    { ownerId: actorId },
    { requestId },
  ])('rejects unsupported execution reply metadata %#', async (fields) => {
    post.mockResolvedValue({
      data: { success: true, data: { processed: false, outcome: outcome(), ...fields } },
    });
    await expect(executeAllocationJob(jobId, executionInput)).rejects.toThrow(verificationError);
  });

  it.each([
    null,
    {},
    { success: true },
    { success: false, data: queued() },
    { success: 'true', data: queued() },
    { success: true, data: null },
  ])('rejects incomplete or unsuccessful envelopes %#', async (envelope) => {
    get.mockResolvedValue({ data: envelope });
    post.mockResolvedValue({ data: envelope });
    await expect(enqueueAllocationJob(input)).rejects.toThrow(verificationError);
    await expect(getAllocationJob(jobId, scope)).rejects.toThrow(verificationError);
    await expect(getAllocationJobOutcome(jobId, scope)).rejects.toThrow(verificationError);
    await expect(executeAllocationJob(jobId, executionInput)).rejects.toThrow(verificationError);
  });

  it.each([401, 403, 404, 409, 500])(
    'propagates HTTP %i without automatic retries or fallback reads',
    async (status) => {
      const failure = Object.assign(new Error('server rejected request'), { response: { status } });
      get.mockRejectedValue(failure);
      post.mockRejectedValue(failure);
      await expect(enqueueAllocationJob(input)).rejects.toBe(failure);
      await expect(getAllocationJob(jobId, scope)).rejects.toBe(failure);
      await expect(getAllocationJobOutcome(jobId, scope)).rejects.toBe(failure);
      await expect(executeAllocationJob(jobId, executionInput)).rejects.toBe(failure);
      expect(post).toHaveBeenCalledTimes(2);
      expect(get).toHaveBeenCalledTimes(2);
    },
  );

  it('preserves the supplied retry/job identities after an uncertain response', async () => {
    const failure = new Error('response lost');
    post.mockRejectedValue(failure);
    await expect(enqueueAllocationJob(input)).rejects.toBe(failure);
    await expect(executeAllocationJob(jobId, executionInput)).rejects.toBe(failure);
    expect(input.requestId).toBe(requestId);
    expect(post).toHaveBeenCalledTimes(2);
    expect(get).not.toHaveBeenCalled();
  });
});
