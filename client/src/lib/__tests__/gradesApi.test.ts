import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentGradesDTO } from '@iu-study-planner/shared';
import apiClient from '../api';
import { appendStudentGrade, getStudentGrades } from '../gradesApi';
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const data: StudentGradesDTO = {
  attempts: [],
  summary: { gpa100: null, gradedCredits: 0, gradedCourseCount: 0, courseScores: [] },
  completedCoursesWithoutNumericGrades: [],
};
const input = {
  courseId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
  requestId: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
  score: 0,
};
beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { success: true, data } });
  post.mockResolvedValue({ data: { success: true, data } });
});
describe('grade API adapter', () => {
  it('reads only current-account grades through the cookie API client', async () => {
    expect(await getStudentGrades()).toEqual(data);
    expect(get).toHaveBeenCalledWith('/users/me/grades');
  });
  it('normalizes UUIDs and preserves the retry key and zero score', async () => {
    expect(await appendStudentGrade(input)).toEqual(data);
    expect(post).toHaveBeenCalledWith('/users/me/grades', {
      ...input,
      courseId: input.courseId.toLowerCase(),
      requestId: input.requestId.toLowerCase(),
    });
  });
  it('rejects invalid numeric scores before posting', async () => {
    await expect(appendStudentGrade({ ...input, score: 101 })).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
  it('rejects failed envelopes', async () => {
    get.mockResolvedValue({ data: { success: false, error: 'Session unavailable' } });
    await expect(getStudentGrades()).rejects.toThrow('Session unavailable');
  });
  it('does not turn a network failure into successful grades', async () => {
    post.mockRejectedValue(new Error('Network failed'));
    await expect(appendStudentGrade(input)).rejects.toThrow('Network failed');
  });
});
