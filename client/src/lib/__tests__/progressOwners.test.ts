import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ScopedStudentProgressDTO, StudentProgressDTO } from '@iu-study-planner/shared';
import { saveCourseProgress } from '../api';
import { getScopedStudentProgress } from '../scopedProgressApi';
import { useAppStore } from '../store';

vi.mock('../api', () => ({
  saveCourseProgress: vi.fn(),
}));

vi.mock('../scopedProgressApi', () => ({ getScopedStudentProgress: vi.fn() }));
vi.mock('../sounds', () => ({
  playCompleteSound: vi.fn(),
  playUncompleteSound: vi.fn(),
  playPlanSound: vi.fn(),
  playUnplanSound: vi.fn(),
}));

function scoped(progress: StudentProgressDTO, userId = 'alice'): ScopedStudentProgressDTO {
  return { scope: { userId, curriculumId: null }, progress };
}

beforeEach(() => {
  vi.resetAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  useAppStore.getState().setProgressOwner(null);
  useAppStore.setState({
    progressOwnerId: null,
    progressScope: null,
    progressStatus: 'ready',
    progressError: null,
    browserProgressBackup: null,
    pendingCompletionIds: new Set(),
    completedIds: {},
    plannedIds: [],
  });
});
afterEach(() => vi.unstubAllGlobals());

it('keeps two students and guest progress separate, preserving elective claims and plans', async () => {
  localStorage.setItem('completed_courses', JSON.stringify({ guestCourse: null }));
  const store = useAppStore.getState();
  const getProgress = vi.mocked(getScopedStudentProgress);
  const saveProgress = vi.mocked(saveCourseProgress);
  getProgress.mockResolvedValueOnce(scoped({ completedIds: {}, plannedIds: [] }));
  store.setProgressOwner('alice');
  await store.loadProgress();
  saveProgress.mockResolvedValueOnce({
    completedIds: { 'course-a': 'Group 2' },
    plannedIds: [],
    uncompletedCourseIds: [],
  });
  getProgress.mockResolvedValueOnce(
    scoped({ completedIds: { 'course-a': 'Group 2' }, plannedIds: [] }),
  );
  await store.toggleCourseComplete('course-a', 'Group 2');
  saveProgress.mockResolvedValueOnce({
    completedIds: { 'course-a': 'Group 2' },
    plannedIds: ['course-b'],
    uncompletedCourseIds: [],
  });
  getProgress.mockResolvedValueOnce(
    scoped({ completedIds: { 'course-a': 'Group 2' }, plannedIds: ['course-b'] }),
  );
  await store.toggleCoursePlanned('course-b');
  store.setProgressOwner('bob');
  expect(useAppStore.getState().completedIds).toEqual({});
  expect(useAppStore.getState().plannedIds).toEqual([]);
  getProgress.mockResolvedValueOnce(scoped({ completedIds: {}, plannedIds: [] }, 'bob'));
  await store.loadProgress();
  saveProgress.mockResolvedValueOnce({
    completedIds: { 'course-c': null },
    plannedIds: [],
    uncompletedCourseIds: [],
  });
  getProgress.mockResolvedValueOnce(
    scoped({ completedIds: { 'course-c': null }, plannedIds: [] }, 'bob'),
  );
  await store.toggleCourseComplete('course-c');
  store.setProgressOwner('alice');
  expect(useAppStore.getState().completedIds).toEqual({ 'course-a': 'Group 2' });
  expect(useAppStore.getState().plannedIds).toEqual(['course-b']);
  getProgress.mockResolvedValueOnce(
    scoped({
      completedIds: { 'course-a': 'Group 2' },
      plannedIds: ['course-b'],
    }),
  );
  await store.loadProgress();
  saveProgress.mockResolvedValueOnce({
    completedIds: {},
    plannedIds: ['course-b', 'course-a'],
    uncompletedCourseIds: [],
  });
  getProgress.mockResolvedValueOnce(
    scoped({ completedIds: {}, plannedIds: ['course-b', 'course-a'] }),
  );
  await store.completeToPlanned('course-a');
  store.setProgressOwner('bob');
  expect(useAppStore.getState().completedIds).toEqual({ 'course-c': null });
  store.setProgressOwner(null);
  expect(useAppStore.getState().completedIds).toEqual({ guestCourse: null });
  await store.toggleCoursePlanned('guest-plan');
  expect(getProgress).toHaveBeenCalledTimes(7);
  expect(saveProgress).toHaveBeenCalledTimes(4);
  expect(JSON.parse(localStorage.getItem('completed_courses')!)).toEqual({ guestCourse: null });
  expect(JSON.parse(localStorage.getItem('planned_courses')!)).toEqual(['guest-plan']);
  store.setProgressOwner('alice');
  expect(useAppStore.getState().completedIds).toEqual({});
  expect(useAppStore.getState().plannedIds).toEqual(['course-b', 'course-a']);
  expect(useAppStore.getState().plannedIds).not.toContain('guest-plan');
});
