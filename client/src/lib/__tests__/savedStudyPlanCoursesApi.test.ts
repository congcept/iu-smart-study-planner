import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerId, referenceId, referenceSession } from '@/test/fixtures/curriculumReference';
import {
  savedCourseFixture,
  savedPlanId,
  savedSemesterId,
} from '@/test/fixtures/savedStudyPlanCourses';
import apiClient, { getSession } from '../api';
import {
  getSavedStudyPlanCourses,
  SavedStudyPlanCoursesSessionChangedError,
} from '../savedStudyPlanCoursesApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() }, getSession: vi.fn() }));
const get = vi.mocked(apiClient.get);
const session = vi.mocked(getSession);
const read = (signal?: AbortSignal) =>
  getSavedStudyPlanCourses(ownerId, savedPlanId, savedSemesterId, null, signal);
beforeEach(() => {
  vi.resetAllMocks();
  session.mockResolvedValue(referenceSession(null));
  get.mockResolvedValue({ data: { success: true, data: savedCourseFixture() } });
});
describe('saved course reference reads', () => {
  it('normalizes identifiers, verifies both sessions and issues only the selected read', async () => {
    expect(
      await getSavedStudyPlanCourses(
        ownerId.toUpperCase(),
        savedPlanId.toUpperCase(),
        savedSemesterId.toUpperCase(),
        null,
      ),
    ).toEqual(savedCourseFixture());
    expect(get).toHaveBeenCalledExactlyOnceWith(
      `/users/me/study-plans/${savedPlanId}/semesters/${savedSemesterId}/courses`,
      { signal: undefined },
    );
    expect(session).toHaveBeenCalledTimes(2);
    expect(apiClient.post).not.toHaveBeenCalled();
  });
  it.each(['owner', 'scope', 'plan', 'semester'] as const)(
    'rejects mismatched returned %s',
    async (kind) => {
      const value = savedCourseFixture();
      if (kind === 'owner') value.scope.userId = referenceId;
      if (kind === 'scope') value.scope.curriculumId = referenceId;
      if (kind === 'plan') value.plan.id = referenceId;
      if (kind === 'semester') value.semester.id = referenceId;
      get.mockResolvedValue({ data: { success: true, data: value } });
      await expect(read()).rejects.toThrow('do not match');
    },
  );
  it.each(['before', 'after'] as const)(
    'blocks changed curriculum %s the reference read',
    async (phase) => {
      if (phase === 'after') session.mockResolvedValueOnce(referenceSession(null));
      session.mockResolvedValue(referenceSession(referenceId));
      await expect(read()).rejects.toBeInstanceOf(SavedStudyPlanCoursesSessionChangedError);
      expect(get).toHaveBeenCalledTimes(phase === 'before' ? 0 : 1);
    },
  );
  it('rechecks a failed response before exposing its error', async () => {
    session
      .mockResolvedValueOnce(referenceSession(null))
      .mockResolvedValueOnce({ ...referenceSession(null), id: referenceId });
    get.mockRejectedValue(new Error('private transport detail'));
    await expect(read()).rejects.toBeInstanceOf(SavedStudyPlanCoursesSessionChangedError);
    expect(session).toHaveBeenCalledTimes(2);
  });
  it('preserves transport failure for the same confirmed account', async () => {
    const error = new Error('offline');
    get.mockRejectedValue(error);
    await expect(read()).rejects.toBe(error);
    expect(session).toHaveBeenCalledTimes(2);
  });
  it('accepts unavailable formats without inventing an empty course list', async () => {
    const value = savedCourseFixture({
      courseReferences: { status: 'UNAVAILABLE', reason: 'READER_LIMIT' },
    });
    get.mockResolvedValue({ data: { success: true, data: value } });
    expect((await read()).courseReferences).toEqual(value.courseReferences);
  });
  it('rejects extra private fields even when scope matches', async () => {
    get.mockResolvedValue({
      data: { success: true, data: { ...savedCourseFixture(), grade: 91 } },
    });
    await expect(read()).rejects.toThrow();
  });
  it('supports assigned context without validating the old plan', async () => {
    session.mockResolvedValue(referenceSession(referenceId));
    const value = savedCourseFixture();
    value.scope.curriculumId = referenceId;
    get.mockResolvedValue({ data: { success: true, data: value } });
    expect(
      await getSavedStudyPlanCourses(ownerId, savedPlanId, savedSemesterId, referenceId),
    ).toEqual(value);
  });
  it('does not issue a reference request when aborted during preflight', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof getSession>>) => void;
    session.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const controller = new AbortController();
    const pending = read(controller.signal);
    controller.abort();
    resolve(referenceSession(null));
    await expect(pending).rejects.toThrow('cancelled');
    expect(get).not.toHaveBeenCalled();
  });
});
