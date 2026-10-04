import { create } from 'zustand';
import { isAxiosError } from 'axios';
import { UpsertProgressSchema } from '@iu-study-planner/shared';
import type {
  AccountWriteScopeDTO,
  ApiResponse,
  CompleteCourseDTO,
  ScopedStudentProgressDTO,
  StudentProgressDTO,
} from '@iu-study-planner/shared';
import type { AppState } from '../types';
import { importStudentProgress, saveCourseProgress } from './api';
import { getScopedStudentProgress } from './scopedProgressApi';
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
      parsed.forEach((id: unknown) => {
        if (typeof id === 'string') result[id] = null;
      });
      return result;
    }
    if (!parsed || typeof parsed !== 'object') return {};
    const result: StoredCompletion = {};
    for (const [id, claim] of Object.entries(parsed)) {
      if (claim === null || typeof claim === 'string') result[id] = claim;
    }
    return result;
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
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
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

function importErrorMessage(error: unknown) {
  const message = progressErrorMessage(error);
  if (!isAxiosError<ApiResponse>(error) || error.response?.status !== 409) return message;
  const details: unknown = error.response.data.details;
  if (!Array.isArray(details)) return message;
  const courses = details.flatMap((detail: unknown) => {
    if (!detail || typeof detail !== 'object' || !('code' in detail) || !('name' in detail))
      return [];
    if (typeof detail.code !== 'string' || typeof detail.name !== 'string') return [];
    return [`${detail.code}: ${detail.name}`];
  });
  return courses.length ? `${message} Related courses: ${courses.join(', ')}.` : message;
}

// The legacy map is editable only after an owner-scoped snapshot confirms no assignment.
class ProgressScopeChangedError extends Error {}

function legacyProgress(snapshot: ScopedStudentProgressDTO, userId: string): StudentProgressDTO {
  if (snapshot.scope.userId !== userId || snapshot.scope.curriculumId !== null) {
    const message = 'Your curriculum changed. Reload your curriculum to review saved progress.';
    useAppStore.setState((state) => ({
      progressScope: null,
      completedIds: {},
      plannedIds: [],
      progressStatus: 'error',
      progressError: message,
      completionVersion: state.completionVersion + 1,
    }));
    throw new ProgressScopeChangedError(message);
  }
  return snapshot.progress;
}

function editableScope(state: AppState): AccountWriteScopeDTO | null {
  return state.progressScope?.userId === state.progressOwnerId &&
    state.progressScope.curriculumId === null
    ? state.progressScope
    : null;
}

