import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompleteCourseResponseDTO, StudentProgressDTO } from '@iu-study-planner/shared';
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

const getProgress = vi.mocked(getCurrentStudentProgress);
const saveProgress = vi.mocked(saveCourseProgress);
const emptyProgress: StudentProgressDTO = { completedIds: {}, plannedIds: [] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function confirmed(progress: StudentProgressDTO): CompleteCourseResponseDTO {
  return { ...progress, uncompletedCourseIds: [] };
}

async function signIn(progress: StudentProgressDTO = emptyProgress) {
  getProgress.mockResolvedValueOnce(progress);
  useAppStore.getState().setProgressOwner('alice');
  await useAppStore.getState().loadProgress();
}

function snapshot() {
  const { completedIds, plannedIds } = useAppStore.getState();
  return { completedIds, plannedIds };
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
    progressStatus: 'ready',
    progressError: null,
    browserProgressBackup: null,
    pendingCompletionIds: new Set(),
    completedIds: {},
    plannedIds: [],
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('authoritative progress hydration', () => {
  it('replaces an account cache with server claims and plans before enabling edits', async () => {
    localStorage.setItem('completed_courses:alice', JSON.stringify({ stale: 'Group 1' }));
    localStorage.setItem('planned_courses:alice', JSON.stringify(['stale-plan']));
    const request = deferred<StudentProgressDTO>();
    getProgress.mockReturnValueOnce(request.promise);
    const store = useAppStore.getState();
    store.setProgressOwner('alice');
    expect(snapshot()).toEqual({ completedIds: { stale: 'Group 1' }, plannedIds: ['stale-plan'] });
    await store.toggleCourseComplete('not-yet');
    expect(saveProgress).not.toHaveBeenCalled();
    const loading = store.loadProgress();
    expect(useAppStore.getState().progressStatus).toBe('loading');
    await store.toggleCoursePlanned('not-yet');
    expect(saveProgress).not.toHaveBeenCalled();
    const server = { completedIds: { completed: 'Group 2' }, plannedIds: ['planned'] };
    request.resolve(server);
    await loading;
    expect(snapshot()).toEqual(server);
    expect(useAppStore.getState().progressStatus).toBe('ready');
    expect(JSON.parse(localStorage.getItem('completed_courses:alice')!)).toEqual(
      server.completedIds,
    );
    expect(JSON.parse(localStorage.getItem('planned_courses:alice')!)).toEqual(server.plannedIds);
    const backup = { completedIds: { stale: 'Group 1' }, plannedIds: ['stale-plan'] };
    expect(useAppStore.getState().browserProgressBackup).toEqual(backup);
    expect(JSON.parse(localStorage.getItem('browser_progress_backup:alice')!)).toEqual(backup);
    expect(localStorage.getItem('server_progress_cache:alice')).toBe('true');
  });

  it('retains an archived browser claim and plan across account switches and later server reloads', async () => {
    const backup = { completedIds: { legacy: 'Group 3' }, plannedIds: ['legacy-plan'] };
    localStorage.setItem('completed_courses:alice', JSON.stringify(backup.completedIds));
    localStorage.setItem('planned_courses:alice', JSON.stringify(backup.plannedIds));
    await signIn({ completedIds: { server: null }, plannedIds: [] });
    expect(useAppStore.getState().browserProgressBackup).toEqual(backup);
    useAppStore.getState().setProgressOwner('bob');
    expect(useAppStore.getState().browserProgressBackup).toBeNull();
    useAppStore.getState().setProgressOwner('alice');
    getProgress.mockResolvedValueOnce(emptyProgress);
    await useAppStore.getState().loadProgress();
    expect(snapshot()).toEqual(emptyProgress);
    expect(useAppStore.getState().browserProgressBackup).toEqual(backup);
    expect(JSON.parse(localStorage.getItem('browser_progress_backup:alice')!)).toEqual(backup);
  });

  it('never copies guest selections into a signed-in account or its browser archive', async () => {
    localStorage.setItem('completed_courses', JSON.stringify({ guest: 'Group 1' }));
    localStorage.setItem('planned_courses', JSON.stringify(['guest-plan']));
    await signIn();
    expect(snapshot()).toEqual(emptyProgress);
    expect(useAppStore.getState().browserProgressBackup).toBeNull();
    expect(localStorage.getItem('browser_progress_backup:alice')).toBeNull();
    useAppStore.getState().setProgressOwner(null);
    expect(snapshot()).toEqual({ completedIds: { guest: 'Group 1' }, plannedIds: ['guest-plan'] });
  });

  it('does not archive confirmed server cache as old browser selections on later reloads', async () => {
    await signIn();
    saveProgress.mockResolvedValueOnce(
      confirmed({ completedIds: { confirmed: 'Group 2' }, plannedIds: ['confirmed-plan'] }),
    );
    await useAppStore.getState().toggleCourseComplete('confirmed', 'Group 2');
    useAppStore.getState().setProgressOwner(null);
    useAppStore.getState().setProgressOwner('alice');
    expect(snapshot().completedIds).toEqual({ confirmed: 'Group 2' });
    getProgress.mockResolvedValueOnce(emptyProgress);
    await useAppStore.getState().loadProgress();
    expect(snapshot()).toEqual(emptyProgress);
    expect(useAppStore.getState().browserProgressBackup).toBeNull();
    expect(localStorage.getItem('browser_progress_backup:alice')).toBeNull();
  });

  it('blocks cached edits after failed hydration and allows them after a successful retry', async () => {
    localStorage.setItem('completed_courses:alice', JSON.stringify({ cached: null }));
    useAppStore.getState().setProgressOwner('alice');
    getProgress.mockRejectedValueOnce(new Error('Offline'));
    await useAppStore.getState().loadProgress();
    expect(useAppStore.getState().progressStatus).toBe('error');
    expect(useAppStore.getState().progressError).toBe('Offline');
    await useAppStore.getState().toggleCoursePlanned('blocked');
    expect(saveProgress).not.toHaveBeenCalled();
    expect(snapshot().completedIds).toEqual({ cached: null });
    getProgress.mockResolvedValueOnce(emptyProgress);
    await useAppStore.getState().loadProgress();
    saveProgress.mockResolvedValueOnce(confirmed({ completedIds: {}, plannedIds: ['allowed'] }));
    await useAppStore.getState().toggleCoursePlanned('allowed');
    expect(snapshot()).toEqual({ completedIds: {}, plannedIds: ['allowed'] });
    expect(useAppStore.getState().progressError).toBeNull();
  });

  it('uses the latest reload when two session hydration requests finish out of order', async () => {
    useAppStore.getState().setProgressOwner('alice');
    const older = deferred<StudentProgressDTO>();
    const newer = deferred<StudentProgressDTO>();
    getProgress.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const first = useAppStore.getState().loadProgress();
    const second = useAppStore.getState().loadProgress();
    newer.resolve({ completedIds: { newest: null }, plannedIds: [] });
    await second;
    older.resolve({ completedIds: { outdated: null }, plannedIds: [] });
    await first;
    expect(snapshot().completedIds).toEqual({ newest: null });
    expect(useAppStore.getState().progressStatus).toBe('ready');
  });
});

describe('serialized optimistic saves', () => {
  it('claims an elective, removes its plan optimistically, and reconciles the server response', async () => {
    await signIn({ completedIds: {}, plannedIds: ['elective', 'other'] });
    const request = deferred<CompleteCourseResponseDTO>();
    saveProgress.mockReturnValueOnce(request.promise);
    const saving = useAppStore.getState().toggleCourseComplete('elective', 'Group 2');
    expect(snapshot()).toEqual({ completedIds: { elective: 'Group 2' }, plannedIds: ['other'] });
    expect(saveProgress).toHaveBeenCalledWith({
      courseId: 'elective',
      electiveGroup: 'Group 2',
      status: 'COMPLETED',
    });
    expect(useAppStore.getState().pendingCompletionIds).toEqual(new Set(['elective']));
    request.resolve(
      confirmed({ completedIds: { elective: 'Group 2' }, plannedIds: ['server-plan'] }),
    );
    await saving;
    expect(snapshot().plannedIds).toEqual(['server-plan']);
    expect(useAppStore.getState().pendingCompletionIds.size).toBe(0);
  });

  it('reconciles transitive server cascades beyond the client optimistic cascade', async () => {
    await signIn({
      completedIds: { prerequisite: null, direct: null, transitive: 'Group 3', independent: null },
      plannedIds: [],
    });
    const request = deferred<CompleteCourseResponseDTO>();
    saveProgress.mockReturnValueOnce(request.promise);
    const saving = useAppStore.getState().toggleCourseComplete('prerequisite', null, ['direct']);
    expect(snapshot().completedIds).toEqual({ transitive: 'Group 3', independent: null });
    expect(useAppStore.getState().pendingCompletionIds).toEqual(
      new Set(['prerequisite', 'direct']),
    );
    request.resolve({
      completedIds: { independent: null },
      plannedIds: [],
      uncompletedCourseIds: ['direct', 'transitive'],
    });
    await saving;
    expect(snapshot().completedIds).toEqual({ independent: null });
  });

  it('moves a completed course to planned and applies the authoritative cascade', async () => {
    await signIn({
      completedIds: { prerequisite: 'Group 1', dependent: null },
      plannedIds: ['existing'],
    });
    const request = deferred<CompleteCourseResponseDTO>();
    saveProgress.mockReturnValueOnce(request.promise);
    const saving = useAppStore.getState().completeToPlanned('prerequisite', ['dependent']);
    expect(snapshot()).toEqual({ completedIds: {}, plannedIds: ['existing', 'prerequisite'] });
    expect(saveProgress).toHaveBeenCalledWith({ courseId: 'prerequisite', status: 'PLANNED' });
    request.resolve({
      completedIds: {},
      plannedIds: ['existing', 'prerequisite'],
      uncompletedCourseIds: ['dependent'],
    });
    await saving;
    expect(snapshot()).toEqual({ completedIds: {}, plannedIds: ['existing', 'prerequisite'] });
  });

  it('prevents any second edit or reload while one save is pending', async () => {
    await signIn();
    const request = deferred<CompleteCourseResponseDTO>();
    saveProgress.mockReturnValueOnce(request.promise);
    const saving = useAppStore.getState().toggleCourseComplete('first');
    await useAppStore.getState().toggleCourseComplete('second');
    await useAppStore.getState().toggleCoursePlanned('third');
    await useAppStore.getState().completeToPlanned('first');
    await useAppStore.getState().loadProgress();
    expect(saveProgress).toHaveBeenCalledTimes(1);
    expect(getProgress).toHaveBeenCalledTimes(1);
    expect(snapshot()).toEqual({ completedIds: { first: null }, plannedIds: [] });
    request.resolve(confirmed({ completedIds: { first: null }, plannedIds: [] }));
    await saving;
    saveProgress.mockResolvedValueOnce(
      confirmed({ completedIds: { first: null }, plannedIds: ['third'] }),
    );
    await useAppStore.getState().toggleCoursePlanned('third');
    expect(saveProgress).toHaveBeenCalledTimes(2);
  });

  it('rolls back a rejected save and stays locked until recovery finishes', async () => {
    const before = { completedIds: { original: 'Group 1' }, plannedIds: ['planned'] };
    await signIn(before);
    const recovery = deferred<StudentProgressDTO>();
    getProgress.mockReturnValueOnce(recovery.promise);
    saveProgress.mockRejectedValueOnce(new Error('Prerequisites missing'));
    const saving = useAppStore.getState().toggleCourseComplete('planned', 'Group 2');
    await vi.waitFor(() => expect(getProgress).toHaveBeenCalledTimes(2));
    expect(snapshot()).toEqual(before);
    expect(useAppStore.getState().progressError).toBe('Prerequisites missing');
    await useAppStore.getState().toggleCoursePlanned('blocked');
    expect(saveProgress).toHaveBeenCalledTimes(1);
    recovery.resolve(before);
    await saving;
    expect(snapshot()).toEqual(before);
    expect(useAppStore.getState().progressStatus).toBe('ready');
    expect(useAppStore.getState().pendingCompletionIds.size).toBe(0);
  });

  it('recovers a committed server write after the POST response is lost', async () => {
    await signIn();
    const committed = { completedIds: { completed: 'Group 2' }, plannedIds: [] };
    saveProgress.mockRejectedValueOnce(new Error('Connection lost'));
    getProgress.mockResolvedValueOnce(committed);
    await useAppStore.getState().toggleCourseComplete('completed', 'Group 2');
    expect(snapshot()).toEqual(committed);
    expect(useAppStore.getState().progressStatus).toBe('ready');
    expect(JSON.parse(localStorage.getItem('completed_courses:alice')!)).toEqual(
      committed.completedIds,
    );
    expect(useAppStore.getState().pendingCompletionIds.size).toBe(0);
  });

  it('blocks edits when both the save and recovery fail, then reloads before retrying edits', async () => {
    await signIn();
    saveProgress.mockRejectedValueOnce(new Error('Offline'));
    getProgress.mockRejectedValueOnce(new Error('Still offline'));
    await useAppStore.getState().toggleCoursePlanned('course');
    expect(snapshot()).toEqual(emptyProgress);
    expect(useAppStore.getState().progressStatus).toBe('error');
    expect(useAppStore.getState().pendingCompletionIds.size).toBe(0);
    await useAppStore.getState().toggleCourseComplete('blocked');
    expect(saveProgress).toHaveBeenCalledTimes(1);
    getProgress.mockResolvedValueOnce({ completedIds: {}, plannedIds: ['course'] });
    await useAppStore.getState().loadProgress();
    expect(snapshot().plannedIds).toEqual(['course']);
    expect(useAppStore.getState().progressStatus).toBe('ready');
    expect(useAppStore.getState().progressError).toBeNull();
  });

  it('keeps confirmed server progress when localStorage runs out of space', async () => {
    await signIn();
    const setItem = vi.fn(() => {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
    });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem });
    const server = { completedIds: { course: 'Group 3' }, plannedIds: [] };
    saveProgress.mockResolvedValueOnce(confirmed(server));
    await useAppStore.getState().toggleCourseComplete('course', 'Group 3');
    expect(setItem).toHaveBeenCalled();
    expect(snapshot()).toEqual(server);
    expect(getProgress).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().progressError).toBeNull();
    expect(useAppStore.getState().progressStatus).toBe('ready');
  });
});

