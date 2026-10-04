import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api';
import { getScopedOwnRatings } from '../ratingsApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const curriculumId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const courseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const historicalId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const data = {
  scope: { userId, curriculumId },
  ratings: [
    { courseId, rating: 5 },
    { courseId: historicalId, rating: 1 },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ data: { success: true, data } });
});

describe('scoped own ratings API', () => {
  it('requests only the cookie-account snapshot and retains all global vote history', async () => {
    expect(await getScopedOwnRatings(userId)).toEqual(data);
    expect(get).toHaveBeenCalledExactlyOnceWith('/users/me/ratings/snapshot');
  });

  it('normalizes response and expected UUIDs while preserving vote values and order', async () => {
    get.mockResolvedValue({
      data: {
        success: true,
        data: {
          scope: { userId: userId.toUpperCase(), curriculumId: curriculumId.toUpperCase() },
          ratings: data.ratings.map((rating) => ({
            ...rating,
            courseId: rating.courseId.toUpperCase(),
          })),
        },
      },
    });
    expect(await getScopedOwnRatings(userId.toUpperCase())).toEqual(data);
  });

  it.each([null, curriculumId])(
    'accepts an empty confirmed curriculum %s vote snapshot',
    async (context) => {
      const empty = { scope: { userId, curriculumId: context }, ratings: [] };
      get.mockResolvedValue({ data: { success: true, data: empty } });
      expect(await getScopedOwnRatings(userId)).toEqual(empty);
    },
  );

  it('retains historical votes for an explicit unassigned account', async () => {
    const unassigned = { ...data, scope: { userId, curriculumId: null } };
    get.mockResolvedValue({ data: { success: true, data: unassigned } });
    expect(await getScopedOwnRatings(userId)).toEqual(unassigned);
  });

  it.each([
    data.ratings,
    null,
    { ratings: data.ratings },
    { ...data, scope: null },
    { ...data, scope: { userId } },
    { ...data, scope: { userId: historicalId, curriculumId } },
    { ...data, scope: { userId: 'student-id', curriculumId } },
    { ...data, scope: { userId, curriculumId: 'CS' } },
    { ...data, scope: { ...data.scope, role: 'ADMIN' } },
    { ...data, scope: { ...data.scope, isGpaPath: true } },
    { ...data, ratings: undefined },
    { ...data, ratings: {} },
    { ...data, ratings: [{ courseId: 'unknown', rating: 3 }] },
    { ...data, ratings: [{ courseId, rating: 0 }] },
    { ...data, ratings: [{ courseId, rating: 6 }] },
    { ...data, ratings: [{ courseId, rating: 2.5 }] },
    { ...data, ratings: [{ courseId, rating: '3' }] },
    { ...data, ratings: [{ courseId, rating: 3, userId }] },
    { ...data, ratings: [{ courseId, rating: 3, curriculumId }] },
    { ...data, ratings: [data.ratings[0], data.ratings[0]] },
    { ...data, ratings: [data.ratings[0], { courseId: courseId.toUpperCase(), rating: 1 }] },
    { ...data, expectedScope: data.scope },
  ])('rejects legacy, wrong-owner, repeated or malformed vote snapshots %j', async (snapshot) => {
    get.mockResolvedValue({ data: { success: true, data: snapshot } });
    await expect(getScopedOwnRatings(userId)).rejects.toThrow(/verify/);
  });

  it('rejects an invalid expected owner before requesting private votes', async () => {
    await expect(getScopedOwnRatings('student-id')).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });

  it.each([{ success: false, data }, { success: true }, { success: true, data: undefined }])(
    'does not treat unsuccessful or incomplete envelopes %j as confirmed votes',
    async (envelope) => {
      get.mockResolvedValue({ data: envelope });
      await expect(getScopedOwnRatings(userId)).rejects.toThrow(/verify/);
    },
  );

  it('preserves a network failure without substituting an empty vote history', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    await expect(getScopedOwnRatings(userId)).rejects.toThrow('offline');
  });
});
