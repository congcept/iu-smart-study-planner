import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScopedStudentProgressDTO, StudentProgressDTO } from '@iu-study-planner/shared';
import { importStudentProgress } from '@/lib/api';
import { getScopedStudentProgress } from '@/lib/scopedProgressApi';
import { useAppStore } from '@/lib/store';
import type { Course } from '@/types';
import { ArchivedProgressImport } from '../ArchivedProgressImport';

vi.mock('@/lib/api', () => ({
  importStudentProgress: vi.fn(),
  saveCourseProgress: vi.fn(),
}));
vi.mock('@/lib/scopedProgressApi', () => ({ getScopedStudentProgress: vi.fn() }));
vi.mock('@/lib/sounds', () => ({
  playCompleteSound: vi.fn(),
  playUncompleteSound: vi.fn(),
  playPlanSound: vi.fn(),
  playUnplanSound: vi.fn(),
}));

const prerequisiteId = '00000000-0000-4000-8000-000000000001';
const electiveId = '00000000-0000-4000-8000-000000000002';
const plannedId = '00000000-0000-4000-8000-000000000003';
const existingId = '00000000-0000-4000-8000-000000000004';
const unavailableId = '00000000-0000-4000-8000-000000000005';
const backup: StudentProgressDTO = {
  completedIds: { [electiveId]: 'Group 2' },
  plannedIds: [plannedId],
};
const initial: StudentProgressDTO = {
  completedIds: { [prerequisiteId]: null },
  plannedIds: [],
};
const merged: StudentProgressDTO = {
  completedIds: { [prerequisiteId]: null, [electiveId]: 'Group 2' },
  plannedIds: [plannedId],
};
const getProgress = vi.mocked(getScopedStudentProgress);
const importProgress = vi.mocked(importStudentProgress);

