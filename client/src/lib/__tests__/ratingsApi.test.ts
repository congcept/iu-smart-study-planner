import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RateCourseDTO } from '@iu-study-planner/shared';
import apiClient from '../api';
import { getOwnRatings, rateCourse } from '../ratingsApi';
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const id = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
beforeEach(() => vi.clearAllMocks());
describe('ratings adapter', () => {
  it('reads votes only through the current-account cookie path', async () => {
    get.mockResolvedValue({ data: { success: true, data: [] } });
    expect(await getOwnRatings()).toEqual([]);
    expect(get).toHaveBeenCalledWith('/users/me/ratings');
  });
  it('normalizes course IDs and submits only the validated rating', async () => {
    post.mockResolvedValue({ data: { success: true, data: { yourRating: 1 } } });
    expect(await rateCourse(id, { rating: 1 })).toEqual({ yourRating: 1 });
    expect(post).toHaveBeenCalledWith(`/courses/${id.toLowerCase()}/rate`, { rating: 1 });
  });
  it.each(['BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB', null])(
    'normalizes the optional expected owner and curriculum %s without adding assignment fields',
    async (curriculumId) => {
      const userId = 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC';
      post.mockResolvedValue({ data: { success: true, data: { yourRating: 4 } } });
      expect(await rateCourse(id, { rating: 4, expectedScope: { userId, curriculumId } })).toEqual({
        yourRating: 4,
      });
      expect(post).toHaveBeenCalledExactlyOnceWith(`/courses/${id.toLowerCase()}/rate`, {
        rating: 4,
        expectedScope: {
          userId: userId.toLowerCase(),
          curriculumId: curriculumId?.toLowerCase() ?? null,
        },
      });
    },
  );
  it.each([
    null,
    'unknown',
    {},
    { userId: id },
    { userId: 'other-user', curriculumId: null },
    { userId: id, curriculumId: 'CS' },
    { userId: id, curriculumId: null, role: 'ADMIN' },
    { userId: id, curriculumId: null, isGpaPath: true },
    { userId: id, curriculumId: null, assignment: 'CS' },
  ])('rejects malformed or expanded expected scope %j before writing', async (expectedScope) => {
    await expect(rateCourse(id, { rating: 3, expectedScope } as RateCourseDTO)).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
  it.each([
    { rating: 3, userId: id },
    { rating: 3, curriculumId: id },
    { rating: 3, assignment: { curriculumId: id } },
    { rating: 3, expectedScope: { userId: id, curriculumId: null }, role: 'ADMIN' },
  ])('rejects unknown owner and assignment fields %j before writing', async (input) => {
    await expect(rateCourse(id, input)).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
  it.each([0, 6, 2.5, NaN])('rejects invalid difficulty %s before writing', async (rating) => {
    await expect(rateCourse(id, { rating })).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
  it('rejects invalid IDs before writing', async () => {
    await expect(rateCourse('bad', { rating: 3 })).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
  it('does not treat a failed envelope as saved votes', async () => {
    get.mockResolvedValue({ data: { success: false, error: 'Unavailable' } });
    await expect(getOwnRatings()).rejects.toThrow('Unavailable');
  });
});
