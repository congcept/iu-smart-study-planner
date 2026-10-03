import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api';
import { getScopedStudentProgress } from '../scopedProgressApi';

vi.mock('../api', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const curriculumId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const courseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const plannedId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const data = {
  scope: { userId, curriculumId },
  progress: { completedIds: { [courseId]: '  Legacy claim  ' }, plannedIds: [plannedId] },
};
beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ data: { success: true, data } });
});

describe('scoped progress API', () => {
  it('reads the cookie snapshot without owner/context overrides and preserves claim evidence', async () => {
    expect(await getScopedStudentProgress(userId)).toEqual(data);
    expect(get).toHaveBeenCalledWith('/users/me/progress/snapshot');
  });

  it('normalizes UUID identities without changing claims', async () => {
    get.mockResolvedValue({
      data: {
        success: true,
        data: {
          scope: { userId: userId.toUpperCase(), curriculumId: curriculumId.toUpperCase() },
          progress: {
            completedIds: { [courseId.toUpperCase()]: data.progress.completedIds[courseId] },
            plannedIds: [plannedId.toUpperCase()],
          },
        },
      },
    });
    expect(await getScopedStudentProgress(userId.toUpperCase())).toEqual(data);
  });

  it('accepts explicit null and empty selections without implying assigned context', async () => {
    const empty = {
      scope: { userId, curriculumId: null },
      progress: { completedIds: {}, plannedIds: [] },
    };
    get.mockResolvedValue({ data: { success: true, data: empty } });
    expect(await getScopedStudentProgress(userId)).toEqual(empty);
  });

  it.each([
    { ...data, scope: { userId: plannedId, curriculumId } },
    { progress: data.progress },
    { ...data, scope: { userId } },
    { ...data, scope: { userId, curriculumId: 'CS' } },
    { ...data, scope: { ...data.scope, role: 'ADMIN' } },
    { ...data, progress: { ...data.progress, plannedIds: [plannedId, plannedId.toUpperCase()] } },
    {
      ...data,
      progress: {
        ...data.progress,
        completedIds: { [courseId]: null, [courseId.toUpperCase()]: 'Other claim' },
      },
    },
    { ...data, progress: { ...data.progress, plannedIds: [courseId.toUpperCase()] } },
    { ...data, progress: { ...data.progress, completedIds: { invalid: null } } },
    { ...data, progress: { ...data.progress, completedIds: { [courseId]: 4 } } },
    { ...data, progress: { ...data.progress, plannedIds: ['invalid'] } },
    { ...data, progress: { ...data.progress, expectedScope: data.scope } },
    { ...data, percentage: 100 },
    null,
  ])('rejects wrong-owner, ambiguous or malformed snapshots %j', async (snapshot) => {
    get.mockResolvedValue({ data: { success: true, data: snapshot } });
    await expect(getScopedStudentProgress(userId)).rejects.toThrow(/verify/);
  });

  it('rejects an invalid expected owner before requesting private progress', async () => {
    await expect(getScopedStudentProgress('student-id')).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });

  it('does not treat a failed envelope or network failure as a snapshot', async () => {
    get
      .mockResolvedValueOnce({ data: { success: false, data } })
      .mockRejectedValueOnce(new Error('offline'));
    await expect(getScopedStudentProgress(userId)).rejects.toThrow(/verify/);
    await expect(getScopedStudentProgress(userId)).rejects.toThrow('offline');
  });
});
