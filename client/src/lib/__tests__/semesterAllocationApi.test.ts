import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  semesterAllocationPreview,
  semesterAllocationScope,
} from '@/test/fixtures/semesterAllocationPreview';
import apiClient from '../api';
import { getSemesterAllocationPreview } from '../semesterAllocationApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ data: { success: true, data: semesterAllocationPreview() } });
});

describe('semester allocation preview API adapter', () => {
  it('reads the normalized scenario without saving a run or changing academic plans', async () => {
    expect(
      await getSemesterAllocationPreview({
        ...semesterAllocationScope,
        curriculumId: semesterAllocationScope.curriculumId.toUpperCase(),
      }),
    ).toEqual(semesterAllocationPreview());
    expect(get).toHaveBeenCalledExactlyOnceWith('/admin/semester-allocation-preview', {
      params: semesterAllocationScope,
    });
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it.each([
    { success: false },
    { success: true, data: { ...semesterAllocationPreview(), persisted: true } },
    {
      success: true,
      data: {
        ...semesterAllocationPreview(),
        result: { ...semesterAllocationPreview().result, students: [{ studentId: 'private' }] },
      },
    },
    {
      success: true,
      data: {
        ...semesterAllocationPreview(),
        result: {
          ...semesterAllocationPreview().result,
          totalAssignedCredits: semesterAllocationPreview().result.totalAssignedCredits + 1,
        },
      },
    },
  ])('rejects an unsuccessful, private or inconsistent reply %#', async (data) => {
    get.mockResolvedValue({ data });
    await expect(getSemesterAllocationPreview(semesterAllocationScope)).rejects.toThrow(
      'Could not verify',
    );
  });

  it.each([
    { ...semesterAllocationScope, semester: 'SPRING' as const },
    { ...semesterAllocationScope, year: 2027 },
    { ...semesterAllocationScope, curriculumId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
  ])('rejects a valid aggregate from a different scenario %#', async (scope) => {
    get.mockResolvedValue({ data: { success: true, data: semesterAllocationPreview(scope) } });
    await expect(getSemesterAllocationPreview(semesterAllocationScope)).rejects.toThrow(
      'Could not verify',
    );
  });

  it('keeps absent resource settings unknown instead of inventing zero capacity', async () => {
    get.mockResolvedValue({
      data: { success: true, data: semesterAllocationPreview(semesterAllocationScope, null) },
    });
    const result = await getSemesterAllocationPreview(semesterAllocationScope);
    expect(result.result.envelope.resources).toBeNull();
    expect(result.result.envelope.envelope).toBeNull();
    expect(result.result.stopReasonCounts.RESOURCE_UNKNOWN).toBeGreaterThan(0);
  });

  it('rejects an invalid request before sending it', async () => {
    await expect(
      getSemesterAllocationPreview({ ...semesterAllocationScope, year: 1999 }),
    ).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });

  it('preserves HTTP failures so the panel can choose the correct recovery', async () => {
    const error = new Error('Offline');
    get.mockRejectedValue(error);
    await expect(getSemesterAllocationPreview(semesterAllocationScope)).rejects.toBe(error);
  });
});
