import { create } from 'zustand';
import { isAxiosError } from 'axios';
import type { ApiResponse, CompleteCourseDTO, StudentProgressDTO } from '@iu-study-planner/shared';
import type { AppState } from '../types';
import { getCurrentStudentProgress, saveCourseProgress } from './api';
import { playCompleteSound, playUncompleteSound, playPlanSound, playUnplanSound } from './sounds';

const STORAGE_KEY = 'completed_courses';
const PLAN_KEY = 'planned_courses';
let ownerVersion = 0;
let loadVersion = 0;

type StoredCompletion = Record<string, string | null>;

const storageKey = (key: string, userId: string | null) => (userId ? `${key}:${userId}` : key);

const loadCompletedIds = (userId: string | null = null): StoredCompletion => {
  try {
    const stored = localStorage.getItem(storageKey(STORAGE_KEY, userId));
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      const result: StoredCompletion = {};
      parsed.forEach((id: string) => {
        result[id] = null;
      });
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

function cacheProgress(progress: StudentProgressDTO, userId: string | null) {
  try {
    saveCompletedIds(progress.completedIds, userId);
    savePlannedIds(progress.plannedIds, userId);
  } catch {
    // A full browser cache must not turn a confirmed server save into a failed operation.
  }
}

function progressErrorMessage(error: unknown) {
  if (isAxiosError<ApiResponse>(error)) {
    if (error.response?.status === 401) return 'Your session expired. Sign out and sign in again.';
    return (
      error.response?.data?.error || 'Could not save progress. Check your connection and try again.'
    );
  }
  return error instanceof Error ? error.message : 'Could not save progress. Please try again.';
}

async function mutateProgress(data: CompleteCourseDTO, cascadeIds: string[] = []) {
  const state = useAppStore.getState();
  if (
    state.pendingCompletionIds.size ||
    (state.progressOwnerId && state.progressStatus !== 'ready')
  )
    return;
  const userId = state.progressOwnerId;
  const version = ownerVersion;
  const before = { completedIds: state.completedIds, plannedIds: state.plannedIds };
  const completedIds = { ...state.completedIds };
  const plannedIds = state.plannedIds.filter((id) => id !== data.courseId);
  if (data.status === 'COMPLETED') {
    completedIds[data.courseId] = data.electiveGroup ?? null;
    playCompleteSound();
  } else {
    delete completedIds[data.courseId];
    for (const id of cascadeIds) delete completedIds[id];
    if (data.status === 'PLANNED') plannedIds.push(data.courseId);
    if (state.completedIds[data.courseId] !== undefined) playUncompleteSound();
    else if (data.status === 'PLANNED') playPlanSound();
    else playUnplanSound();
  }
  const optimistic = { completedIds, plannedIds };
  useAppStore.setState({
    ...optimistic,
    progressError: null,
    completionVersion: state.completionVersion + 1,
    pendingCompletionIds: userId ? new Set([data.courseId, ...cascadeIds]) : new Set(),
  });
  if (!userId) {
    cacheProgress(optimistic, null);
    return;
  }
  const isCurrent = () =>
    ownerVersion === version && useAppStore.getState().progressOwnerId === userId;
  const reconcile = (progress: StudentProgressDTO) => {
    cacheProgress(progress, userId);
    useAppStore.setState((current) => ({
      completedIds: progress.completedIds,
      plannedIds: progress.plannedIds,
      completionVersion: current.completionVersion + 1,
    }));
  };
  try {
    const confirmed = await saveCourseProgress(data);
    if (!isCurrent()) return;
    reconcile(confirmed);
    useAppStore.setState({ pendingCompletionIds: new Set(), progressStatus: 'ready' });
  } catch (error) {
    if (!isCurrent()) return;
    reconcile(before);
    useAppStore.setState({ progressError: progressErrorMessage(error) });
    // A lost response may follow a committed write. Recover before another edit.
    try {
      const confirmed = await getCurrentStudentProgress();
      if (!isCurrent()) return;
      reconcile(confirmed);
      useAppStore.setState({ progressStatus: 'ready' });
    } catch {
      if (isCurrent()) useAppStore.setState({ progressStatus: 'error' });
    } finally {
      if (isCurrent()) useAppStore.setState({ pendingCompletionIds: new Set() });
    }
  }
}

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
  progressStatus: 'ready',
  progressError: null,
  browserProgressBackup: null,
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
    if (get().progressOwnerId === userId) return;
    ownerVersion++;
    loadVersion++;
    set((state) =>
      state.progressOwnerId === userId
        ? state
        : {
            progressOwnerId: userId,
            progressStatus: userId ? 'idle' : 'ready',
            progressError: null,
            browserProgressBackup: null,
            pendingCompletionIds: new Set(),
            completedIds: loadCompletedIds(userId),
            plannedIds: loadPlannedIds(userId),
            completionVersion: state.completionVersion + 1,
          },
    );
  },

  loadProgress: async () => {
    const userId = get().progressOwnerId;
    if (!userId || get().pendingCompletionIds.size) return;
    const version = ownerVersion;
    const request = ++loadVersion;
    const previous = { completedIds: get().completedIds, plannedIds: get().plannedIds };
    const isCurrent = () => ownerVersion === version && loadVersion === request;
    set({ progressStatus: 'loading', progressError: null });
    try {
      const progress = await getCurrentStudentProgress();
      if (!isCurrent()) return;
      let browserProgressBackup: StudentProgressDTO | null = null;
      try {
        const backupKey = `browser_progress_backup:${userId}`;
        const markerKey = `server_progress_cache:${userId}`;
        if (
          !localStorage.getItem(markerKey) &&
          (Object.keys(previous.completedIds).length || previous.plannedIds.length)
        ) {
          localStorage.setItem(backupKey, JSON.stringify(previous));
        }
        const savedBackup = localStorage.getItem(backupKey);
        browserProgressBackup = savedBackup
          ? (JSON.parse(savedBackup) as StudentProgressDTO)
          : null;
        localStorage.setItem(markerKey, 'true');
      } catch {
        // Server progress remains usable when browser storage is unavailable.
      }
      cacheProgress(progress, userId);
      set((state) => ({
        ...progress,
        browserProgressBackup,
        progressStatus: 'ready',
        completionVersion: state.completionVersion + 1,
      }));
    } catch (error) {
      if (isCurrent()) set({ progressStatus: 'error', progressError: progressErrorMessage(error) });
    }
  },
  toggleCourseComplete: async (courseId, electiveGroup = null, cascadeIds = []) => {
    await mutateProgress(
      {
        courseId,
        electiveGroup,
        status: get().completedIds[courseId] !== undefined ? 'DROPPED' : 'COMPLETED',
      },
      cascadeIds,
    );
  },
  toggleCoursePlanned: async (courseId) => {
    await mutateProgress({
      courseId,
      status: get().plannedIds.includes(courseId) ? 'DROPPED' : 'PLANNED',
    });
  },
  completeToPlanned: async (courseId, cascadeIds = []) => {
    await mutateProgress({ courseId, status: 'PLANNED' }, cascadeIds);
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
