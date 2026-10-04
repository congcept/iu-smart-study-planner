import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api';
import { getRatingCourseChoices } from '../ratingsApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const curriculumId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const courseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const historicalId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const current = {
  id: courseId,
  code: 'MA001IU',
  name: 'Calculus 1',
  avgRating: 4.25,
  ratingCount: 4,
  ratingDifficulty: 3.5,
  ratingPriorMean: 3,
  ratingPriorSource: 'CURRICULUM_RATINGS',
  yourRating: 5,
  membership: 'CURRENT_CURRICULUM',
};
const historical = {
  ...current,
  id: historicalId,
  code: 'IT001IU',
  name: 'Historical course',
  avgRating: null,
  ratingCount: 0,
  yourRating: null,
  ratingPriorSource: 'GLOBAL_SEED',
  membership: 'OTHER_HISTORY',
};
const data = { scope: { userId, curriculumId }, courses: [current, historical] };
beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ data: { success: true, data } });
});

describe('rating course choices API', () => {
  it('reads only the cookie-account choices without scope overrides or filtering history', async () => {
    expect(await getRatingCourseChoices(userId)).toEqual(data);
    expect(get).toHaveBeenCalledExactlyOnceWith('/users/me/ratings/courses');
  });

  it('normalizes UUID identities and preserves metadata, votes and course ordering', async () => {
    get.mockResolvedValue({
      data: {
        success: true,
        data: {
          scope: { userId: userId.toUpperCase(), curriculumId: curriculumId.toUpperCase() },
          courses: data.courses.map((course) => ({ ...course, id: course.id.toUpperCase() })),
        },
      },
    });
    expect(await getRatingCourseChoices(userId.toUpperCase())).toEqual(data);
  });

  it.each([null, curriculumId])('accepts explicit empty choices in context %s', async (context) => {
    const empty = { scope: { userId, curriculumId: context }, courses: [] };
    get.mockResolvedValue({ data: { success: true, data: empty } });
    expect(await getRatingCourseChoices(userId)).toEqual(empty);
  });

  it.each(['GLOBAL_RATINGS', 'GLOBAL_SEED'])(
    'accepts unassigned metadata with the %s prior',
    async (source) => {
      const unassigned = {
        scope: { userId, curriculumId: null },
        courses: [{ ...current, membership: 'UNASSIGNED', ratingPriorSource: source }],
      };
      get.mockResolvedValue({ data: { success: true, data: unassigned } });
      expect(await getRatingCourseChoices(userId)).toEqual(unassigned);
    },
  );

  it.each(['CURRICULUM_RATINGS', 'CURRICULUM_SEED'])(
    'accepts current membership with the %s prior',
    async (source) => {
      const scoped = { ...data, courses: [{ ...current, ratingPriorSource: source }] };
      get.mockResolvedValue({ data: { success: true, data: scoped } });
      expect(await getRatingCourseChoices(userId)).toEqual(scoped);
    },
  );

  it.each(['GLOBAL_RATINGS', 'GLOBAL_SEED'])(
    'accepts other history with the %s prior',
    async (source) => {
      const scoped = { ...data, courses: [{ ...historical, ratingPriorSource: source }] };
      get.mockResolvedValue({ data: { success: true, data: scoped } });
      expect(await getRatingCourseChoices(userId)).toEqual(scoped);
    },
  );

  it.each([
    null,
    data.courses,
    { courses: data.courses },
    { ...data, scope: null },
    { ...data, scope: { userId } },
    { ...data, scope: { userId: historicalId, curriculumId } },
    { ...data, scope: { userId: 'student-id', curriculumId } },
    { ...data, scope: { userId, curriculumId: 'CS' } },
    { ...data, scope: { ...data.scope, role: 'ADMIN' } },
    { ...data, scope: { ...data.scope, isGpaPath: false } },
    { ...data, expectedScope: data.scope },
    { ...data, courses: {} },
    { ...data, courses: [current, current] },
    { ...data, courses: [current, { ...historical, id: courseId.toUpperCase() }] },
    { ...data, courses: [current, { ...historical, code: current.code }] },
  ])('rejects legacy, duplicate, wrong-owner or expanded snapshots %j', async (snapshot) => {
    get.mockResolvedValue({ data: { success: true, data: snapshot } });
    await expect(getRatingCourseChoices(userId)).rejects.toThrow(/verify/);
  });

  it.each([
    { id: 'unknown' },
    { code: '' },
    { name: '' },
    { avgRating: 0 },
    { avgRating: 6 },
    { avgRating: '4' },
    { avgRating: null },
    { ratingCount: 0 },
    { ratingCount: -1 },
    { ratingCount: 1.5 },
    { ratingCount: Number.MAX_SAFE_INTEGER + 1 },
    { ratingCount: '4' },
    { ratingDifficulty: 0 },
    { ratingDifficulty: 6 },
    { ratingDifficulty: null },
    { ratingPriorMean: 0 },
    { ratingPriorMean: 6 },
    { ratingPriorMean: null },
    { ratingPriorSource: 'UNKNOWN' },
    { yourRating: 0 },
    { yourRating: 6 },
    { yourRating: 2.5 },
    { yourRating: '5' },
    { membership: 'UNKNOWN' },
    { prerequisites: [] },
    { credits: 3 },
    { userId },
  ])('rejects malformed or nonminimal course metadata %j', async (overrides) => {
    get.mockResolvedValue({
      data: { success: true, data: { ...data, courses: [{ ...current, ...overrides }] } },
    });
    await expect(getRatingCourseChoices(userId)).rejects.toThrow(/verify/);
  });

  it('rejects a saved personal vote when there are no aggregate votes', async () => {
    get.mockResolvedValue({
      data: { success: true, data: { ...data, courses: [{ ...historical, yourRating: 4 }] } },
    });
    await expect(getRatingCourseChoices(userId)).rejects.toThrow(/verify/);
  });

  it.each([
    { context: null, membership: 'CURRENT_CURRICULUM', source: 'GLOBAL_RATINGS' },
    { context: null, membership: 'OTHER_HISTORY', source: 'GLOBAL_SEED' },
    { context: null, membership: 'UNASSIGNED', source: 'CURRICULUM_RATINGS' },
    { context: null, membership: 'UNASSIGNED', source: 'CURRICULUM_SEED' },
    { context: curriculumId, membership: 'UNASSIGNED', source: 'GLOBAL_RATINGS' },
    { context: curriculumId, membership: 'CURRENT_CURRICULUM', source: 'GLOBAL_RATINGS' },
    { context: curriculumId, membership: 'CURRENT_CURRICULUM', source: 'GLOBAL_SEED' },
    { context: curriculumId, membership: 'OTHER_HISTORY', source: 'CURRICULUM_RATINGS' },
    { context: curriculumId, membership: 'OTHER_HISTORY', source: 'CURRICULUM_SEED' },
  ])('rejects membership and prior scope mismatch %j', async ({ context, membership, source }) => {
    get.mockResolvedValue({
      data: {
        success: true,
        data: {
          scope: { userId, curriculumId: context },
          courses: [{ ...current, membership, ratingPriorSource: source }],
        },
      },
    });
    await expect(getRatingCourseChoices(userId)).rejects.toThrow(/verify/);
  });

  it('rejects an invalid expected owner before requesting private choices', async () => {
    await expect(getRatingCourseChoices('student-id')).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });

  it.each([{ success: false, data }, { success: true }, { success: true, data: undefined }])(
    'rejects an unsuccessful or incomplete envelope %j',
    async (envelope) => {
      get.mockResolvedValue({ data: envelope });
      await expect(getRatingCourseChoices(userId)).rejects.toThrow(/verify/);
    },
  );

  it('propagates a network failure instead of substituting empty choices', async () => {
    get.mockRejectedValue(new Error('offline'));
    await expect(getRatingCourseChoices(userId)).rejects.toThrow('offline');
  });
});
