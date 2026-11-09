import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentProgressDTO } from '@iu-study-planner/shared';
import apiClient, { importStudentProgress, saveCourseProgress } from '../api';
import { useAppStore } from '../store';

vi.mock('../api', () => ({
  default: { get: vi.fn() },
  importStudentProgress: vi.fn(),
  saveCourseProgress: vi.fn(),
}));
vi.mock('../sounds', () => ({
  playCompleteSound: vi.fn(),
  playUncompleteSound: vi.fn(),
  playPlanSound: vi.fn(),
  playUnplanSound: vi.fn(),
}));

const alice = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bob = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const curriculum = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const completed = '00000000-0000-4000-8000-000000000001';
const planned = '00000000-0000-4000-8000-000000000002';
const archived = '00000000-0000-4000-8000-000000000003';
const initial: StudentProgressDTO = { completedIds: { [completed]: 'Group 1' }, plannedIds: [] };
const backup: StudentProgressDTO = { completedIds: { [archived]: 'Group 2' }, plannedIds: [] };
const merged: StudentProgressDTO = {
  completedIds: { ...initial.completedIds, ...backup.completedIds },
  plannedIds: [planned],
};
const expectedScope = { userId: alice, curriculumId: null };
const get = vi.mocked(apiClient.get);
const save = vi.mocked(saveCourseProgress);
const importProgress = vi.mocked(importStudentProgress);
const cacheKey = `completed_courses:${alice}`;
const archiveKey = `browser_progress_backup:${alice}`;