describe('session changes invalidate in-flight requests', () => {
  it.each(['logout', 'switch', 'switch back'] as const)(
    'ignores a late GET after %s',
    async (change) => {
      localStorage.setItem('completed_courses', JSON.stringify({ guest: null }));
      useAppStore.getState().setProgressOwner('alice');
      const request = deferred<StudentProgressDTO>();
      getProgress.mockReturnValueOnce(request.promise);
      const loading = useAppStore.getState().loadProgress();
      useAppStore.getState().setProgressOwner(change === 'logout' ? null : 'bob');
      if (change === 'switch back') useAppStore.getState().setProgressOwner('alice');
      const current = snapshot();
      const status = useAppStore.getState().progressStatus;
      request.resolve({ completedIds: { late: 'Group 2' }, plannedIds: ['late-plan'] });
      await loading;
      expect(snapshot()).toEqual(current);
      expect(useAppStore.getState().progressStatus).toBe(status);
      expect(localStorage.getItem('completed_courses:alice')).toBeNull();
    },
  );

  it.each(['logout', 'switch', 'switch back'] as const)(
    'ignores a late POST after %s',
    async (change) => {
      await signIn();
      const request = deferred<CompleteCourseResponseDTO>();
      saveProgress.mockReturnValueOnce(request.promise);
      const saving = useAppStore.getState().toggleCourseComplete('course');
      useAppStore.getState().setProgressOwner(change === 'logout' ? null : 'bob');
      if (change === 'switch back') useAppStore.getState().setProgressOwner('alice');
      const current = snapshot();
      const status = useAppStore.getState().progressStatus;
      request.resolve(confirmed({ completedIds: { late: null }, plannedIds: [] }));
      await saving;
      expect(snapshot()).toEqual(current);
      expect(useAppStore.getState().progressStatus).toBe(status);
      expect(useAppStore.getState().pendingCompletionIds.size).toBe(0);
      expect(JSON.parse(localStorage.getItem('completed_courses:alice')!)).toEqual({});
    },
  );

  it('does not start recovery for a rejected POST from an account that has signed out', async () => {
    await signIn();
    const request = deferred<CompleteCourseResponseDTO>();
    saveProgress.mockReturnValueOnce(request.promise);
    const saving = useAppStore.getState().toggleCourseComplete('course');
    useAppStore.getState().setProgressOwner(null);
    request.reject(new Error('Late rejection'));
    await saving;
    expect(getProgress).toHaveBeenCalledTimes(1);
    expect(snapshot()).toEqual(emptyProgress);
    expect(useAppStore.getState().progressError).toBeNull();
  });
});
