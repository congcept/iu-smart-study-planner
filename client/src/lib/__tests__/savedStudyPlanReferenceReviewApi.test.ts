import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerId, referenceId, referenceSession } from '@/test/fixtures/curriculumReference';
import { savedPlanId, savedSemesterId } from '@/test/fixtures/savedStudyPlanCourses';
import { referenceReviewFixture } from '@/test/fixtures/savedSemesterReferenceReview';
import apiClient, { getSession } from '../api';
import { reviewSavedStudyPlanSemester } from '../savedStudyPlanReferenceReviewApi';
import { SavedStudyPlanCoursesSessionChangedError } from '../savedStudyPlanCoursesApi';

vi.mock('../api', () => ({
  default: { post: vi.fn(), put: vi.fn(), get: vi.fn() },
  getSession: vi.fn(),
}));
const post = vi.mocked(apiClient.post);
const session = vi.mocked(getSession);
const read = (year = 2, semester = 1, signal?: AbortSignal) =>
  reviewSavedStudyPlanSemester(
    ownerId,
    savedPlanId,
    savedSemesterId,
    referenceId,
    year,
    semester,
    signal,
  );
beforeEach(() => {
  vi.resetAllMocks();
  session.mockResolvedValue(referenceSession(referenceId));
  post.mockResolvedValue({ data: { success: true, data: referenceReviewFixture() } });
});
describe('saved semester reference review adapter', () => {
  it.each(['before', 'after'] as const)(
    'invalidates evidence when session confirmation fails %s transport',
    async (phase) => {
      if (phase === 'after') session.mockResolvedValueOnce(referenceSession(referenceId));
      session.mockRejectedValue(new Error('session unavailable'));
      await expect(read()).rejects.toBeInstanceOf(SavedStudyPlanCoursesSessionChangedError);
      expect(post).toHaveBeenCalledTimes(phase === 'before' ? 0 : 1);
    },
  );

  it('binds an explicit slot and live scope to one read-only review request', async () => {
    expect(await read()).toEqual(referenceReviewFixture());
    expect(post).toHaveBeenCalledExactlyOnceWith(
      `/users/me/study-plans/${savedPlanId}/semesters/${savedSemesterId}/reference-review`,
      {
        expectedScope: { userId: ownerId, curriculumId: referenceId },
        academicYear: 2,
        academicSemester: 1,
      },
      { signal: undefined },
    );
    expect(session).toHaveBeenCalledTimes(2);
    expect(apiClient.put).not.toHaveBeenCalled();
  });
  it.each([
    [0, 1],
    [1, 0],
    [1, 4],
    [1.5, 1],
    [Number.MAX_SAFE_INTEGER + 1, 1],
  ])('rejects invalid slot %s:%s before transport', async (year, semester) => {
    await expect(read(year, semester)).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
  it.each(['owner', 'context', 'plan', 'semester', 'slot'] as const)(
    'rejects a mismatched returned %s',
    async (kind) => {
      const result = referenceReviewFixture();
      if (kind === 'owner') result.snapshot.scope.userId = savedPlanId;
      if (kind === 'context') result.snapshot.scope.curriculumId = savedPlanId;
      if (kind === 'plan') result.snapshot.plan.id = referenceId;
      if (kind === 'semester') result.snapshot.semester.id = referenceId;
      if (kind === 'slot') result.referenceSlot.academicYear = 3;
      post.mockResolvedValue({ data: { success: true, data: result } });
      await expect(read()).rejects.toThrow('does not match');
    },
  );
  it.each(['before', 'after'] as const)('checks a changed context %s transport', async (phase) => {
    if (phase === 'after') session.mockResolvedValueOnce(referenceSession(referenceId));
    session.mockResolvedValue(referenceSession(null));
    await expect(read()).rejects.toBeInstanceOf(SavedStudyPlanCoursesSessionChangedError);
    expect(post).toHaveBeenCalledTimes(phase === 'before' ? 0 : 1);
  });
  it('rechecks a failed response before exposing the error', async () => {
    session
      .mockResolvedValueOnce(referenceSession(referenceId))
      .mockResolvedValueOnce({ ...referenceSession(referenceId), id: savedPlanId });
    post.mockRejectedValue(new Error('transport detail'));
    await expect(read()).rejects.toBeInstanceOf(SavedStudyPlanCoursesSessionChangedError);
  });
  it('preserves same-account transport errors for recovery', async () => {
    const error = new Error('offline');
    post.mockRejectedValue(error);
    await expect(read()).rejects.toBe(error);
    expect(session).toHaveBeenCalledTimes(2);
  });
  it('rejects forged save permission and inconsistent course ordering', async () => {
    const result = referenceReviewFixture();
    post.mockResolvedValue({
      data: {
        success: true,
        data: { ...result, validation: { ...result.validation, savingEnabled: true } },
      },
    });
    await expect(read()).rejects.toThrow();
    if (result.review.status === 'ASSESSED') result.review.entries[0].courseId = referenceId;
    post.mockResolvedValue({ data: { success: true, data: result } });
    await expect(read()).rejects.toThrow();
  });
  it('cancels before sending a review when preflight was aborted', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof getSession>>) => void;
    session.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const controller = new AbortController();
    const pending = read(2, 1, controller.signal);
    controller.abort();
    resolve(referenceSession(referenceId));
    await expect(pending).rejects.toThrow('cancelled');
    expect(post).not.toHaveBeenCalled();
  });
});
