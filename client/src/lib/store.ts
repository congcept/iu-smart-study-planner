import { create } from 'zustand';
import type { AppState } from '../types';

const STORAGE_KEY = 'completed_courses';
const PLAN_KEY = 'planned_courses';

const loadCompletedIds = (): string[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const saveCompletedIds = (ids: string[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
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

  toggleCourseComplete: (courseId) => {
    set((state) => {
      const ids = new Set(state.completedIds);
      if (ids.has(courseId)) {
        ids.delete(courseId);
      } else {
        ids.add(courseId);
      }
      const arr = Array.from(ids);
      saveCompletedIds(arr);
      return { completedIds: arr, completionVersion: state.completionVersion + 1 };
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
      const completedIds = new Set(state.completedIds);
      completedIds.delete(courseId);
      const completedArr = Array.from(completedIds);
      saveCompletedIds(completedArr);

      const plannedIds = new Set(state.plannedIds);
      plannedIds.add(courseId);
      const plannedArr = Array.from(plannedIds);
      savePlannedIds(plannedArr);

      return { completedIds: completedArr, plannedIds: plannedArr, completionVersion: state.completionVersion + 1 };
    });
  },

  completedCourseIds: () => {
    return get().completedIds;
  },

  availableCourses: () => {
    const { courses } = get();
    const completedIds = new Set(get().completedCourseIds());

    return courses.filter((course) => {
      if (completedIds.has(course.id)) return false;
      return course.prerequisites.every((p) => completedIds.has(p.prerequisiteId));
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
