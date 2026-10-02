import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppStore } from '../store';

vi.mock('../sounds', () => ({
  playCompleteSound: vi.fn(),
  playUncompleteSound: vi.fn(),
  playPlanSound: vi.fn(),
  playUnplanSound: vi.fn(),
}));

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  useAppStore.setState({ progressOwnerId: null, completedIds: {}, plannedIds: [] });
});
afterEach(() => vi.unstubAllGlobals());

it('keeps two students and guest progress separate, preserving elective claims and plans', () => {
  localStorage.setItem('completed_courses', JSON.stringify({ guestCourse: null }));
  const store = useAppStore.getState();
  store.setProgressOwner('alice');
  store.toggleCourseComplete('course-a', 'Group 2');
  store.toggleCoursePlanned('course-b');
  store.setProgressOwner('bob');
  expect(useAppStore.getState().completedIds).toEqual({});
  expect(useAppStore.getState().plannedIds).toEqual([]);
  store.toggleCourseComplete('course-c');
  store.setProgressOwner('alice');
  expect(useAppStore.getState().completedIds).toEqual({ 'course-a': 'Group 2' });
  expect(useAppStore.getState().plannedIds).toEqual(['course-b']);
  store.completeToPlanned('course-a');
  store.setProgressOwner('bob');
  expect(useAppStore.getState().completedIds).toEqual({ 'course-c': null });
  store.setProgressOwner(null);
  expect(useAppStore.getState().completedIds).toEqual({ guestCourse: null });
  store.setProgressOwner('alice');
  expect(useAppStore.getState().completedIds).toEqual({});
  expect(useAppStore.getState().plannedIds).toEqual(['course-b', 'course-a']);
});