function response(progress = initial, curriculumId: string | null = null, userId = alice) {
  return { data: { success: true, data: { scope: { userId, curriculumId }, progress } } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
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

async function signIn(rawArchive = JSON.stringify(backup)) {
  localStorage.setItem(archiveKey, rawArchive);
  get.mockResolvedValueOnce(response());
  useAppStore.getState().setProgressOwner(alice);
  await useAppStore.getState().loadProgress();
  expect(useAppStore.getState().progressScope).toEqual(expectedScope);
  expect(useAppStore.getState().progressStatus).toBe('ready');
}

async function attemptAllWrites() {
  await useAppStore.getState().toggleCourseComplete(archived);
  await useAppStore.getState().toggleCoursePlanned(planned);
  await useAppStore.getState().completeToPlanned(completed);
  await useAppStore.getState().importBrowserProgress();
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
    progressOwnerId: null,
    progressScope: null,
    progressStatus: 'ready',
    progressError: null,
    progressImportStatus: 'idle',
    progressImportError: null,
    browserProgressBackup: null,
    browserProgressBackupError: null,
    pendingCompletionIds: new Set(),
    completedIds: {},
    plannedIds: [],
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('confirmed progress scope in the store', () => {
  it('hydrates an assigned scope and sends it as the precondition instead of locking edits', async () => {
    localStorage.setItem(cacheKey, JSON.stringify(initial.completedIds));
    localStorage.setItem(`planned_courses:${alice}`, JSON.stringify([planned]));
    localStorage.setItem(archiveKey, JSON.stringify(backup));
    get.mockResolvedValueOnce(response(merged, curriculum));
    useAppStore.getState().setProgressOwner(alice);
    await useAppStore.getState().loadProgress();
    expect(snapshot()).toEqual(merged);
    expect(useAppStore.getState().progressScope).toEqual({
      userId: alice,
      curriculumId: curriculum,
    });
    expect(useAppStore.getState().progressStatus).toBe('ready');
    expect(useAppStore.getState().browserProgressBackup).toEqual(backup);
    // The owner-keyed cache is the unassigned cache; an assigned snapshot must not overwrite it, or
    // detaching would resurrect the wrong selections.
    expect(localStorage.getItem(cacheKey)).toBe(JSON.stringify(initial.completedIds));
    expect(localStorage.getItem(`planned_courses:${alice}`)).toBe(JSON.stringify([planned]));
    expect(localStorage.getItem(archiveKey)).toBe(JSON.stringify(backup));
    save.mockResolvedValueOnce({ ...merged, uncompletedCourseIds: [] });
    get.mockResolvedValueOnce(response(merged, curriculum));
    await useAppStore.getState().toggleCoursePlanned(planned);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedScope: { userId: alice, curriculumId: curriculum },
      }),
    );
  });

  it('keeps the original legacy disk selections recoverable after visiting an assigned context', async () => {
    localStorage.setItem(cacheKey, JSON.stringify(initial.completedIds));
    localStorage.setItem(`planned_courses:${alice}`, JSON.stringify([planned]));
    get.mockResolvedValueOnce(response(merged, curriculum)).mockResolvedValueOnce(response());
    useAppStore.getState().setProgressOwner(alice);
    await useAppStore.getState().loadProgress();
    expect(snapshot()).toEqual(merged);
    // An assigned snapshot does not prove the server holds the legacy selections, so the marker that
    // suppresses archiving stays unset and detaching still preserves them.
    expect(localStorage.getItem(`server_progress_cache:${alice}`)).toBeNull();
    await useAppStore.getState().loadProgress();
    const original = { completedIds: initial.completedIds, plannedIds: [planned] };
    expect(JSON.parse(localStorage.getItem(archiveKey)!)).toEqual(original);
    expect(useAppStore.getState().browserProgressBackup).toEqual(original);
    expect(useAppStore.getState().progressScope).toEqual(expectedScope);
  });

  it.each([
    { scope: { userId: bob, curriculumId: null }, progress: initial },
    { progress: initial },
    { scope: { userId: alice }, progress: initial },
    { scope: expectedScope, progress: { completedIds: { invalid: null }, plannedIds: [] } },
  ])('does not activate writes from an invalid scoped snapshot %j', async (data) => {
    get.mockResolvedValueOnce({ data: { success: true, data } });
    useAppStore.getState().setProgressOwner(alice);
    await useAppStore.getState().loadProgress();
    expect(useAppStore.getState().progressScope).toBeNull();
    expect(useAppStore.getState().progressStatus).toBe('error');
    await attemptAllWrites();
    expect(save).not.toHaveBeenCalled();
    expect(importProgress).not.toHaveBeenCalled();
    expect(localStorage.getItem(`server_progress_cache:${alice}`)).toBeNull();
  });

  it('requires a confirmed scope even if status and cached selections say ready', async () => {
    useAppStore.getState().setProgressOwner(alice);
    useAppStore.setState({ progressStatus: 'ready', browserProgressBackup: backup, ...initial });
    await attemptAllWrites();
    expect(save).not.toHaveBeenCalled();
    expect(importProgress).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(initial);
  });

  it('sends the completion scope and ignores flat POST data while confirmation is pending', async () => {
    await signIn();
    const confirmation = deferred<ReturnType<typeof response>>();
    save.mockResolvedValueOnce({ ...merged, uncompletedCourseIds: [] });
    get.mockReturnValueOnce(confirmation.promise);
    const saving = useAppStore.getState().toggleCoursePlanned(planned);
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenCalledWith({ courseId: planned, status: 'PLANNED', expectedScope });
    expect(snapshot()).toEqual({ ...initial, plannedIds: [planned] });
    expect(snapshot().completedIds).not.toHaveProperty(archived);
    expect(localStorage.getItem(cacheKey)).toBe(JSON.stringify(initial.completedIds));
    expect(useAppStore.getState().pendingCompletionIds.has(planned)).toBe(true);
    await attemptAllWrites();
    await useAppStore.getState().loadProgress();
    expect(save).toHaveBeenCalledTimes(1);
    expect(importProgress).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(2);
    confirmation.resolve(response({ ...initial, plannedIds: [planned] }));
    await saving;
    expect(useAppStore.getState().pendingCompletionIds.size).toBe(0);
    expect(useAppStore.getState().progressStatus).toBe('ready');
  });

  it('confirms an import with scoped GET before publishing POST selections or retiring the archive', async () => {
    await signIn();
    const confirmation = deferred<ReturnType<typeof response>>();
    importProgress.mockResolvedValueOnce(merged);
    get.mockReturnValueOnce(confirmation.promise);
    const importing = useAppStore.getState().importBrowserProgress();
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(importProgress).toHaveBeenCalledWith({ ...backup, expectedScope });
    expect(snapshot()).toEqual(initial);
    expect(localStorage.getItem(archiveKey)).toBe(JSON.stringify(backup));
    expect(useAppStore.getState().progressImportStatus).toBe('importing');
    await attemptAllWrites();
    await useAppStore.getState().loadProgress();
    expect(importProgress).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(2);
    confirmation.resolve(response(merged));
    await importing;
    expect(snapshot()).toEqual(merged);
    expect(useAppStore.getState().progressImportStatus).toBe('success');
    expect(localStorage.getItem(archiveKey)).toBeNull();
  });

  it.each(['completion', 'import'] as const)(
    'adopts an assignment discovered when confirming %s, keeping the cache and archive intact',
    async (kind) => {
      await signIn();
      get.mockResolvedValueOnce(response(merged, curriculum));
      save.mockResolvedValueOnce({ ...merged, uncompletedCourseIds: [] });
      importProgress.mockResolvedValueOnce(merged);
      if (kind === 'completion') await useAppStore.getState().toggleCoursePlanned(planned);
      else await useAppStore.getState().importBrowserProgress();
      expect(snapshot()).toEqual(merged);
      expect(useAppStore.getState().progressScope).toEqual({
        userId: alice,
        curriculumId: curriculum,
      });
      expect(useAppStore.getState().progressStatus).toBe('ready');
      // The unassigned cache is never written from a contextual confirmation.
      expect(localStorage.getItem(cacheKey)).toBe(JSON.stringify(initial.completedIds));
      // A confirmed import retires its archive because its selections are now stored; a completion
      // leaves it, since the archive was never the thing being saved.
      expect(localStorage.getItem(archiveKey)).toBe(
        kind === 'import' ? null : JSON.stringify(backup),
      );
      expect(useAppStore.getState().pendingCompletionIds.size).toBe(0);
      expect(get).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['completion', 'import'] as const)(
    'adopts an assignment found in the scoped recovery of a failed %s',
    async (kind) => {
      await signIn();
      get.mockResolvedValueOnce(response(merged, curriculum));
      if (kind === 'completion') {
        save.mockRejectedValueOnce(new Error('Connection lost'));
        await useAppStore.getState().toggleCoursePlanned(planned);
      } else {
        importProgress.mockRejectedValueOnce(new Error('Connection lost'));
        await useAppStore.getState().importBrowserProgress();
      }
      // Recovery is what proves the server state, so the assigned snapshot becomes the store's scope
      // and its selections are published rather than discarded.
      expect(snapshot()).toEqual(merged);
      expect(useAppStore.getState().progressScope).toEqual({
        userId: alice,
        curriculumId: curriculum,
      });
      expect(useAppStore.getState().progressStatus).toBe('ready');
      expect(localStorage.getItem(cacheKey)).toBe(JSON.stringify(initial.completedIds));
      expect(localStorage.getItem(archiveKey)).toBe(JSON.stringify(backup));
      expect(useAppStore.getState().pendingCompletionIds.size).toBe(0);
    },
  );

  it('keeps the archive after lost import response even when scoped recovery confirms the merged state', async () => {
    await signIn();
    importProgress.mockRejectedValueOnce(new Error('Connection lost'));
    get.mockResolvedValueOnce(response(merged));
    await useAppStore.getState().importBrowserProgress();
    expect(snapshot()).toEqual(merged);
    expect(useAppStore.getState().progressStatus).toBe('ready');
    expect(useAppStore.getState().progressImportStatus).toBe('error');
    expect(useAppStore.getState().browserProgressBackup).toEqual(backup);
    expect(localStorage.getItem(archiveKey)).toBe(JSON.stringify(backup));
    expect(importProgress).toHaveBeenCalledWith({ ...backup, expectedScope });
  });

  it('withholds edits and archive retirement if both confirmation and recovery reads fail', async () => {
    await signIn();
    importProgress.mockResolvedValueOnce(merged);
    get
      .mockRejectedValueOnce(new Error('Confirmation offline'))
      .mockRejectedValueOnce(new Error('Recovery offline'));
    await useAppStore.getState().importBrowserProgress();
    expect(snapshot()).toEqual(initial);
    expect(useAppStore.getState().progressStatus).toBe('error');
    expect(localStorage.getItem(archiveKey)).toBe(JSON.stringify(backup));
    await attemptAllWrites();
    expect(save).not.toHaveBeenCalled();
    expect(importProgress).toHaveBeenCalledTimes(1);
  });

  it.each([{ scope: { userId: bob, curriculumId: null }, progress: merged }, { progress: merged }])(
    'cannot retire an import archive using invalid confirmation or recovery %j',
    async (data) => {
      await signIn();
      importProgress.mockResolvedValueOnce(merged);
      get.mockResolvedValue({ data: { success: true, data } });
      await useAppStore.getState().importBrowserProgress();
      expect(snapshot()).toEqual(initial);
      expect(useAppStore.getState().progressStatus).toBe('error');
      expect(localStorage.getItem(archiveKey)).toBe(JSON.stringify(backup));
      expect(localStorage.getItem(cacheKey)).toBe(JSON.stringify(initial.completedIds));
      await attemptAllWrites();
      expect(save).not.toHaveBeenCalled();
      expect(importProgress).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['completion', 'import'] as const)(
    'ignores late %s confirmation after A to B to A without removing the archive',
    async (kind) => {
      await signIn();
      const confirmation = deferred<ReturnType<typeof response>>();
      get.mockReturnValueOnce(confirmation.promise);
      save.mockResolvedValueOnce({ ...merged, uncompletedCourseIds: [] });
      importProgress.mockResolvedValueOnce(merged);
      const pending =
        kind === 'completion'
          ? useAppStore.getState().toggleCoursePlanned(planned)
          : useAppStore.getState().importBrowserProgress();
      await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
      useAppStore.getState().setProgressOwner(bob);
      useAppStore.getState().setProgressOwner(alice);
      const before = snapshot();
      confirmation.resolve(response(merged));
      await pending;
      expect(snapshot()).toEqual(before);
      expect(useAppStore.getState().progressStatus).toBe('idle');
      expect(useAppStore.getState().progressScope).toBeNull();
      expect(localStorage.getItem(cacheKey)).toBe(JSON.stringify(initial.completedIds));
      expect(localStorage.getItem(archiveKey)).toBe(JSON.stringify(backup));
      const writes = save.mock.calls.length + importProgress.mock.calls.length;
      await attemptAllWrites();
      expect(save.mock.calls.length + importProgress.mock.calls.length).toBe(writes);
    },
  );

  it('overwrites a stale archived expectedScope with the freshly confirmed scope', async () => {
    await signIn(
      JSON.stringify({ ...backup, expectedScope: { userId: bob, curriculumId: curriculum } }),
    );
    importProgress.mockResolvedValueOnce(merged);
    get.mockResolvedValueOnce(response(merged));
    await useAppStore.getState().importBrowserProgress();
    expect(importProgress).toHaveBeenCalledWith({ ...backup, expectedScope });
    expect(useAppStore.getState().progressImportStatus).toBe('success');
  });
});
