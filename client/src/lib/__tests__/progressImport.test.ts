import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import type { StudentProgressDTO } from '@iu-study-planner/shared';
import { getCurrentStudentProgress, importStudentProgress, saveCourseProgress } from '../api';
import { useAppStore } from '../store';

vi.mock('../api', () => ({
  getCurrentStudentProgress: vi.fn(),
  importStudentProgress: vi.fn(),
  saveCourseProgress: vi.fn(),
}));
vi.mock('../sounds', () => ({
  playCompleteSound: vi.fn(),
  playUncompleteSound: vi.fn(),
  playPlanSound: vi.fn(),
  playUnplanSound: vi.fn(),
}));

const completed = '00000000-0000-4000-8000-000000000001';
const planned = '00000000-0000-4000-8000-000000000002';
const existing = '00000000-0000-4000-8000-000000000003';
const backup: StudentProgressDTO = {
  completedIds: { [completed]: 'Group 2' },
  plannedIds: [planned],
};
const initial: StudentProgressDTO = { completedIds: { [existing]: 'Group 1' }, plannedIds: [] };
const merged: StudentProgressDTO = {
  completedIds: { [existing]: 'Group 1', [completed]: 'Group 2' },
  plannedIds: [planned],
};
const getProgress = vi.mocked(getCurrentStudentProgress);
const importProgress = vi.mocked(importStudentProgress);
const saveProgress = vi.mocked(saveCourseProgress);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
function snapshot() {
  const { completedIds, plannedIds } = useAppStore.getState();
  return { completedIds, plannedIds };
}
async function signIn(archive = JSON.stringify(backup)) {
  localStorage.setItem('browser_progress_backup:alice', archive);
  getProgress.mockResolvedValueOnce(initial);
  useAppStore.getState().setProgressOwner('alice');
  await useAppStore.getState().loadProgress();
}
beforeEach(() => {
  vi.resetAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  useAppStore.getState().setProgressOwner(null);
  useAppStore.setState({
    completedIds: {},
    plannedIds: [],
    progressOwnerId: null,
    progressStatus: 'ready',
    pendingCompletionIds: new Set(),
    browserProgressBackup: null,
    browserProgressBackupError: null,
    progressImportStatus: 'idle',
    progressImportError: null,
    progressError: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('explicit account-owned archive imports', () => {
  it('imports only the reviewed archive, reconciles the full server snapshot, and retires the backup after confirmation', async () => {
    await signIn();
    const request = deferred<StudentProgressDTO>();
    importProgress.mockReturnValueOnce(request.promise);
    const importing = useAppStore.getState().importBrowserProgress();
    expect(importProgress).toHaveBeenCalledWith(backup);
    expect(snapshot()).toEqual(initial);
    expect(useAppStore.getState().progressImportStatus).toBe('importing');
    expect(localStorage.getItem('browser_progress_backup:alice')).toBe(JSON.stringify(backup));
    request.resolve(merged);
    await importing;
    expect(snapshot()).toEqual(merged);
    expect(useAppStore.getState().progressStatus).toBe('ready');
    expect(useAppStore.getState().progressImportStatus).toBe('success');
    expect(useAppStore.getState().browserProgressBackup).toBeNull();
    expect(localStorage.getItem('browser_progress_backup:alice')).toBeNull();
    expect(JSON.parse(localStorage.getItem('completed_courses:alice')!)).toEqual(
      merged.completedIds,
    );
    expect(getProgress).toHaveBeenCalledTimes(1);
  });

  it('blocks duplicate imports, normal course edits, and reloads while importing', async () => {
    await signIn();
    const request = deferred<StudentProgressDTO>();
    importProgress.mockReturnValueOnce(request.promise);
    const importing = useAppStore.getState().importBrowserProgress();
    await useAppStore.getState().importBrowserProgress();
    await useAppStore.getState().toggleCourseComplete(planned);
    await useAppStore.getState().toggleCoursePlanned(planned);
    await useAppStore.getState().completeToPlanned(existing);
    await useAppStore.getState().loadProgress();
    expect(importProgress).toHaveBeenCalledTimes(1);
    expect(saveProgress).not.toHaveBeenCalled();
    expect(getProgress).toHaveBeenCalledTimes(1);
    request.resolve(merged);
    await importing;
  });

  it('does not start an import during ordinary save or hydration', async () => {
    await signIn();
    const save = deferred<StudentProgressDTO & { uncompletedCourseIds: string[] }>();
    saveProgress.mockReturnValueOnce(save.promise);
    const saving = useAppStore.getState().toggleCoursePlanned(planned);
    await useAppStore.getState().importBrowserProgress();
    expect(importProgress).not.toHaveBeenCalled();
    save.resolve({ ...initial, uncompletedCourseIds: [] });
    await saving;
    const load = deferred<StudentProgressDTO>();
    getProgress.mockReturnValueOnce(load.promise);
    const loading = useAppStore.getState().loadProgress();
    await useAppStore.getState().importBrowserProgress();
    expect(importProgress).not.toHaveBeenCalled();
    load.resolve(initial);
    await loading;
  });

  it('invalidates an older reload that finishes after a newer hydration and successful import', async () => {
    await signIn();
    const older = deferred<StudentProgressDTO>();
    getProgress.mockReturnValueOnce(older.promise).mockResolvedValueOnce(initial);
    const staleLoad = useAppStore.getState().loadProgress();
    await useAppStore.getState().loadProgress();
    importProgress.mockResolvedValueOnce(merged);
    await useAppStore.getState().importBrowserProgress();
    older.resolve(initial);
    await staleLoad;
    expect(snapshot()).toEqual(merged);
    expect(useAppStore.getState().browserProgressBackup).toBeNull();
    expect(useAppStore.getState().progressImportStatus).toBe('success');
  });

  it('recovers a lost POST response, retains the backup, and permits an explicit additive retry', async () => {
    await signIn();
    const recovery = deferred<StudentProgressDTO>();
    importProgress.mockRejectedValueOnce(new Error('Connection lost'));
    getProgress.mockReturnValueOnce(recovery.promise);
    const importing = useAppStore.getState().importBrowserProgress();
    await vi.waitFor(() => expect(getProgress).toHaveBeenCalledTimes(2));
    await useAppStore.getState().importBrowserProgress();
    await useAppStore.getState().toggleCoursePlanned(planned);
    await useAppStore.getState().loadProgress();
    expect(importProgress).toHaveBeenCalledTimes(1);
    expect(saveProgress).not.toHaveBeenCalled();
    expect(getProgress).toHaveBeenCalledTimes(2);
    recovery.resolve(merged);
    await importing;
    expect(snapshot()).toEqual(merged);
    expect(useAppStore.getState().progressImportStatus).toBe('error');
    expect(useAppStore.getState().progressImportError).toBe('Connection lost');
    expect(useAppStore.getState().progressStatus).toBe('ready');
    expect(useAppStore.getState().browserProgressBackup).toEqual(backup);
    expect(localStorage.getItem('browser_progress_backup:alice')).toBe(JSON.stringify(backup));
    importProgress.mockResolvedValueOnce(merged);
    await useAppStore.getState().importBrowserProgress();
    expect(importProgress).toHaveBeenNthCalledWith(2, backup);
    expect(useAppStore.getState().progressImportError).toBeNull();
    expect(useAppStore.getState().browserProgressBackup).toBeNull();
  });

  it('retains the backup and locks edits when rejection and recovery both fail until reloaded', async () => {
    await signIn();
    importProgress.mockRejectedValueOnce(new Error('Prerequisites missing'));
    getProgress.mockRejectedValueOnce(new Error('Offline'));
    await useAppStore.getState().importBrowserProgress();
    expect(snapshot()).toEqual(initial);
    expect(useAppStore.getState().progressStatus).toBe('error');
    expect(useAppStore.getState().browserProgressBackup).toEqual(backup);
    await useAppStore.getState().importBrowserProgress();
    await useAppStore.getState().toggleCoursePlanned(planned);
    expect(importProgress).toHaveBeenCalledTimes(1);
    expect(saveProgress).not.toHaveBeenCalled();
    getProgress.mockResolvedValueOnce(initial);
    await useAppStore.getState().loadProgress();
    expect(useAppStore.getState().progressStatus).toBe('ready');
    expect(useAppStore.getState().browserProgressBackup).toEqual(backup);
  });

  it.each(['logout', 'switch', 'switch back'] as const)(
    'ignores a confirmed import response after %s and preserves its archive',
    async (change) => {
      await signIn();
      const request = deferred<StudentProgressDTO>();
      importProgress.mockReturnValueOnce(request.promise);
      const importing = useAppStore.getState().importBrowserProgress();
      useAppStore.getState().setProgressOwner(change === 'logout' ? null : 'bob');
      if (change === 'switch back') useAppStore.getState().setProgressOwner('alice');
      const current = snapshot();
      request.resolve(merged);
      await importing;
      expect(snapshot()).toEqual(current);
      expect(useAppStore.getState().progressImportStatus).toBe('idle');
      expect(localStorage.getItem('browser_progress_backup:alice')).toBe(JSON.stringify(backup));
      expect(JSON.parse(localStorage.getItem('completed_courses:alice')!)).toEqual(
        initial.completedIds,
      );
    },
  );

  it('does not recover a failed import for an account that signed out', async () => {
    await signIn();
    const request = deferred<StudentProgressDTO>();
    importProgress.mockReturnValueOnce(request.promise);
    const importing = useAppStore.getState().importBrowserProgress();
    useAppStore.getState().setProgressOwner(null);
    request.reject(new Error('Late rejection'));
    await importing;
    expect(getProgress).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().progressImportError).toBeNull();
  });

  it('ignores a recovery response after switching accounts', async () => {
    await signIn();
    const recovery = deferred<StudentProgressDTO>();
    importProgress.mockRejectedValueOnce(new Error('Connection lost'));
    getProgress.mockReturnValueOnce(recovery.promise);
    const importing = useAppStore.getState().importBrowserProgress();
    await vi.waitFor(() => expect(getProgress).toHaveBeenCalledTimes(2));
    useAppStore.getState().setProgressOwner('bob');
    const current = snapshot();
    recovery.resolve(merged);
    await importing;
    expect(snapshot()).toEqual(current);
    expect(useAppStore.getState().progressImportStatus).toBe('idle');
    expect(localStorage.getItem('browser_progress_backup:alice')).toBe(JSON.stringify(backup));
  });

  it.each([
    'invalid json',
    'null',
    JSON.stringify({ completedIds: { invalid: null }, plannedIds: [] }),
    JSON.stringify({ completedIds: {}, plannedIds: [planned, planned] }),
    JSON.stringify({ completedIds: { [planned]: null }, plannedIds: [planned] }),
    JSON.stringify({ ...backup, userId: 'bob' }),
  ])('rejects malformed archive %s without affecting server progress', async (archive) => {
    await signIn(archive);
    expect(snapshot()).toEqual(initial);
    expect(useAppStore.getState().progressStatus).toBe('ready');
    expect(useAppStore.getState().browserProgressBackup).toBeNull();
    expect(useAppStore.getState().browserProgressBackupError).toContain('invalid');
    expect(localStorage.getItem('browser_progress_backup:alice')).toBe(archive);
    await useAppStore.getState().importBrowserProgress();
    expect(importProgress).not.toHaveBeenCalled();
  });

  it.each(['', '{ malformed original archive'])(
    'preserves existing raw archive %s when no server cache marker exists',
    async (raw) => {
      localStorage.setItem('completed_courses:alice', JSON.stringify({ [existing]: null }));
      localStorage.setItem('planned_courses:alice', JSON.stringify([planned]));
      await signIn(raw);
      expect(localStorage.getItem('browser_progress_backup:alice')).toBe(raw);
      expect(useAppStore.getState().browserProgressBackupError).toContain('invalid');
      expect(snapshot()).toEqual(initial);
    },
  );

  it.each(['null', '42', JSON.stringify('wrong shape')])(
    'hydrates safely when legacy cache contains %s',
    async (raw) => {
      localStorage.setItem('completed_courses:alice', raw);
      localStorage.setItem('planned_courses:alice', raw);
      await signIn();
      expect(snapshot()).toEqual(initial);
      expect(useAppStore.getState().browserProgressBackup).toEqual(backup);
      expect(useAppStore.getState().progressStatus).toBe('ready');
    },
  );

  it('shows mandatory prerequisite course details from a rejected import while retaining the archive', async () => {
    await signIn();
    const error = new AxiosError('Conflict');
    error.response = {
      status: 409,
      statusText: 'Conflict',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: {
        success: false,
        error: 'Cannot import without all prerequisites',
        details: [
          { id: existing, code: 'MA001IU', name: 'Calculus 1' },
          { code: 42, name: 'ignore malformed detail' },
        ],
      },
    };
    importProgress.mockRejectedValueOnce(error);
    getProgress.mockResolvedValueOnce(initial);
    await useAppStore.getState().importBrowserProgress();
    expect(useAppStore.getState().progressImportError).toBe(
      'Cannot import without all prerequisites Related courses: MA001IU: Calculus 1.',
    );
    expect(useAppStore.getState().browserProgressBackup).toEqual(backup);
    expect(snapshot()).toEqual(initial);
  });

  it('never imports guest selections even when an archive is present in memory', async () => {
    useAppStore.setState({
      completedIds: backup.completedIds,
      plannedIds: backup.plannedIds,
      browserProgressBackup: backup,
    });
    await useAppStore.getState().importBrowserProgress();
    expect(importProgress).not.toHaveBeenCalled();
    expect(getProgress).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(backup);
  });

  it('retains an already loaded backup through reload and import when the storage getter is denied', async () => {
    await signIn();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('Storage denied');
      },
    });
    try {
      getProgress.mockResolvedValueOnce(initial);
      await useAppStore.getState().loadProgress();
      expect(useAppStore.getState().browserProgressBackup).toEqual(backup);
      expect(useAppStore.getState().progressStatus).toBe('ready');
      importProgress.mockResolvedValueOnce(merged);
      await useAppStore.getState().importBrowserProgress();
      expect(snapshot()).toEqual(merged);
      expect(useAppStore.getState().progressImportStatus).toBe('success');
      expect(useAppStore.getState().progressImportError).toBeNull();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', descriptor);
    }
  });

  it('keeps successful import confirmed when browser cache and archive removal are denied', async () => {
    await signIn();
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Storage denied');
      },
      setItem: () => {
        throw new Error('Storage denied');
      },
      removeItem: () => {
        throw new Error('Storage denied');
      },
    });
    importProgress.mockResolvedValueOnce(merged);
    await useAppStore.getState().importBrowserProgress();
    expect(snapshot()).toEqual(merged);
    expect(useAppStore.getState().progressImportStatus).toBe('success');
    expect(useAppStore.getState().progressImportError).toBeNull();
    expect(useAppStore.getState().progressStatus).toBe('ready');
    expect(getProgress).toHaveBeenCalledTimes(1);
  });
});
