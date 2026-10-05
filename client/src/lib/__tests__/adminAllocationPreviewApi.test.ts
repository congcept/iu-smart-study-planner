import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allocationPreview, allocationScope } from '@/test/fixtures/allocationPreview';
import apiClient from '../api';
import { getAllocationPreview } from '../adminResourcesApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ data: { success: true, data: allocationPreview() } });
});

describe('allocation preview runtime API adapter', () => {
  it('reads one normalized scenario without resource/progress writes', async () => {
    expect(
      await getAllocationPreview({
        ...allocationScope,
        curriculumId: allocationScope.curriculumId.toUpperCase(),
      }),
    ).toEqual(allocationPreview());
    expect(get).toHaveBeenCalledExactlyOnceWith('/admin/allocation-preview', {
      params: allocationScope,
    });
    expect(apiClient.post).not.toHaveBeenCalled();
  });
  it.each([
    { success: false },
    { success: true },
    { success: true, data: null },
    { success: true, data: { ...allocationPreview(), studentId: 'private' } },
    { success: true, data: { ...allocationPreview(), assignedStudentCount: 2 } },
    { success: true, data: { ...allocationPreview(), persisted: true } },
  ])('rejects unverified/private or corrupt replies %#', async (data) => {
    get.mockResolvedValue({ data });
    await expect(getAllocationPreview(allocationScope)).rejects.toThrow('Could not verify');
  });
  it.each([
    { ...allocationScope, semester: 'SPRING' as const },
    { ...allocationScope, year: 2027 },
    { ...allocationScope, curriculumId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
  ])('rejects an otherwise valid wrong scenario %#', async (scope) => {
    get.mockResolvedValue({ data: { success: true, data: allocationPreview(scope) } });
    await expect(getAllocationPreview(allocationScope)).rejects.toThrow('Could not verify');
  });
  it('preserves missing resources as unknown instead of zero capacity', async () => {
    get.mockResolvedValue({
      data: { success: true, data: allocationPreview(allocationScope, null) },
    });
    const result = await getAllocationPreview(allocationScope);
    expect(result.resourceUnknownStudentCount).toBe(2);
    expect(result.snapshot.resourceEnvelope.envelope).toBeNull();
  });
  it('rejects an invalid input without sending a request', async () => {
    await expect(getAllocationPreview({ ...allocationScope, year: 1999 })).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });
  it('propagates HTTP failures for panel recovery', async () => {
    const error = new Error('Offline');
    get.mockRejectedValue(error);
    await expect(getAllocationPreview(allocationScope)).rejects.toBe(error);
  });
});
