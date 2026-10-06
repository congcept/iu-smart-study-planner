import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AllocationJobHistoryDTO,
  AllocationJobOutcomeDTO,
  ListAllocationJobsDTO,
  ResourceScopeDTO,
} from '@iu-study-planner/shared';
import apiClient from '../api';
import { listAllocationJobs } from '../allocationJobsApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const curriculumId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const otherId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const scope: ResourceScopeDTO = { curriculumId, semester: 'FALL', year: 2026 };
const id = (index: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, '0')}`;
const job = (index: number, scenario = scope): AllocationJobOutcomeDTO => ({
  jobId: id(index),
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  executionModel: 'ATOMIC_SINGLE_JOB',
  scope: scenario,
  queuedAt: '2026-10-06T01:00:00.000Z',
  status: 'PENDING',
  runId: null,
  completedAt: null,
  failureCode: null,
});
const history = (length = 2, scenario = scope): AllocationJobHistoryDTO => ({
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  scope: scenario,
  order: 'QUEUED_NEWEST_FIRST',
  pageSize: 20,
  jobs: Array.from({ length }, (_, index) => job(length - index, scenario)),
  nextAfter: null,
});
const respond = (data: unknown) => get.mockResolvedValue({ data: { success: true, data } });

beforeEach(() => {
  vi.resetAllMocks();
  respond(history());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('bounded scenario request history browser adapter', () => {
  it('reads one exact scoped page without enqueuing or executing requests', async () => {
    expect(await listAllocationJobs(scope)).toEqual(history());
    expect(get).toHaveBeenCalledExactlyOnceWith('/admin/allocation-jobs', { params: scope });
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('accepts an empty page without manufacturing a request or continuation', async () => {
    respond(history(0));
    expect(await listAllocationJobs(scope)).toEqual(history(0));
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('accepts a full page of mixed snapshot outcomes with an exact last-row continuation', async () => {
    const page = history(20);
    page.nextAfter = page.jobs.at(-1)!.jobId;
    page.jobs[0] = {
      ...page.jobs[0],
      status: 'SUCCEEDED',
      runId: otherId,
      completedAt: '2026-10-06T01:00:01.000Z',
    };
    page.jobs[1] = {
      ...page.jobs[1],
      status: 'FAILED',
      failureCode: 'PREVIEW_UNAVAILABLE',
      completedAt: '2026-10-06T01:00:02.000Z',
    };
    respond(page);
    expect(await listAllocationJobs(scope)).toEqual(page);
  });

  it('normalizes the requested scope and cursor plus response identities before comparison', async () => {
    const upperScope = { ...scope, curriculumId: curriculumId.toUpperCase() };
    const page = history(20, upperScope);
    page.jobs = page.jobs.map((row) => ({ ...row, jobId: row.jobId.toUpperCase() }));
    page.nextAfter = page.jobs.at(-1)!.jobId;
    respond(page);
    const expected = history(20);
    expected.nextAfter = id(1);
    expect(await listAllocationJobs({ ...upperScope, after: otherId.toUpperCase() })).toEqual(
      expected,
    );
    expect(get).toHaveBeenCalledExactlyOnceWith('/admin/allocation-jobs', {
      params: { ...scope, after: otherId },
    });
  });

  it.each([
    { curriculumId: `${curriculumId}\n` },
    { curriculumId: 'CS' },
    { year: '2026' },
    { year: 1999 },
    { year: 2026.5 },
    { semester: 'WINTER' },
    { after: '' },
    { after: `${otherId}\n` },
    { after: null },
    { limit: 100 },
    { createdById: otherId },
    { requestId: otherId },
  ])('rejects malformed scope/cursor or overriding input %# before HTTP', async (fields) => {
    await expect(
      listAllocationJobs({ ...scope, ...fields } as ListAllocationJobsDTO),
    ).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it.each([{ curriculumId: otherId }, { semester: 'SPRING' as const }, { year: 2027 }])(
    'rejects a valid response for another selected scenario %#',
    async (fields) => {
      respond(history(2, { ...scope, ...fields }));
      await expect(listAllocationJobs(scope)).rejects.toThrow('Could not verify');
    },
  );

  it.each([
    'order',
    'duplicate',
    'cap',
    'partialCursor',
    'wrongCursor',
    'privatePage',
    'privateRow',
  ] as const)('rejects %s page metadata atomically', async (fault) => {
    const page = history(2);
    const data =
      fault === 'order'
        ? { ...page, jobs: [...page.jobs].reverse() }
        : fault === 'duplicate'
          ? {
              ...page,
              jobs: [page.jobs[0], { ...page.jobs[0], jobId: page.jobs[0].jobId.toUpperCase() }],
            }
          : fault === 'cap'
            ? history(21)
            : fault === 'partialCursor'
              ? { ...page, nextAfter: page.jobs.at(-1)!.jobId }
              : fault === 'wrongCursor'
                ? { ...history(20), nextAfter: otherId }
                : fault === 'privatePage'
                  ? { ...page, createdById: otherId, requestId: otherId }
                  : { ...page, jobs: [{ ...page.jobs[0], studentIds: [otherId] }] };
    respond(data);
    await expect(listAllocationJobs(scope)).rejects.toThrow('Could not verify');
    expect(get).toHaveBeenCalledTimes(1);
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'RUNNING' },
    { runId: otherId },
    { completedAt: '2026-10-06T01:00:01.000Z' },
    { failureCode: 'SQL_ERROR' },
    { executionModel: 'DAEMON' },
  ])('rejects inconsistent/unsupported snapshot outcomes %#', async (fields) => {
    respond({ ...history(1), jobs: [{ ...job(1), ...fields }] });
    await expect(listAllocationJobs(scope)).rejects.toThrow('Could not verify');
  });

  it('rejects a same-scope continuation page that repeats its selected cursor row', async () => {
    await expect(listAllocationJobs({ ...scope, after: id(2).toUpperCase() })).rejects.toThrow(
      'Could not verify',
    );
    expect(get).toHaveBeenCalledExactlyOnceWith('/admin/allocation-jobs', {
      params: { ...scope, after: id(2) },
    });
  });

  it.each([
    null,
    {},
    { success: false, data: history() },
    { success: 'true', data: history() },
    { success: true, data: null },
  ])('requires a complete successful envelope %#', async (envelope) => {
    get.mockResolvedValue({ data: envelope });
    await expect(listAllocationJobs(scope)).rejects.toThrow('Could not verify');
  });

  it.each([401, 403, 409, 500])(
    'propagates HTTP %i without fallback, retry or execution',
    async (status) => {
      const failure = Object.assign(new Error('history unavailable'), { response: { status } });
      get.mockRejectedValue(failure);
      await expect(listAllocationJobs({ ...scope, after: otherId })).rejects.toBe(failure);
      expect(get).toHaveBeenCalledExactlyOnceWith('/admin/allocation-jobs', {
        params: { ...scope, after: otherId },
      });
      expect(apiClient.post).not.toHaveBeenCalled();
    },
  );

  it('preserves browser recovery data on successful history reads and lost responses', async () => {
    const saved = new Map([
      ['pending_resource_save:owner', 'preserved resource recovery'],
      ['allocation_job_request:owner:scope', 'preserved queue recovery'],
    ]);
    const before = [...saved];
    const setItem = vi.fn((key: string, value: string) => saved.set(key, value));
    const removeItem = vi.fn((key: string) => saved.delete(key));
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn((key: string) => saved.get(key) ?? null),
      setItem,
      removeItem,
    });
    await listAllocationJobs(scope);
    const failure = new Error('response lost');
    get.mockRejectedValueOnce(failure);
    await expect(listAllocationJobs({ ...scope, after: otherId })).rejects.toBe(failure);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect([...saved]).toEqual(before);
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(2);
  });
});
