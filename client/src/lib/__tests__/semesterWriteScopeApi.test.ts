import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateSemesterDTO } from '@iu-study-planner/shared';
import apiClient, { addSemesterToPlan, updateSemester } from '../api';

const planId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const semesterId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const userId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const curriculumId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const courseId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const otherId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const create: CreateSemesterDTO = {
  semester: 'FALL',
  year: 2027,
  courses: [
    { courseId: otherId, position: 7 },
    { courseId, position: -1 },
  ],
};
const envelope = { success: true, data: { id: semesterId } };
const spyPost = () => vi.spyOn(apiClient, 'post');
const spyPut = () => vi.spyOn(apiClient, 'put');
let post: ReturnType<typeof spyPost>;
let put: ReturnType<typeof spyPut>;
beforeEach(() => {
  post = spyPost().mockResolvedValue({ data: envelope });
  put = spyPut().mockResolvedValue({ data: envelope });
});
afterEach(() => vi.restoreAllMocks());

const writers = [
  { name: 'create', write: (body: CreateSemesterDTO) => addSemesterToPlan(planId, body) },
  { name: 'update', write: (body: CreateSemesterDTO) => updateSemester(planId, semesterId, body) },
];

describe('saved semester scope adapters', () => {
  it('preserves legacy creation fields, list order and integer positions through the cookie client', async () => {
    expect(await addSemesterToPlan(planId, create)).toEqual(envelope);
    expect(post).toHaveBeenCalledExactlyOnceWith(`/study-plans/${planId}/semesters`, create);
    expect(apiClient.defaults.withCredentials).toBe(true);
  });

  it('preserves scope-less metadata-only updates without inventing a course list', async () => {
    expect(await updateSemester(planId, semesterId, { year: 2028 })).toEqual(envelope);
    expect(put).toHaveBeenCalledExactlyOnceWith(`/study-plans/${planId}/semesters/${semesterId}`, {
      year: 2028,
    });
  });

  it.each([curriculumId, null])(
    'normalizes expected scope and course UUIDs in creation for context %s',
    async (context) => {
      const input = {
        ...create,
        courses: create.courses.map((entry) => ({
          ...entry,
          courseId: entry.courseId.toUpperCase(),
        })),
        expectedScope: {
          userId: userId.toUpperCase(),
          curriculumId: context?.toUpperCase() ?? null,
        },
      };
      expect(await addSemesterToPlan(planId, input)).toEqual(envelope);
      expect(post).toHaveBeenCalledExactlyOnceWith(`/study-plans/${planId}/semesters`, {
        ...create,
        expectedScope: { userId, curriculumId: context },
      });
    },
  );

  it('normalizes a metadata-only update scope without changing the saved selection', async () => {
    await updateSemester(planId, semesterId, {
      year: 2029,
      expectedScope: { userId: userId.toUpperCase(), curriculumId: curriculumId.toUpperCase() },
    });
    expect(put).toHaveBeenCalledExactlyOnceWith(`/study-plans/${planId}/semesters/${semesterId}`, {
      year: 2029,
      expectedScope: { userId, curriculumId },
    });
  });

  it('preserves an explicit empty course list together with a null-context precondition', async () => {
    await updateSemester(planId, semesterId, {
      courses: [],
      expectedScope: { userId, curriculumId: null },
    });
    expect(put).toHaveBeenCalledExactlyOnceWith(`/study-plans/${planId}/semesters/${semesterId}`, {
      courses: [],
      expectedScope: { userId, curriculumId: null },
    });
  });

  describe.each(writers)('$name validation', ({ write }) => {
    it.each([
      null,
      {},
      { userId },
      { userId: 'student-id', curriculumId },
      { userId, curriculumId: 'CS' },
      { userId, curriculumId, role: 'ADMIN' },
      { userId, curriculumId, assignment: 'CS' },
    ])('rejects malformed or expanded scope %j before HTTP', async (expectedScope) => {
      await expect(write({ ...create, expectedScope } as CreateSemesterDTO)).rejects.toThrow();
      expect(post).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
    });

    it.each([
      { ...create, curriculumId },
      { ...create, courses: [{ courseId, position: 0, credits: 100 }] },
      {
        ...create,
        courses: [
          { courseId, position: 0 },
          { courseId: courseId.toUpperCase(), position: 1 },
        ],
      },
    ])(
      'rejects extra assignment/course fields and equivalent duplicate courses %j',
      async (body) => {
        await expect(write(body)).rejects.toThrow();
        expect(post).not.toHaveBeenCalled();
        expect(put).not.toHaveBeenCalled();
      },
    );
  });

  it.each([
    {},
    { expectedScope: { userId, curriculumId } },
    { year: undefined, expectedScope: { userId, curriculumId } },
  ])('rejects updates without an actual changed field %j before HTTP', async (body) => {
    await expect(updateSemester(planId, semesterId, body)).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });

  it('propagates a creation failure without retrying the write', async () => {
    post.mockRejectedValueOnce(new Error('offline'));
    await expect(addSemesterToPlan(planId, create)).rejects.toThrow('offline');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('propagates an update failure without retrying the write', async () => {
    put.mockRejectedValueOnce(new Error('offline'));
    await expect(updateSemester(planId, semesterId, { courses: create.courses })).rejects.toThrow(
      'offline',
    );
    expect(put).toHaveBeenCalledTimes(1);
  });
});
