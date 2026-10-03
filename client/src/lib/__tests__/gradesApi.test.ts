import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentGradesDTO } from '@iu-study-planner/shared';
import apiClient from '../api';
import { appendStudentGrade, getStudentGradeCourses, getStudentGrades } from '../gradesApi';
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const data: StudentGradesDTO = {
  attempts: [],
  summary: {
    gpa100: null,
    gpaPath: null,
    gradedCredits: 0,
    gradedCourseCount: 0,
    courseScores: [],
  },
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
  const scope = {
    userId: '11111111-1111-4111-8111-111111111111',
    curriculumId: '22222222-2222-4222-8222-222222222222',
    isGpaPath: false,
  };
  const options = {
    scope,
    courses: [{ id: input.courseId.toLowerCase(), code: 'MA001IU', name: 'Calculus 1' }],
  };
  it('reads cookie-account course choices without owner/context query overrides', async () => {
    get.mockResolvedValue({ data: { success: true, data: options } });
    expect(await getStudentGradeCourses(scope.userId)).toEqual(options);
    expect(get).toHaveBeenCalledWith('/users/me/grades/courses');
  });
  it('accepts empty contextual choices without a global catalog fallback', async () => {
    get.mockResolvedValue({ data: { success: true, data: { scope, courses: [] } } });
    expect(await getStudentGradeCourses(scope.userId)).toEqual({ scope, courses: [] });
  });
  it.each([
    { ...options, scope: { ...scope, userId: '33333333-3333-4333-8333-333333333333' } },
    { courses: options.courses },
    { ...options, courses: [...options.courses, options.courses[0]] },
    { ...options, courses: [{ ...options.courses[0], category: 'REQUIRED' }] },
    { ...options, courses: [{ ...options.courses[0], id: 'unknown' }] },
    { ...options, courses: [{ ...options.courses[0], name: '' }] },
  ])('rejects ambiguous, legacy or other-account choice responses %j', async (options) => {
    get.mockResolvedValue({ data: { success: true, data: options } });
    await expect(getStudentGradeCourses(scope.userId)).rejects.toThrow(/verify/);
  });
  it('preserves a nonfork numeric GPA and current context on read and append', async () => {
    const scoped = {
      ...data,
      scope,
      summary: { ...data.summary, gpa100: 90, gradedCredits: 3, gradedCourseCount: 1 },
    };
    get.mockResolvedValue({ data: { success: true, data: scoped } });
    post.mockResolvedValue({ data: { success: true, data: scoped } });
    expect(await getStudentGrades()).toEqual(scoped);
    expect(await appendStudentGrade(input)).toEqual(scoped);
    expect(post).toHaveBeenCalledWith('/users/me/grades', {
      ...input,
      courseId: input.courseId.toLowerCase(),
      requestId: input.requestId.toLowerCase(),
    });
  });
  it.each([
    null,
    { ...scope, userId: 'other-user' },
    { ...scope, curriculumId: 'CS' },
    { ...scope, isGpaPath: 'false' },
    { ...scope, curriculumId: null, isGpaPath: false },
    { ...scope, role: 'ADMIN' },
  ])('rejects malformed scope %j instead of treating it as legacy metadata', async (scope) => {
    get.mockResolvedValue({ data: { success: true, data: { ...data, scope } } });
    await expect(getStudentGrades()).rejects.toThrow(/scope/);
  });
  it('rejects a thesis eligibility claim for a nonfork context', async () => {
    post.mockResolvedValue({
      data: {
        success: true,
        data: { ...data, scope, summary: { ...data.summary, gpaPath: 'THESIS' } },
      },
    });
    await expect(appendStudentGrade(input)).rejects.toThrow(/scope/);
  });
  it('retains explicit null context and the legacy fork policy', async () => {
    const scoped = { ...data, scope: { ...scope, curriculumId: null, isGpaPath: true } };
    get.mockResolvedValue({ data: { success: true, data: scoped } });
    expect(await getStudentGrades()).toEqual(scoped);
  });
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