async function mutateProgress(data: CompleteCourseDTO, cascadeIds: string[] = []) {
  const state = useAppStore.getState();
  if (
    state.pendingCompletionIds.size ||
    (state.progressOwnerId && (state.progressStatus !== 'ready' || !editableScope(state)))
  )
    return;
  const userId = state.progressOwnerId;
  const expectedScope = editableScope(state);
  const version = ownerVersion;
  const request = ++loadVersion;
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
    ownerVersion === version &&
    loadVersion === request &&
    useAppStore.getState().progressOwnerId === userId;
  const reconcile = (progress: StudentProgressDTO) => {
    cacheProgress(progress, userId);
    useAppStore.setState((current) => ({
      completedIds: progress.completedIds,
      plannedIds: progress.plannedIds,
      completionVersion: current.completionVersion + 1,
    }));
  };
  try {
    await saveCourseProgress({ ...data, expectedScope: expectedScope! });
    if (!isCurrent()) return;
    const snapshot = await getScopedStudentProgress(userId);
    if (!isCurrent()) return;
    reconcile(legacyProgress(snapshot, userId));
    useAppStore.setState({ pendingCompletionIds: new Set(), progressStatus: 'ready' });
  } catch (error) {
    if (!isCurrent()) return;
    if (error instanceof ProgressScopeChangedError) {
      useAppStore.setState({ pendingCompletionIds: new Set() });
      return;
    }
    reconcile(before);
    useAppStore.setState({ progressError: progressErrorMessage(error) });
    // A lost response may follow a committed write. Recover before another edit.
    try {
      const snapshot = await getScopedStudentProgress(userId);
      if (!isCurrent()) return;
      reconcile(legacyProgress(snapshot, userId));
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
  progressScope: null,
  progressStatus: 'ready',
  progressError: null,
  browserProgressBackup: null,
  browserProgressBackupError: null,
  progressImportStatus: 'idle',
  progressImportError: null,
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
            progressScope: null,
            progressStatus: userId ? 'idle' : 'ready',
            progressError: null,
            browserProgressBackup: null,
            browserProgressBackupError: null,
            progressImportStatus: 'idle',
            progressImportError: null,
            pendingCompletionIds: new Set(),
            completedIds: loadCompletedIds(userId),
            plannedIds: loadPlannedIds(userId),
            completionVersion: state.completionVersion + 1,
          },
    );
  },

  loadProgress: async () => {
    const userId = get().progressOwnerId;
    if (!userId || get().pendingCompletionIds.size || get().progressImportStatus === 'importing')
      return;
    const version = ownerVersion;
    const request = ++loadVersion;
    const previous = { completedIds: loadCompletedIds(userId), plannedIds: loadPlannedIds(userId) };
    const isCurrent = () => ownerVersion === version && loadVersion === request;
    set({ progressScope: null, progressStatus: 'loading', progressError: null });
    try {
      const snapshot = await getScopedStudentProgress(userId);
      if (!isCurrent()) return;
      const progress = legacyProgress(snapshot, userId);
      let browserProgressBackup = get().browserProgressBackup;
      let browserProgressBackupError = get().browserProgressBackupError;
      try {
        const backupKey = `browser_progress_backup:${userId}`;
        const markerKey = `server_progress_cache:${userId}`;
        let savedBackup = localStorage.getItem(backupKey);
        if (
          !localStorage.getItem(markerKey) &&
          savedBackup === null &&
          (Object.keys(previous.completedIds).length || previous.plannedIds.length)
        ) {
          savedBackup = JSON.stringify(previous);
          localStorage.setItem(backupKey, savedBackup);
        }
        if (savedBackup !== null) {
          browserProgressBackup = null;
          browserProgressBackupError = null;
          try {
            const result = UpsertProgressSchema.safeParse(JSON.parse(savedBackup));
            if (result.success) browserProgressBackup = result.data;
            else
              browserProgressBackupError =
                'Archived browser selections are invalid and cannot be imported.';
          } catch {
            browserProgressBackupError =
              'Archived browser selections are invalid and cannot be imported.';
          }
        } else {
          browserProgressBackup = null;
          browserProgressBackupError = null;
        }
        localStorage.setItem(markerKey, 'true');
      } catch {
        // Server progress remains usable when browser storage is unavailable.
      }
      cacheProgress(progress, userId);
      set((state) => ({
        ...progress,
        progressScope: snapshot.scope,
        browserProgressBackup,
        browserProgressBackupError,
        progressStatus: 'ready',
        completionVersion: state.completionVersion + 1,
      }));
    } catch (error) {
      if (isCurrent()) set({ progressStatus: 'error', progressError: progressErrorMessage(error) });
    }
  },
  importBrowserProgress: async () => {
    const state = get();
    const userId = state.progressOwnerId;
    if (
      !userId ||
      state.progressStatus !== 'ready' ||
      !editableScope(state) ||
      state.pendingCompletionIds.size ||
      !state.browserProgressBackup
    )
      return;
    const result = UpsertProgressSchema.safeParse(state.browserProgressBackup);
    if (!result.success) {
      set({
        browserProgressBackup: null,
        browserProgressBackupError:
          'Archived browser selections are invalid and cannot be imported.',
      });
      return;
    }
    const version = ownerVersion;
    const request = ++loadVersion;
    const isCurrent = () =>
      ownerVersion === version && loadVersion === request && get().progressOwnerId === userId;
    const reconcile = (progress: StudentProgressDTO) => {
      cacheProgress(progress, userId);
      set((current) => ({
        completedIds: progress.completedIds,
        plannedIds: progress.plannedIds,
        completionVersion: current.completionVersion + 1,
      }));
    };
    set({
      progressStatus: 'loading',
      progressError: null,
      progressImportStatus: 'importing',
      progressImportError: null,
    });
    try {
      await importStudentProgress({ ...result.data, expectedScope: editableScope(state)! });
      if (!isCurrent()) return;
      const snapshot = await getScopedStudentProgress(userId);
      if (!isCurrent()) return;
      reconcile(legacyProgress(snapshot, userId));
      try {
        localStorage.removeItem(`browser_progress_backup:${userId}`);
      } catch {
        // Confirmed server progress remains usable even if the archive cannot be removed.
      }
      set({
        browserProgressBackup: null,
        browserProgressBackupError: null,
        progressStatus: 'ready',
        progressImportStatus: 'success',
      });
    } catch (error) {
      if (!isCurrent()) return;
      const message = importErrorMessage(error);
      if (error instanceof ProgressScopeChangedError) {
        set({ progressImportStatus: 'error', progressImportError: message });
        return;
      }
      set({ progressImportError: message, progressError: message });
      // The POST may have committed before its response was lost. Keep the archive
      // for an explicit additive retry, and recover before permitting more edits.
      try {
        const snapshot = await getScopedStudentProgress(userId);
        if (!isCurrent()) return;
        reconcile(legacyProgress(snapshot, userId));
        set({ progressStatus: 'ready', progressImportStatus: 'error' });
      } catch {
        if (isCurrent()) set({ progressStatus: 'error', progressImportStatus: 'error' });
      }
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
