import { create } from 'zustand';
import type { AppState } from '../types';

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  courses: [],
  studentRecords: [],
  studyPlans: [],
  activePlan: null,
  isLoading: false,
  error: null,

  setUser: (user) => set({ user }),
  setCourses: (courses) => set({ courses }),
  setStudentRecords: (records) => set({ studentRecords: records }),
  setStudyPlans: (plans) => set({ studyPlans: plans }),
  setActivePlan: (plan) => set({ activePlan: plan }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  completedCourseIds: () => {
    const { studentRecords } = get();
    return studentRecords
      .filter(r => r.status === 'COMPLETED')
      .map(r => r.courseId);
  },

  availableCourses: () => {
    const { courses, studentRecords } = get();
    const completedIds = new Set(
      studentRecords
        .filter(r => r.status === 'COMPLETED')
        .map(r => r.courseId)
    );

    return courses.filter(course => {
      if (completedIds.has(course.id)) return false;
      return course.prerequisites.every(
        p => completedIds.has(p.prerequisiteId)
      );
    });
  },

  progress: () => {
    const { studentRecords, courses } = get();
    const completed = studentRecords.filter(r => r.status === 'COMPLETED').length;
    const total = courses.length;
    return {
      total,
      completed,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  },
}));
