import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';
import {
  getSavedReferenceSelection,
  saveReferenceSelection,
} from '@/lib/savedStudyPlanReferenceSelectionApi';
import { SavedStudyPlanCoursesSessionChangedError } from '@/lib/savedStudyPlanCoursesApi';
import { referenceSelectionDraftKey } from '@/lib/savedReferenceSelectionDraft';
import { referenceId, ownerId } from '@/test/fixtures/curriculumReference';
import { savedCourseId, savedPlanId, savedSemesterId } from '@/test/fixtures/savedStudyPlanCourses';
import {
  referenceSelectionBody,
  referenceSelectionState,
  referenceSelectionResult,
  referenceSelectionScope,
  extraSelectionCourseId,
} from '@/test/fixtures/savedReferenceSelection';
import { SavedReferenceSelectionEditor } from '../SavedReferenceSelectionEditor';

vi.mock('@/lib/savedStudyPlanReferenceSelectionApi', () => ({
  getSavedReferenceSelection: vi.fn(),
  saveReferenceSelection: vi.fn(),
}));
const read = vi.mocked(getSavedReferenceSelection);
const save = vi.mocked(saveReferenceSelection);
const props = { ...referenceSelectionScope, onInvalidated: vi.fn(), onSnapshot: vi.fn() };
const key = `pending_reference_selection:${ownerId}:${savedPlanId}:${savedSemesterId}`;
const draftKey = referenceSelectionDraftKey(referenceSelectionScope);
const storedDraft = (baseRevision = 0) => ({
  version: 1,
  ownerId,
  curriculumId: referenceId,
  planId: savedPlanId,
  semesterId: savedSemesterId,
  baseRevision,
  draft: { year: '2', semester: '1', courseIds: [extraSelectionCourseId, savedCourseId] },
});
const recovery = (body = referenceSelectionBody()) => ({
  planId: savedPlanId,
  semesterId: savedSemesterId,
  body,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit saved course selection' }));
  await screen.findByLabelText('Selection academic year');
}
function slot() {
  fireEvent.change(screen.getByLabelText('Selection academic year'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Selection academic semester'), {
    target: { value: '1' },
  });
}
function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Save course selection' }));
}
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  read.mockImplementation(async () =>
    referenceSelectionState(Math.max(0, read.mock.calls.length - 1)),
  );
  save.mockImplementation(async (_scope, body) => referenceSelectionResult(body));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('saved reference selection editing', () => {
  it('rejects a scoped adapter response for another semester before publishing any snapshot', async () => {
    const value = referenceSelectionState();
    value.snapshot.semester.id = referenceId;
    read.mockResolvedValue(value);
    render(<SavedReferenceSelectionEditor {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit saved course selection' }));
    await waitFor(() => expect(props.onInvalidated).toHaveBeenCalledWith('account'));
    expect(props.onSnapshot).not.toHaveBeenCalled();
  });
  it('prevents adding beyond 100 selected courses', async () => {
    const value = referenceSelectionState();
    const ids = Array.from(
      { length: 100 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    value.snapshot.courseReferences = {
      status: 'RECOGNIZED',
      order: 'STORED_ARRAY_ORDER',
      entries: ids.map((courseId, index) => ({
        courseId,
        storedPosition: index,
        catalog: { code: `C${index}`, name: `Course ${index}` },
        currentCurriculumMembership: 'PLACED_MEMBER',
      })),
    };
    value.editing = {
      status: 'AVAILABLE',
      courses: [
        ...ids.map((id, index) => ({ id, code: `C${index}`, name: `Course ${index}` })),
        { id: extraSelectionCourseId, code: 'NEW', name: 'Additional course' },
      ],
    };
    read.mockResolvedValue(value);
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    fireEvent.change(screen.getByLabelText('Add a current curriculum course'), {
      target: { value: extraSelectionCourseId },
    });
    expect(screen.getByRole('button', { name: 'Add course' })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
  it.each(['planId', 'semesterId'] as const)(
    'blocks a copied recovery envelope with a different %s',
    async (field) => {
      sessionStorage.setItem(key, JSON.stringify({ ...recovery(), [field]: referenceId }));
      render(<SavedReferenceSelectionEditor {...props} />);
      await open();
      expect(
        screen.getByText(/Browser recovery data is unavailable or invalid/),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Selection academic year')).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Retry the same save' })).not.toBeInTheDocument();
      expect(save).not.toHaveBeenCalled();
    },
  );
  it('retains acknowledged recovery until a fresh read reaches its saved revision', async () => {
    read
      .mockResolvedValueOnce(referenceSelectionState(0))
      .mockResolvedValueOnce(referenceSelectionState(0))
      .mockResolvedValueOnce(referenceSelectionState(5));
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    slot();
    submit();
    await screen.findByText(/Could not confirm the latest selection/);
    expect(sessionStorage.getItem(key)).not.toBeNull();
    expect(props.onSnapshot).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reload selection for editing' }));
    await screen.findByText(/Last acknowledged save/);
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(props.onSnapshot).toHaveBeenLastCalledWith(referenceSelectionState(5).snapshot);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('requires an explicit open and slot; never infers a slot or saves automatically', async () => {
    render(<SavedReferenceSelectionEditor {...props} />);
    expect(read).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    await open();
    expect(screen.getByLabelText('Selection academic year')).toHaveValue(null);
    expect(screen.getByLabelText('Selection academic semester')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save course selection' })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
  it('adds only current choices, preserves order, then reconciles with fresh state instead of the acknowledgement', async () => {
    const newer = referenceSelectionState();
    newer.revision = 7;
    if (newer.snapshot.courseReferences.status === 'RECOGNIZED')
      newer.snapshot.courseReferences.entries = [];
    read.mockResolvedValueOnce(referenceSelectionState()).mockResolvedValueOnce(newer);
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    slot();
    fireEvent.change(screen.getByLabelText('Add a current curriculum course'), {
      target: { value: extraSelectionCourseId },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add course' }));
    submit();
    await screen.findByText(/Last acknowledged save: 2 courses/);
    const body = save.mock.calls[0][1];
    expect(body.courseIds).toEqual([savedCourseId, extraSelectionCourseId]);
    expect(body.expectedScope).toEqual({ userId: ownerId, curriculumId: referenceId });
    expect(body.expectedRevision).toBe(0);
    expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(props.onSnapshot).toHaveBeenLastCalledWith(newer.snapshot);
    expect(
      screen.getByText(
        'Selected courses: 0 of 100. Existing order is retained; newly added courses follow it.',
      ),
    ).toBeInTheDocument();
    expect(sessionStorage.getItem(key)).toBeNull();
  });
  it('locks unresolved saves and retries exactly the same key, revision, slot and ordered IDs', async () => {
    save
      .mockRejectedValueOnce(new Error('lost reply'))
      .mockImplementationOnce(async (_scope, body) => ({
        ...referenceSelectionResult(body),
        replayed: true,
      }));
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    slot();
    submit();
    await screen.findByText(/Could not confirm whether this selection was saved/);
    const first = save.mock.calls[0][1];
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(recovery(first));
    expect(screen.getByLabelText('Selection academic year')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry the same save' }));
    await screen.findByText(/Selection saved. The latest/);
    expect(save.mock.calls[1][1]).toEqual(first);
    expect(sessionStorage.getItem(key)).toBeNull();
  });
  it('restores an account-scoped pending operation without replaying automatically', async () => {
    const pending = referenceSelectionBody();
    sessionStorage.setItem(key, JSON.stringify(recovery(pending)));
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    await screen.findByText(/A previous save is unresolved/);
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Selection academic year')).toHaveValue(2);
    expect(screen.getByLabelText('Selection academic year')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry the same save' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][1]).toEqual(pending);
  });
  it('keeps the immutable old context for explicit same-account recovery', async () => {
    const pending = referenceSelectionBody();
    sessionStorage.setItem(key, JSON.stringify(recovery(pending)));
    const current = referenceSelectionState();
    current.snapshot.scope.curriculumId = savedPlanId;
    read.mockResolvedValueOnce(current).mockResolvedValue({ ...current, revision: 1 });
    render(<SavedReferenceSelectionEditor {...props} expectedCurriculumId={savedPlanId} />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Retry the same save' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].expectedCurriculumId).toBe(savedPlanId);
    expect(save.mock.calls[0][1].expectedScope.curriculumId).toBe(referenceId);
  });
  it('requires a fresh read after acknowledgement before unlocking or clearing recovery', async () => {
    const fresh = deferred<ReturnType<typeof referenceSelectionState>>();
    read.mockResolvedValueOnce(referenceSelectionState()).mockReturnValueOnce(fresh.promise);
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    slot();
    submit();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(sessionStorage.getItem(key)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save course selection' })).toBeDisabled();
    await act(async () => fresh.resolve(referenceSelectionState(1)));
    await screen.findByText(/Last acknowledged save/);
    expect(sessionStorage.getItem(key)).toBeNull();
  });
  it('keeps an acknowledged request when refresh fails, then clears it only after explicit successful reload', async () => {
    read
      .mockResolvedValueOnce(referenceSelectionState())
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockResolvedValueOnce(referenceSelectionState(1));
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    slot();
    submit();
    await screen.findByText(/Could not confirm the latest selection/);
    expect(sessionStorage.getItem(key)).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry the same save' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload selection for editing' }));
    await screen.findByText(/Selection saved. The latest/);
    expect(save).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(key)).toBeNull();
  });
  it('resolves a confirmed rejection only after fresh GET, preserving recovery if that read fails', async () => {
    const rejection = new AxiosError('rejected');
    rejection.response = { status: 409 } as NonNullable<AxiosError['response']>;
    save.mockRejectedValue(rejection);
    read
      .mockResolvedValueOnce(referenceSelectionState())
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(referenceSelectionState(1));
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    slot();
    submit();
    await screen.findByText(/Could not confirm the latest selection/);
    expect(sessionStorage.getItem(key)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload selection for editing' }));
    await screen.findByText(
      /The save could not be confirmed. The latest saved courses have been reloaded/,
    );
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(screen.getByLabelText('Selection academic year')).toBeEnabled();
  });
  it('retains the request and invalidates parent evidence on a failed session', async () => {
    save.mockRejectedValue(new SavedStudyPlanCoursesSessionChangedError());
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    slot();
    submit();
    await waitFor(() => expect(props.onInvalidated).toHaveBeenCalledWith('account'));
    expect(sessionStorage.getItem(key)).not.toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('hides parent evidence on an unavailable edit read', async () => {
    read.mockRejectedValue(new SavedStudyPlanCoursesSessionChangedError());
    render(<SavedReferenceSelectionEditor {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit saved course selection' }));
    await waitFor(() => expect(props.onInvalidated).toHaveBeenCalledWith('account'));
    expect(save).not.toHaveBeenCalled();
  });
  it('does not send a new request if recovery storage cannot retain it', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: vi.fn(),
    });
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    slot();
    submit();
    await screen.findByText(/No new request was submitted/);
    expect(save).not.toHaveBeenCalled();
  });
  it('blocks editing when storage is denied or corrupt instead of forgetting an unresolved request', async () => {
    sessionStorage.setItem(key, '{invalid');
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    expect(screen.getByText(/Browser recovery data is unavailable or invalid/)).toBeInTheDocument();
    expect(screen.getByLabelText('Selection academic year')).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
  it('distinguishes an unassigned account from an editable empty selection', async () => {
    const value = referenceSelectionState();
    value.snapshot.scope.curriculumId = null;
    if (value.snapshot.courseReferences.status === 'RECOGNIZED')
      value.snapshot.courseReferences.entries[0].currentCurriculumMembership =
        'NO_ASSIGNED_CURRICULUM';
    value.editing = { status: 'UNAVAILABLE', reason: 'NO_ASSIGNED_CURRICULUM' };
    read.mockResolvedValue(value);
    render(<SavedReferenceSelectionEditor {...props} expectedCurriculumId={null} />);
    await open();
    expect(
      screen.getByText(/No curriculum is assigned. Course selection editing is unavailable/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save course selection' })).toBeDisabled();
  });
  it('requires explicit removal of a saved course outside current choices', async () => {
    const value = referenceSelectionState();
    value.editing = { status: 'AVAILABLE', courses: [] };
    read.mockResolvedValue(value);
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    slot();
    expect(screen.getByText(/Not available in current curriculum choices/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save course selection' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected course 1' }));
    expect(screen.getByText(/Saving will store an empty course list/)).toBeInTheDocument();
    submit();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][1].courseIds).toEqual([]);
  });
  it('ignores a late read after scope remount and never exposes another account journal', async () => {
    sessionStorage.setItem(key, JSON.stringify(recovery()));
    const late = deferred<ReturnType<typeof referenceSelectionState>>();
    read.mockReturnValueOnce(late.promise);
    const view = render(<SavedReferenceSelectionEditor {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit saved course selection' }));
    view.rerender(<SavedReferenceSelectionEditor {...props} ownerId={savedPlanId} />);
    await act(async () => late.resolve(referenceSelectionState()));
    expect(props.onSnapshot).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retry the same save' })).not.toBeInTheDocument();
    expect(sessionStorage.getItem(key)).not.toBeNull();
  });
  it('retains a sent request after unmount and ignores its late acknowledgement', async () => {
    const late = deferred<ReturnType<typeof referenceSelectionResult>>();
    save.mockReturnValueOnce(late.promise);
    const view = render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    slot();
    submit();
    view.unmount();
    const body = save.mock.calls[0][1];
    await act(async () => late.resolve(referenceSelectionResult(body)));
    expect(sessionStorage.getItem(key)).not.toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('blocks fractional years and never sends an earlier slot after batched draft changes', async () => {
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    slot();
    fireEvent.change(screen.getByLabelText('Selection academic year'), {
      target: { value: '2.5' },
    });
    expect(screen.getByRole('button', { name: 'Save course selection' })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
    const form = screen.getByRole('button', { name: 'Save course selection' }).closest('form')!;
    act(() => {
      fireEvent.change(screen.getByLabelText('Selection academic year'), {
        target: { value: '3' },
      });
      fireEvent.submit(form);
    });
    if (save.mock.calls.length) {
      expect(save.mock.calls[0][1].academicYear).toBe(3);
      await screen.findByText(/Selection saved. The latest/);
    }
  });
  it('blocks double save handlers while the immutable operation is in flight', async () => {
    const late = deferred<ReturnType<typeof referenceSelectionResult>>();
    save.mockReturnValueOnce(late.promise);
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    slot();
    act(() => {
      submit();
      submit();
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => late.resolve(referenceSelectionResult(save.mock.calls[0][1])));
  });
});

describe('unsent draft recovery', () => {
  beforeEach(() => read.mockResolvedValue(referenceSelectionState(0)));
  it('keeps another current-context draft when explicitly recovering an older-context sent save', async () => {
    const body = referenceSelectionBody();
    sessionStorage.setItem(key, JSON.stringify(recovery(body)));
    const newScope = { ...referenceSelectionScope, expectedCurriculumId: savedPlanId };
    const newKey = referenceSelectionDraftKey(newScope);
    const retained = { ...storedDraft(1), curriculumId: savedPlanId };
    sessionStorage.setItem(newKey, JSON.stringify(retained));
    const current = referenceSelectionState(0);
    current.snapshot.scope.curriculumId = savedPlanId;
    read.mockResolvedValueOnce(current).mockResolvedValueOnce({ ...current, revision: 1 });
    render(<SavedReferenceSelectionEditor {...props} expectedCurriculumId={savedPlanId} />);
    await open();
    expect(screen.queryByRole('button', { name: 'Restore unsent draft' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry the same save' }));
    await screen.findByText(/Last acknowledged save/);
    expect(save.mock.calls[0][1]).toEqual(body);
    expect(JSON.parse(sessionStorage.getItem(newKey)!)).toEqual(retained);
    expect(screen.getByRole('button', { name: 'Restore unsent draft' })).toBeInTheDocument();
    expect(screen.getByLabelText('Selection academic year')).toHaveValue(null);
  });
  it('keeps pending-save recovery usable when unsent-draft storage cannot be read', async () => {
    sessionStorage.setItem(key, JSON.stringify(recovery()));
    const backing = sessionStorage;
    vi.stubGlobal('sessionStorage', {
      getItem: (storageKey: string) => {
        if (storageKey === draftKey) throw new Error('denied draft');
        return backing.getItem(storageKey);
      },
      setItem: backing.setItem.bind(backing),
      removeItem: backing.removeItem.bind(backing),
    });
    read
      .mockResolvedValueOnce(referenceSelectionState(0))
      .mockResolvedValueOnce(referenceSelectionState(1));
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Retry the same save' }));
    await screen.findByText(/Last acknowledged save/);
    expect(backing.getItem(key)).toBeNull();
    expect(screen.getByText(/Unsent draft recovery could not be read/)).toBeInTheDocument();
    expect(screen.getByLabelText('Selection academic year')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Discard unsent draft' })).not.toBeInTheDocument();
  });
  it('retains partial edits and course order across unmount, then requires explicit fresh restore', async () => {
    const view = render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    fireEvent.change(screen.getByLabelText('Selection academic year'), {
      target: { value: '2.5' },
    });
    fireEvent.change(screen.getByLabelText('Add a current curriculum course'), {
      target: { value: extraSelectionCourseId },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add course' }));
    const retained = JSON.parse(sessionStorage.getItem(draftKey)!);
    expect(retained).toEqual({
      ...storedDraft(),
      draft: { year: '2.5', semester: '', courseIds: [savedCourseId, extraSelectionCourseId] },
    });
    view.unmount();
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    expect(screen.getByLabelText('Selection academic year')).toHaveValue(null);
    expect(screen.getByLabelText('Selection academic year')).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Restore unsent draft' }));
    await screen.findByText(/Unsent draft restored after checking/);
    expect(read).toHaveBeenCalledTimes(3);
    expect(screen.getByLabelText('Selection academic year')).toHaveValue(2.5);
    expect(screen.getByLabelText('Selection academic semester')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save course selection' })).toBeDisabled();
    expect(sessionStorage.getItem(draftKey)).not.toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
  it('offers stale drafts for discard only and preserves another selection’s draft', async () => {
    const otherKey = referenceSelectionDraftKey({
      ...referenceSelectionScope,
      semesterId: referenceId,
    });
    sessionStorage.setItem(otherKey, 'separate draft');
    sessionStorage.setItem(draftKey, JSON.stringify(storedDraft()));
    read.mockResolvedValue(referenceSelectionState(3));
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    expect(screen.getByText(/cannot be restored onto the newer version/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore unsent draft' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsent draft' }));
    expect(sessionStorage.getItem(draftKey)).toBeNull();
    expect(sessionStorage.getItem(otherKey)).toBe('separate draft');
    expect(screen.getByLabelText('Selection academic year')).toBeEnabled();
    expect(save).not.toHaveBeenCalled();
  });
  it('does not rebase when a newer version appears during the restore read', async () => {
    sessionStorage.setItem(draftKey, JSON.stringify(storedDraft()));
    read
      .mockResolvedValueOnce(referenceSelectionState(0))
      .mockResolvedValueOnce(referenceSelectionState(1));
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Restore unsent draft' }));
    await screen.findByText(/no draft was restored or submitted/);
    expect(screen.getByLabelText('Selection academic year')).toHaveValue(null);
    expect(props.onSnapshot).toHaveBeenLastCalledWith(referenceSelectionState(1).snapshot);
    expect(sessionStorage.getItem(draftKey)).not.toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
  it('does not restore an older candidate when stored draft data changes during the fresh read', async () => {
    sessionStorage.setItem(draftKey, JSON.stringify(storedDraft()));
    const late = deferred<ReturnType<typeof referenceSelectionState>>();
    read.mockResolvedValueOnce(referenceSelectionState(0)).mockReturnValueOnce(late.promise);
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Restore unsent draft' }));
    const replacement = { ...storedDraft(), draft: { ...storedDraft().draft, year: '3' } };
    sessionStorage.setItem(draftKey, JSON.stringify(replacement));
    await act(async () => late.resolve(referenceSelectionState(0)));
    await screen.findByText(/no draft was restored or submitted/);
    expect(screen.getByLabelText('Selection academic year')).toHaveValue(null);
    expect(JSON.parse(sessionStorage.getItem(draftKey)!)).toEqual(replacement);
    expect(save).not.toHaveBeenCalled();
  });
  it('never reveals another owner’s copied envelope and permits explicit invalid-draft discard', async () => {
    sessionStorage.setItem(draftKey, JSON.stringify({ ...storedDraft(), ownerId: savedPlanId }));
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    expect(screen.getByText(/Stored unsent draft data is invalid/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore unsent draft' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Selection academic year')).toHaveValue(null);
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsent draft' }));
    expect(sessionStorage.getItem(draftKey)).toBeNull();
    expect(screen.getByLabelText('Selection academic year')).toBeEnabled();
  });
  it('does not delete a valid replacement through an outdated invalid-draft discard', async () => {
    sessionStorage.setItem(draftKey, '{bad');
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    sessionStorage.setItem(draftKey, JSON.stringify(storedDraft()));
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsent draft' }));
    expect(screen.getByText(/stored draft changed/)).toBeInTheDocument();
    expect(sessionStorage.getItem(draftKey)).not.toBeNull();
    expect(screen.getByLabelText('Selection academic year')).toBeDisabled();
  });
  it('prioritizes an unresolved save and clears only its matching promoted draft after recovery', async () => {
    const body = referenceSelectionBody();
    sessionStorage.setItem(key, JSON.stringify(recovery(body)));
    sessionStorage.setItem(
      draftKey,
      JSON.stringify({
        ...storedDraft(),
        draft: { year: '2', semester: '1', courseIds: body.courseIds },
      }),
    );
    read
      .mockResolvedValueOnce(referenceSelectionState(0))
      .mockResolvedValueOnce(referenceSelectionState(1));
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    expect(screen.queryByRole('button', { name: 'Restore unsent draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard unsent draft' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry the same save' }));
    await screen.findByText(/Last acknowledged save/);
    expect(save.mock.calls[0][1]).toEqual(body);
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(sessionStorage.getItem(draftKey)).toBeNull();
  });
  it('does not expose draft controls when the pending request journal is corrupt', async () => {
    sessionStorage.setItem(key, '{bad');
    sessionStorage.setItem(draftKey, JSON.stringify(storedDraft()));
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    expect(screen.queryByRole('button', { name: 'Restore unsent draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard unsent draft' })).not.toBeInTheDocument();
    expect(sessionStorage.getItem(draftKey)).not.toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
  it('keeps input usable with an honest warning if unsent writes fail; saving still needs its own journal', async () => {
    const backing = sessionStorage;
    vi.stubGlobal('sessionStorage', {
      getItem: backing.getItem.bind(backing),
      removeItem: backing.removeItem.bind(backing),
      setItem: (storageKey: string, value: string) => {
        if (storageKey === draftKey) throw new Error('quota');
        backing.setItem(storageKey, value);
      },
    });
    save.mockRejectedValueOnce(new Error('lost reply'));
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    slot();
    expect(screen.getByText(/These edits could not be retained/)).toBeInTheDocument();
    expect(screen.getByLabelText('Selection academic year')).toHaveValue(2);
    expect(save).not.toHaveBeenCalled();
    submit();
    await screen.findByText(/Could not confirm whether this selection was saved/);
    expect(JSON.parse(backing.getItem(key)!)).toEqual(recovery(save.mock.calls[0][1]));
    expect(backing.getItem(draftKey)).toBeNull();
  });
  it('retains a draft and blocks editing when discard storage removal fails', async () => {
    sessionStorage.setItem(draftKey, JSON.stringify(storedDraft()));
    const backing = sessionStorage;
    vi.stubGlobal('sessionStorage', {
      getItem: backing.getItem.bind(backing),
      setItem: backing.setItem.bind(backing),
      removeItem: () => {
        throw new Error('denied');
      },
    });
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsent draft' }));
    expect(screen.getByText(/could not be discarded/)).toBeInTheDocument();
    expect(sessionStorage.getItem(draftKey)).not.toBeNull();
    expect(screen.getByLabelText('Selection academic year')).toBeDisabled();
  });
  it('preserves unavailable draft courses in order for explicit removal instead of silently filtering them', async () => {
    sessionStorage.setItem(draftKey, JSON.stringify(storedDraft()));
    const state = referenceSelectionState(0);
    state.editing = { status: 'AVAILABLE', courses: [] };
    read.mockResolvedValue(state);
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Restore unsent draft' }));
    await screen.findByText(/Unsent draft restored after checking/);
    expect(screen.getAllByText(/Not available in current curriculum choices/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Save course selection' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected course 1' }));
    expect(JSON.parse(sessionStorage.getItem(draftKey)!).draft.courseIds).toEqual([savedCourseId]);
    expect(save).not.toHaveBeenCalled();
  });
  it('ignores a late restore after changing curriculum scope and retains the original draft', async () => {
    sessionStorage.setItem(draftKey, JSON.stringify(storedDraft()));
    const late = deferred<ReturnType<typeof referenceSelectionState>>();
    read.mockResolvedValueOnce(referenceSelectionState(0)).mockReturnValueOnce(late.promise);
    const view = render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Restore unsent draft' }));
    view.rerender(<SavedReferenceSelectionEditor {...props} expectedCurriculumId={savedPlanId} />);
    await act(async () => late.resolve(referenceSelectionState(0)));
    expect(props.onSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Selection academic year')).not.toBeInTheDocument();
    expect(sessionStorage.getItem(draftKey)).not.toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
  it('does not restore through a second batched handler after discarding', async () => {
    sessionStorage.setItem(draftKey, JSON.stringify(storedDraft()));
    render(<SavedReferenceSelectionEditor {...props} />);
    await open();
    const restore = screen.getByRole('button', { name: 'Restore unsent draft' });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard unsent draft' }));
      fireEvent.click(restore);
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(draftKey)).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});