function course(id: string, code: string, name: string, overrides: Partial<Course> = {}): Course {
  return {
    id,
    code,
    name,
    credits: 3,
    difficultyLevel: 2,
    category: 'REQUIRED',
    semesterOffered: ['FALL'],
    prerequisites: [],
    isPrerequisiteFor: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}
const courses = [
  course(prerequisiteId, 'MA001IU', 'Calculus 1'),
  course(electiveId, 'IT160IU', 'Data Mining', { electiveGroup: 'Group 2' }),
  course(plannedId, 'IT161IU', 'Machine Learning'),
  course(existingId, 'IT162IU', 'Saved Course'),
];

function scoped(progress: StudentProgressDTO, userId = 'alice'): ScopedStudentProgressDTO {
  return { scope: { userId, curriculumId: null }, progress };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
async function signIn(
  archive: StudentProgressDTO = backup,
  progress: StudentProgressDTO = initial,
  owner = 'alice',
) {
  localStorage.setItem(`browser_progress_backup:${owner}`, JSON.stringify(archive));
  getProgress.mockResolvedValueOnce(scoped(progress, owner));
  useAppStore.getState().setProgressOwner(owner);
  await useAppStore.getState().loadProgress();
}
function show(courseList = courses, userId = 'alice') {
  return render(<ArchivedProgressImport userId={userId} courses={courseList} />);
}
function review() {
  fireEvent.click(screen.getByRole('button', { name: 'Review selections' }));
  return screen.getByRole('button', { name: 'Import selections' });
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
    progressScope: null,
    progressStatus: 'ready',
    progressError: null,
    browserProgressBackup: null,
    browserProgressBackupError: null,
    progressImportStatus: 'idle',
    progressImportError: null,
    pendingCompletionIds: new Set(),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('archived browser selection review', () => {
  it('requires an explicit review and import click after hydration, then saves the full snapshot', async () => {
    await signIn();
    importProgress.mockResolvedValueOnce(merged);
    getProgress.mockResolvedValueOnce(scoped(merged));
    show();
    expect(
      screen.getByText('1 completed and 1 planned courses are backed up for this account.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import selections' })).toBeNull();
    expect(screen.queryByText('Data Mining')).toBeNull();
    expect(importProgress).not.toHaveBeenCalled();

    const importButton = review();
    expect(importButton).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Completed courses (1)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Planned courses (1)' })).toBeInTheDocument();
    expect(screen.getByText('Elective claim: Group 2.')).toBeInTheDocument();
    expect(importProgress).not.toHaveBeenCalled();
    fireEvent.click(importButton);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Earlier selections imported. Your account progress is saved.',
      ),
    );
    expect(importProgress).toHaveBeenCalledExactlyOnceWith({
      ...backup,
      expectedScope: { userId: 'alice', curriculumId: null },
    });
    expect(useAppStore.getState().completedIds).toEqual(merged.completedIds);
    expect(useAppStore.getState().plannedIds).toEqual(merged.plannedIds);
    expect(localStorage.getItem('browser_progress_backup:alice')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import selections' })).toBeNull();
  });

  it('explains existing grade and claim preservation and planned record precedence', async () => {
    const archive: StudentProgressDTO = {
      completedIds: { [electiveId]: 'Group 2', [existingId]: null },
      plannedIds: [prerequisiteId, plannedId],
    };
    await signIn(archive, {
      completedIds: { [electiveId]: 'Group 3', [existingId]: null, [prerequisiteId]: null },
      plannedIds: [plannedId],
    });
    show([...courses, { ...courses[1], electiveGroup: 'Group 3' }]);
    review();
    expect(
      screen.getByText(/Existing course records, grades, and completed elective claims are kept/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Already completed. Saved claim: Group 3. Existing grades and claim are kept.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Already completed. No saved elective claim. Existing grades and claim are kept.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Already completed; kept completed.')).toBeInTheDocument();
    expect(screen.getByText('Already planned; unchanged.')).toBeInTheDocument();
    expect(importProgress).not.toHaveBeenCalled();
  });

  it.each([
    { isStrict: true, isCorequisite: false },
    { isStrict: false, isCorequisite: false },
    { isStrict: false, isCorequisite: true },
  ])('blocks unmet prerequisites with flags %j even when they are planned', async (flags) => {
    await signIn(backup, { completedIds: {}, plannedIds: [prerequisiteId] });
    const dependent = {
      ...courses[1],
      prerequisites: [{ id: 'edge', courseId: electiveId, prerequisiteId, ...flags }],
    };
    show([courses[0], dependent, courses[2]]);
    const importButton = review();
    expect(
      screen.getByText('Complete prerequisite MA001IU: Calculus 1 before importing.'),
    ).toBeInTheDocument();
    expect(importButton).toBeDisabled();
    fireEvent.click(importButton);
    expect(importProgress).not.toHaveBeenCalled();
    expect(localStorage.getItem('browser_progress_backup:alice')).toBe(JSON.stringify(backup));
  });

  it.each(['saved', 'archived'])(
    'accepts mandatory prerequisites supplied by %s completed selections',
    async (source) => {
      const archive =
        source === 'archived'
          ? { ...backup, completedIds: { ...backup.completedIds, [prerequisiteId]: null } }
          : backup;
      await signIn(archive, source === 'saved' ? initial : { completedIds: {}, plannedIds: [] });
      show([
        courses[0],
        {
          ...courses[1],
          prerequisites: [
            {
              id: 'edge',
              courseId: electiveId,
              prerequisiteId,
              isStrict: false,
              isCorequisite: true,
            },
          ],
        },
        courses[2],
      ]);
      expect(review()).toBeEnabled();
      expect(screen.queryByText(/Complete prerequisite/)).toBeNull();
    },
  );

  it.each(['completed', 'planned'])(
    'shows unavailable %s IDs and blocks the whole import',
    async (kind) => {
      const archive: StudentProgressDTO =
        kind === 'completed'
          ? { completedIds: { [unavailableId]: null }, plannedIds: [] }
          : { completedIds: {}, plannedIds: [unavailableId] };
      await signIn(archive);
      show();
      const importButton = review();
      expect(screen.getByText('Unavailable course')).toBeInTheDocument();
      expect(screen.getByText(unavailableId)).toBeInTheDocument();
      expect(
        screen.getByText('This course is unavailable in the current curriculum.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Your backup has been kept.');
      expect(importButton).toBeDisabled();
      fireEvent.click(importButton);
      expect(importProgress).not.toHaveBeenCalled();
    },
  );

  it('blocks invalid elective claims without silently rewriting them', async () => {
    const archive = { ...backup, completedIds: { [electiveId]: 'Group 9' } };
    await signIn(archive);
    show();
    expect(review()).toBeDisabled();
    expect(
      screen.getByText('The archived elective claim “Group 9” is not available for this course.'),
    ).toBeInTheDocument();
    expect(useAppStore.getState().browserProgressBackup).toEqual(archive);
    expect(importProgress).not.toHaveBeenCalled();
  });

  it('accepts a claim from any duplicate elective membership even when another group appears last', async () => {
    await signIn();
    show([...courses, { ...courses[1], electiveGroup: 'Group 3' }]);
    expect(review()).toBeEnabled();
    expect(screen.getByText('Elective claim: Group 2.')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Archived course selections' })).getAllByText(
        'IT160IU',
      ),
    ).toHaveLength(1);
  });

  it('explains unclaimed elective completion without assigning a group', async () => {
    await signIn({ ...backup, completedIds: { [electiveId]: null } });
    show();
    expect(review()).toBeEnabled();
    expect(
      screen.getByText(
        'No elective group assigned; this completion will not count toward an elective group.',
      ),
    ).toBeInTheDocument();
    expect(useAppStore.getState().browserProgressBackup?.completedIds[electiveId]).toBeNull();
  });

  it.each(['before review', 'after review'])(
    'Later %s preserves the archive and allows another review',
    async (stage) => {
      await signIn();
      show();
      if (stage === 'after review') review();
      fireEvent.click(screen.getByRole('button', { name: 'Later' }));
      expect(
        screen.getByText('Your backup is kept. Review it whenever you are ready.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Import selections' })).toBeNull();
      expect(localStorage.getItem('browser_progress_backup:alice')).toBe(JSON.stringify(backup));
      expect(useAppStore.getState().browserProgressBackup).toEqual(backup);
      expect(review()).toBeEnabled();
      expect(importProgress).not.toHaveBeenCalled();
    },
  );

  it('hides another owner’s archive and ignores an import response after switching owners', async () => {
    await signIn();
    const { rerender } = show(courses, 'bob');
    expect(screen.queryByText('Earlier selections in this browser')).toBeNull();
    rerender(<ArchivedProgressImport userId="alice" courses={courses} />);
    const request = deferred<StudentProgressDTO>();
    importProgress.mockReturnValueOnce(request.promise);
    fireEvent.click(review());
    act(() => useAppStore.getState().setProgressOwner('bob'));
    expect(screen.queryByRole('region', { name: 'Archived course selections' })).toBeNull();
    await act(async () => request.resolve(merged));
    expect(useAppStore.getState().progressOwnerId).toBe('bob');
    expect(useAppStore.getState().completedIds).toEqual({});
    expect(localStorage.getItem('browser_progress_backup:alice')).toBe(JSON.stringify(backup));
    expect(screen.queryByText(/Earlier selections imported/)).toBeNull();
  });

  it.each(['hydrating', 'saving'])(
    'keeps review available but disables import while %s',
    async (activity) => {
      await signIn();
      useAppStore.setState(
        activity === 'hydrating'
          ? { progressStatus: 'loading' }
          : { pendingCompletionIds: new Set([existingId]) },
      );
      show();
      expect(review()).toBeDisabled();
      expect(
        screen.getByText('Wait until your saved progress is ready before importing.'),
      ).toBeInTheDocument();
      expect(importProgress).not.toHaveBeenCalled();
      act(() => useAppStore.setState({ progressStatus: 'ready', pendingCompletionIds: new Set() }));
      expect(screen.getByRole('button', { name: 'Import selections' })).toBeEnabled();
    },
  );

  it('disables repeat import and Later while importing and retains preview until confirmation', async () => {
    await signIn();
    const request = deferred<StudentProgressDTO>();
    const confirmation = deferred<ScopedStudentProgressDTO>();
    importProgress.mockReturnValueOnce(request.promise);
    getProgress.mockReturnValueOnce(confirmation.promise);
    show();
    fireEvent.click(review());
    expect(screen.getByRole('button', { name: 'Import selections' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled();
    expect(
      screen.getByRole('region', { name: 'Earlier selections in this browser' }),
    ).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Importing selections and checking saved progress',
    );
    expect(screen.getByRole('region', { name: 'Archived course selections' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import selections' }));
    expect(importProgress).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('browser_progress_backup:alice')).toBe(JSON.stringify(backup));
    await act(async () => request.resolve(merged));
    expect(getProgress).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().completedIds).toEqual(initial.completedIds);
    expect(localStorage.getItem('browser_progress_backup:alice')).toBe(JSON.stringify(backup));
    expect(screen.getByRole('button', { name: 'Import selections' })).toBeDisabled();
    await act(async () => confirmation.resolve(scoped(merged)));
    expect(screen.getByRole('status')).toHaveTextContent('Earlier selections imported.');
  });

  it('keeps the reviewed preview and archive on failure, then permits an explicit retry after recovery', async () => {
    await signIn();
    importProgress
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce(merged);
    const recovery = deferred<ScopedStudentProgressDTO>();
    getProgress.mockReturnValueOnce(recovery.promise);
    show();
    fireEvent.click(review());
    await waitFor(() => expect(getProgress).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Import selections' })).toBeDisabled();
    await act(async () => recovery.resolve(scoped(initial)));
    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost');
    expect(screen.getByRole('alert')).toHaveTextContent('Your backup has been kept');
    expect(screen.getByRole('region', { name: 'Archived course selections' })).toBeInTheDocument();
    expect(localStorage.getItem('browser_progress_backup:alice')).toBe(JSON.stringify(backup));
    expect(screen.getByRole('button', { name: 'Import selections' })).toBeEnabled();
    getProgress.mockResolvedValueOnce(scoped(merged));
    fireEvent.click(screen.getByRole('button', { name: 'Import selections' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Earlier selections imported.'),
    );
    expect(importProgress).toHaveBeenCalledTimes(2);
    expect(importProgress).toHaveBeenNthCalledWith(2, {
      ...backup,
      expectedScope: { userId: 'alice', curriculumId: null },
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('review keyboard focus', () => {
  it('moves focus into review and restores the review button after Later', async () => {
    useAppStore.setState({
      progressOwnerId: 'focus-owner',
      progressScope: { userId: 'focus-owner', curriculumId: null },
      progressStatus: 'ready',
      browserProgressBackup: backup,
      browserProgressBackupError: null,
      progressImportStatus: 'idle',
      progressImportError: null,
      completedIds: initial.completedIds,
      plannedIds: [],
      pendingCompletionIds: new Set(),
    });
    render(<ArchivedProgressImport userId="focus-owner" courses={courses} />);
    const reviewButton = screen.getByRole('button', { name: 'Review selections' });
    reviewButton.focus();
    fireEvent.click(reviewButton);
    expect(screen.getByRole('region', { name: 'Review earlier selections' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.getByRole('button', { name: 'Review selections' })).toHaveFocus();
  });
});
