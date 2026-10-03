import { beforeEach, describe, expect, it, vi } from 'vitest';
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
