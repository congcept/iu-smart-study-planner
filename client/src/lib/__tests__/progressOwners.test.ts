import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getCurrentStudentProgress, saveCourseProgress } from '../api';
import { useAppStore } from '../store';

vi.mock('../api', () => ({
  getCurrentStudentProgress: vi.fn(),
  saveCourseProgress: vi.fn(),
}));

vi.mock('../sounds', () => ({
  playCompleteSound: vi.fn(),
  playUncompleteSound: vi.fn(),
  playPlanSound: vi.fn(),
  playUnplanSound: vi.fn(),
}));

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
  const getProgress = vi.mocked(getCurrentStudentProgress);
  const saveProgress = vi.mocked(saveCourseProgress);
  getProgress.mockResolvedValueOnce({ completedIds: {}, plannedIds: [] });
  store.setProgressOwner('alice');
  await store.loadProgress();
  saveProgress.mockResolvedValueOnce({
    completedIds: { 'course-a': 'Group 2' },
    plannedIds: [],
    uncompletedCourseIds: [],
  });
  await store.toggleCourseComplete('course-a', 'Group 2');
  saveProgress.mockResolvedValueOnce({
    completedIds: { 'course-a': 'Group 2' },
    plannedIds: ['course-b'],
    uncompletedCourseIds: [],
  });
  await store.toggleCoursePlanned('course-b');
  store.setProgressOwner('bob');
  expect(useAppStore.getState().completedIds).toEqual({});
  expect(useAppStore.getState().plannedIds).toEqual([]);
  getProgress.mockResolvedValueOnce({ completedIds: {}, plannedIds: [] });
  await store.loadProgress();
  saveProgress.mockResolvedValueOnce({
    completedIds: { 'course-c': null },
    plannedIds: [],
    uncompletedCourseIds: [],
  });
  await store.toggleCourseComplete('course-c');
  store.setProgressOwner('alice');
  expect(useAppStore.getState().completedIds).toEqual({ 'course-a': 'Group 2' });
  expect(useAppStore.getState().plannedIds).toEqual(['course-b']);
  getProgress.mockResolvedValueOnce({
    completedIds: { 'course-a': 'Group 2' },
    plannedIds: ['course-b'],
  });
  await store.loadProgress();
  saveProgress.mockResolvedValueOnce({
    completedIds: {},
    plannedIds: ['course-b', 'course-a'],
    uncompletedCourseIds: [],
  });
  await store.completeToPlanned('course-a');
  store.setProgressOwner('bob');
  expect(useAppStore.getState().completedIds).toEqual({ 'course-c': null });
  store.setProgressOwner(null);
  expect(useAppStore.getState().completedIds).toEqual({ guestCourse: null });
  await store.toggleCoursePlanned('guest-plan');
  expect(getProgress).toHaveBeenCalledTimes(3);
  expect(saveProgress).toHaveBeenCalledTimes(4);
  expect(JSON.parse(localStorage.getItem('completed_courses')!)).toEqual({ guestCourse: null });
  expect(JSON.parse(localStorage.getItem('planned_courses')!)).toEqual(['guest-plan']);
  store.setProgressOwner('alice');
  expect(useAppStore.getState().completedIds).toEqual({});
  expect(useAppStore.getState().plannedIds).toEqual(['course-b', 'course-a']);
  expect(useAppStore.getState().plannedIds).not.toContain('guest-plan');
});
