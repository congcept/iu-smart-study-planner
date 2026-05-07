import { create } from 'zustand';
import type { AppState } from '../types';
import { playCompleteSound, playUncompleteSound } from './sounds';

const STORAGE_KEY = 'completed_courses';
const PLAN_KEY = 'planned_courses';

type StoredCompletion = Record<string, string | null>;

const loadCompletedIds = (): StoredCompletion => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
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

const saveCompletedIds = (record: StoredCompletion) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
};

const loadPlannedIds = (): string[] => {
  try {
    const stored = localStorage.getItem(PLAN_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const savePlannedIds = (ids: string[]) => {
  localStorage.setItem(PLAN_KEY, JSON.stringify(ids));
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
      saveCompletedIds(record);
      return { completedIds: record, completionVersion: state.completionVersion + 1 };
    });
  },

  toggleCoursePlanned: (courseId) => {
    set((state) => {
      const ids = new Set(state.plannedIds);
      if (ids.has(courseId)) {
        ids.delete(courseId);
      } else {
        ids.add(courseId);
      }
      const arr = Array.from(ids);
      savePlannedIds(arr);
      return { plannedIds: arr };
    });
  },

  completeToPlanned: (courseId) => {
    set((state) => {
      const completedIds = { ...state.completedIds };
      delete completedIds[courseId];
      saveCompletedIds(completedIds);

      const plannedIds = new Set(state.plannedIds);
      plannedIds.add(courseId);
      const plannedArr = Array.from(plannedIds);
      savePlannedIds(plannedArr);

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
