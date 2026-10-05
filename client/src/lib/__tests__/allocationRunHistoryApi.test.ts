import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListAllocationRunsDTO } from '@iu-study-planner/shared';
import { allocationHistory } from '@/test/fixtures/allocationRun';
import { allocationScope } from '@/test/fixtures/allocationPreview';
import apiClient from '../api';
import { listAllocationRuns } from '../allocationRunsApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const otherId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ data: { success: true, data: allocationHistory() } });
});

describe('scenario simulation history adapter', () => {
  it('reads a bounded page without writing a capture', async () => {
    expect(await listAllocationRuns(allocationScope)).toEqual(allocationHistory());
    expect(get).toHaveBeenCalledExactlyOnceWith('/admin/allocation-runs', {
      params: allocationScope,
    });
    expect(apiClient.post).not.toHaveBeenCalled();
  });
  it('normalizes the requested scenario and cursor before GET', async () => {
    await listAllocationRuns({
      ...allocationScope,
      curriculumId: allocationScope.curriculumId.toUpperCase(),
      after: otherId.toUpperCase(),
    });
    expect(get).toHaveBeenLastCalledWith('/admin/allocation-runs', {
      params: { ...allocationScope, after: otherId },
    });
  });
  it.each([{ after: 'bad' }, { limit: 100 }, { year: '2026' }, { semester: 'WINTER' }])(
    'rejects invalid query input before GET %#',
    async (fields) => {
      await expect(
        listAllocationRuns({ ...allocationScope, ...fields } as ListAllocationRunsDTO),
      ).rejects.toThrow();
      expect(get).not.toHaveBeenCalled();
    },
  );
  it.each([{ curriculumId: otherId }, { semester: 'SPRING' as const }, { year: 2027 }])(
    'rejects a valid page for a different scenario %#',
    async (fields) => {
      get.mockResolvedValue({
        data: { success: true, data: allocationHistory({ ...allocationScope, ...fields }) },
      });
      await expect(listAllocationRuns(allocationScope)).rejects.toThrow('Could not verify');
    },
  );
  it('rejects a repeated cursor row', async () => {
    const page = allocationHistory();
    await expect(
      listAllocationRuns({ ...allocationScope, after: page.runs[0].id }),
    ).rejects.toThrow('Could not verify');
  });
  it('accepts a full verified page with a continuation', async () => {
    const page = allocationHistory(allocationScope, 20, true);
    get.mockResolvedValue({ data: { success: true, data: page } });
    expect(await listAllocationRuns(allocationScope)).toEqual(page);
  });
  it.each(['private', 'corrupt', 'order', 'cursor', 'duplicate'] as const)(
    'rejects %s page data atomically',
    async (fault) => {
      const page = allocationHistory(allocationScope, 2);
      const data =
        fault === 'private'
          ? { ...page, actorId: otherId }
          : fault === 'corrupt'
            ? { ...page, runs: [{ ...page.runs[0], formatVersion: 2 }] }
            : fault === 'order'
              ? { ...page, runs: [...page.runs].reverse() }
              : fault === 'cursor'
                ? { ...page, nextAfter: page.runs[1].id }
                : { ...page, runs: [page.runs[0], page.runs[0]] };
      get.mockResolvedValue({ data: { success: true, data } });
      await expect(listAllocationRuns(allocationScope)).rejects.toThrow('Could not verify');
    },
  );
  it('propagates HTTP failure without retrying or writing', async () => {
    const failure = new Error('History read failed');
    get.mockRejectedValue(failure);
    await expect(listAllocationRuns(allocationScope)).rejects.toBe(failure);
    expect(get).toHaveBeenCalledTimes(1);
    expect(apiClient.post).not.toHaveBeenCalled();
  });
  it('requires a successful envelope', async () => {
    get.mockResolvedValue({ data: { success: false, data: allocationHistory() } });
    await expect(listAllocationRuns(allocationScope)).rejects.toThrow('Could not verify');
  });
});
