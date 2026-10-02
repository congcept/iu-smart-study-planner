import { create } from 'zustand';
import type { AppState } from '../types';
import { playCompleteSound, playUncompleteSound, playPlanSound, playUnplanSound } from './sounds';

const STORAGE_KEY = 'completed_courses';
const PLAN_KEY = 'planned_courses';

type StoredCompletion = Record<string, string | null>;

const storageKey = (key: string, userId: string | null) => (userId ? `${key}:${userId}` : key);

const loadCompletedIds = (userId: string | null = null): StoredCompletion => {
  try {
    const stored = localStorage.getItem(storageKey(STORAGE_KEY, userId));
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      const result: StoredCompletion = {};
      parsed.forEach((id: string) => { result[id] = null; });
      return result;
    }
    return parsed;
  } catch {
    return {};
  }
};

const saveCompletedIds = (record: StoredCompletion, userId: string | null) => {
  localStorage.setItem(storageKey(STORAGE_KEY, userId), JSON.stringify(record));
};

const loadPlannedIds = (userId: string | null = null): string[] => {
  try {
    const stored = localStorage.getItem(storageKey(PLAN_KEY, userId));
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const savePlannedIds = (ids: string[], userId: string | null) => {
  localStorage.setItem(storageKey(PLAN_KEY, userId), JSON.stringify(ids));
};

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  courses: [],
  studentRecords: [],
  studyPlans: [],
  activePlan: null,
  isLoading: false,
  error: null,
  completionVersion: 0,
  progressOwnerId: null,
  pendingCompletionIds: new Set(),
  completedIds: loadCompletedIds(),
  plannedIds: loadPlannedIds(),

  setUser: (user) => set({ user }),
  setCourses: (courses) => set({ courses }),
  setStudentRecords: (records) => set({ studentRecords: records }),
  setStudyPlans: (plans) => set({ studyPlans: plans }),
  setActivePlan: (plan) => set({ activePlan: plan }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  setProgressOwner: (userId) => {
    set((state) =>
      state.progressOwnerId === userId
        ? state
        : {
            progressOwnerId: userId,
            completedIds: loadCompletedIds(userId),
            plannedIds: loadPlannedIds(userId),
            completionVersion: state.completionVersion + 1,
          },
    );
  },

  toggleCourseComplete: (courseId, electiveGroup = null) => {
    set((state) => {
      const wasCompleted = state.completedIds[courseId] !== undefined;
      const record = { ...state.completedIds };
      if (wasCompleted) {
        delete record[courseId];
        playUncompleteSound();
      } else {
        record[courseId] = electiveGroup;
        playCompleteSound();
      }
      saveCompletedIds(record, state.progressOwnerId);
      return { completedIds: record, completionVersion: state.completionVersion + 1 };
    });
  },

  toggleCoursePlanned: (courseId) => {
    set((state) => {
      const wasPlanned = state.plannedIds.includes(courseId);
      const ids = new Set(state.plannedIds);
      if (wasPlanned) {
        ids.delete(courseId);
        playUnplanSound();
      } else {
        ids.add(courseId);
        playPlanSound();
      }
      const arr = Array.from(ids);
      savePlannedIds(arr, state.progressOwnerId);
      return { plannedIds: arr };
    });
  },

  completeToPlanned: (courseId) => {
    set((state) => {
      const completedIds = { ...state.completedIds };
      delete completedIds[courseId];
      saveCompletedIds(completedIds, state.progressOwnerId);
      playUncompleteSound();

      const plannedIds = new Set(state.plannedIds);
      plannedIds.add(courseId);
      const plannedArr = Array.from(plannedIds);
      savePlannedIds(plannedArr, state.progressOwnerId);

      return { completedIds, plannedIds: plannedArr, completionVersion: state.completionVersion + 1 };
    });
  },

  completedCourseIds: () => {
    return Object.keys(get().completedIds);
  },

  availableCourses: () => {
    const { courses } = get();
    const completedIds = get().completedCourseIds();

    return courses.filter((course) => {
      if (completedIds.includes(course.id)) return false;
      return course.prerequisites.every((p) => completedIds.includes(p.prerequisiteId));
    });
  },

  progress: () => {
    const completedIds = get().completedCourseIds();
    const completed = completedIds.length;
    const total = get().courses.length;
    return {
      total,
      completed,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  },
}));
