vi.mock('../AllocationPreviewPanel', () => ({ AllocationPreviewPanel: () => null }));
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AuthUserDTO,
  CurriculumDetailDTO,
  CurriculumSummaryDTO,
  ResourcesSnapshotDTO,
  UpsertResourcesDTO,
} from '@iu-study-planner/shared';
import { getSession } from '@/lib/api';
import { getResources, saveResources } from '@/lib/adminResourcesApi';
import { getCurriculumReference, getCurriculumReferences } from '@/lib/curriculumApi';
import {
  curriculumReference,
  otherReferenceId,
  ownerId,
  referenceId,
  referenceSession,
} from '@/test/fixtures/curriculumReference';
import { AdminResourceDashboard } from '../AdminResourceDashboard';

vi.mock('@/lib/api', () => ({ getSession: vi.fn() }));
vi.mock('../PlannedDemandPanel', () => ({ PlannedDemandPanel: () => null }));
vi.mock('@/lib/adminResourcesApi', () => ({ getResources: vi.fn(), saveResources: vi.fn() }));
vi.mock('@/lib/curriculumApi', () => ({
  getCurriculumReference: vi.fn(),
  getCurriculumReferences: vi.fn(),
}));

const secondOwner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const journalKey = `pending_resource_save:${ownerId}`;
const storage = new Map<string, string>();
const session = (id = ownerId): AuthUserDTO => ({ ...referenceSession(null, id), role: 'ADMIN' });
const summary = (detail = curriculumReference()): CurriculumSummaryDTO => ({
  id: detail.id,
  code: detail.code,
  name: detail.name,
  school: detail.school,
  degree: detail.degree,
  programUrl: detail.programUrl,
  totalCredits: detail.totalCredits,
  isGpaPath: detail.isGpaPath,
  sourceLabel: detail.sourceLabel,
  sourceUrl: detail.sourceUrl,
  usage: detail.usage,
});
const otherDetail = (): CurriculumDetailDTO => ({
  ...curriculumReference(),
  id: otherReferenceId,
  code: 'OTHER',
  name: 'Other reference',
});
const payload = (changes: Partial<UpsertResourcesDTO> = {}): UpsertResourcesDTO => ({
  curriculumId: referenceId,
  semester: 'FALL',
  year: 2026,
  professors: 5,
  classrooms: 6,
  labRooms: 2,
  maxStudentsPerSection: 40,
  courseOverrides: {},
  expectedRevision: 0,
  ...changes,
});
const snapshot = (
  values: UpsertResourcesDTO | null = null,
  changes: Partial<NonNullable<ResourcesSnapshotDTO['resource']>> = {},
): ResourcesSnapshotDTO => {
  const scope = values ?? payload();
  return {
    kind: 'SIMULATION',
    curriculum: {
      id: scope.curriculumId,
      code: scope.curriculumId === referenceId ? 'SIM' : 'OTHER',
      name: scope.curriculumId === referenceId ? 'Simulated reference' : 'Other reference',
      school: 'CSE',
    },
    semester: scope.semester,
    year: scope.year,
    resource: values
      ? {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          curriculumId: values.curriculumId,
          semester: values.semester,
          year: values.year,
          professors: values.professors,
          classrooms: values.classrooms,
          labRooms: values.labRooms,
          maxStudentsPerSection: values.maxStudentsPerSection,
          courseOverrides: values.courseOverrides,
          revision: values.expectedRevision + 1,
          updatedBy: ownerId,
          createdAt: '2026-10-04T00:00:00.000Z',
          updatedAt: '2026-10-04T01:00:00.000Z',
          ...changes,
        }
      : null,
  };
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const saveButton = () => screen.getByRole('button', { name: 'Save simulation settings' });
const input = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
async function ready() {
  await waitFor(() => expect(input('Professors')).toBeEnabled());
}
function fill(values = payload()) {
  for (const [label, value] of [
    ['Professors', values.professors],
    ['Classrooms', values.classrooms],
    ['Lab rooms', values.labRooms],
    ['Students per section', values.maxStudentsPerSection],
  ] as const)
    fireEvent.change(input(label), { target: { value: String(value) } });
}
function storePending(values = payload(), userId = ownerId) {
  storage.set(journalKey, JSON.stringify({ userId, payload: values }));
}
async function mountPending(values = payload()) {
  storePending(values);
  render(<AdminResourceDashboard userId={ownerId} />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Check saved settings' })).toBeEnabled(),
  );
  await waitFor(() => expect(input('Professors')).toBeDisabled());
}

beforeEach(() => {
  vi.resetAllMocks();
  storage.clear();
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
  });
  vi.mocked(getSession).mockResolvedValue(session());
  vi.mocked(getCurriculumReferences).mockResolvedValue([summary(), summary(otherDetail())]);
  vi.mocked(getCurriculumReference).mockImplementation(async (id) =>
    id === referenceId ? curriculumReference() : otherDetail(),
  );
  vi.mocked(getResources).mockImplementation(async (scope) => ({
    ...snapshot(),
    curriculum: {
      id: scope.curriculumId,
      code: scope.curriculumId === referenceId ? 'SIM' : 'OTHER',
      name: scope.curriculumId === referenceId ? 'Simulated reference' : 'Other reference',
      school: 'CSE',
    },
    semester: scope.semester,
    year: scope.year,
  }));
  vi.mocked(saveResources).mockImplementation(async (value) => snapshot(value));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AdminResourceDashboard scope and durable save proof', () => {
  it('proves the cookie owner and current ADMIN role before catalog or private reads', async () => {
    const pending = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockReturnValueOnce(pending.promise);
    render(<AdminResourceDashboard userId={ownerId} />);
    expect(getCurriculumReferences).not.toHaveBeenCalled();
    expect(getResources).not.toHaveBeenCalled();
    await act(async () => pending.resolve(session()));
    await ready();
    expect(getResources).toHaveBeenCalledWith({
      curriculumId: referenceId,
      semester: 'FALL',
      year: 2026,
    });
    expect(input('Professors')).toHaveValue(null);
    expect(input('Students per section')).toHaveValue(null);
  });

  it.each(['wrong owner', 'student role', 'session failure'])(
    'blocks all data loading for %s',
    async (reason) => {
      if (reason === 'wrong owner') vi.mocked(getSession).mockResolvedValue(session(secondOwner));
      if (reason === 'student role') vi.mocked(getSession).mockResolvedValue(referenceSession());
      if (reason === 'session failure')
        vi.mocked(getSession).mockRejectedValue(new Error('offline'));
      render(<AdminResourceDashboard userId={ownerId} />);
      await waitFor(() => expect(getSession).toHaveBeenCalled());
      await act(async () => {});
      expect(getCurriculumReferences).not.toHaveBeenCalled();
      expect(getResources).not.toHaveBeenCalled();
      expect(saveResources).not.toHaveBeenCalled();
    },
  );

  it('does not invent a configuration when the public catalog is empty', async () => {
    vi.mocked(getCurriculumReferences).mockResolvedValue([]);
    render(<AdminResourceDashboard userId={ownerId} />);
    await waitFor(() => expect(getCurriculumReferences).toHaveBeenCalled());
    await act(async () => {});
    expect(getResources).not.toHaveBeenCalled();
    expect(getCurriculumReference).not.toHaveBeenCalled();
    expect(saveResources).not.toHaveBeenCalled();
  });

  it('creates with revision zero and journals the exact draft before POST', async () => {
    vi.mocked(getResources)
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot(payload()));
    const post = deferred<ResourcesSnapshotDTO>();
    vi.mocked(saveResources).mockImplementationOnce((value) => {
      expect(JSON.parse(storage.get(journalKey)!)).toEqual({ userId: ownerId, payload: value });
      return post.promise;
    });
    render(<AdminResourceDashboard userId={ownerId} />);
    await ready();
    fill();
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveResources).toHaveBeenCalledWith(payload()));
    expect(input('Professors')).toBeDisabled();
    await act(async () => post.resolve(snapshot(payload())));
    await waitFor(() => expect(storage.has(journalKey)).toBe(false));
    expect(input('Professors')).toHaveValue(5);
  });

  it('saves replacement settings using the loaded revision', async () => {
    vi.mocked(getResources).mockResolvedValue(snapshot(payload(), { revision: 7 }));
    render(<AdminResourceDashboard userId={ownerId} />);
    await ready();
    fireEvent.change(input('Professors'), { target: { value: '9' } });
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(saveResources).toHaveBeenCalledWith(payload({ professors: 9, expectedRevision: 7 })),
    );
  });

  it.each(['wrong owner', 'student role'])(
    'rechecks %s before a save and leaves POST untouched',
    async (reason) => {
      render(<AdminResourceDashboard userId={ownerId} />);
      await ready();
      fill();
      vi.mocked(getSession).mockResolvedValue(
        reason === 'wrong owner' ? session(secondOwner) : referenceSession(),
      );
      fireEvent.click(saveButton());
      await waitFor(() => expect(getSession).toHaveBeenCalledTimes(3));
      await act(async () => {});
      expect(saveResources).not.toHaveBeenCalled();
    },
  );

  it('retains a lost-response journal until a same-scope read proves the exact saved result', async () => {
    vi.mocked(saveResources).mockRejectedValue(new Error('response lost'));
    vi.mocked(getResources)
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot(payload()));
    render(<AdminResourceDashboard userId={ownerId} />);
    await ready();
    fill();
    fireEvent.click(saveButton());
    await waitFor(() => expect(storage.has(journalKey)).toBe(false));
    expect(saveResources).toHaveBeenCalledTimes(1);
    expect(getResources).toHaveBeenCalledTimes(2);
    expect(getSession).toHaveBeenCalledTimes(4);
  });

  it('keeps a revision conflict locked without rebasing or retrying POST', async () => {
    vi.mocked(saveResources).mockRejectedValue({ isAxiosError: true, response: { status: 409 } });
    vi.mocked(getResources)
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValue(snapshot(payload(), { revision: 3 }));
    render(<AdminResourceDashboard userId={ownerId} />);
    await ready();
    fill();
    fireEvent.click(saveButton());
    await screen.findByRole('button', { name: 'Check saved settings' });
    expect(storage.has(journalKey)).toBe(true);
    expect(input('Professors')).toHaveValue(5);
    expect(input('Professors')).toBeDisabled();
    expect(screen.getByText(/different revision is saved/i)).toBeInTheDocument();
    expect(saveResources).toHaveBeenCalledTimes(1);
  });

  it('recovers a tab journal using only a read and never automatically resubmits', async () => {
    await mountPending(payload({ curriculumId: otherReferenceId, semester: 'SPRING', year: 2027 }));
    expect(saveResources).not.toHaveBeenCalled();
    expect(input('Professors')).toBeDisabled();
    vi.mocked(getResources).mockResolvedValue(
      snapshot(payload({ curriculumId: otherReferenceId, semester: 'SPRING', year: 2027 })),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Check saved settings' }));
    await waitFor(() => expect(storage.has(journalKey)).toBe(false));
    expect(getResources).toHaveBeenLastCalledWith({
      curriculumId: otherReferenceId,
      semester: 'SPRING',
      year: 2027,
    });
    expect(saveResources).not.toHaveBeenCalled();
    expect(input('Professors')).toBeEnabled();
  });

  it.each([
    ['wrong revision', { revision: 4 }],
    ['wrong actor', { updatedBy: secondOwner }],
    ['legacy missing actor', { updatedBy: null }],
    ['different settings', { professors: 8 }],
    ['different overrides', { courseOverrides: { MA001IU: { capacity: 30 } } }],
  ] as const)('does not erase a pending request for %s', async (_name, changes) => {
    await mountPending();
    vi.mocked(getResources).mockResolvedValue(snapshot(payload(), changes));
    fireEvent.click(screen.getByRole('button', { name: 'Check saved settings' }));
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(3));
    await act(async () => {});
    expect(storage.has(journalKey)).toBe(true);
    expect(input('Professors')).toBeDisabled();
    expect(saveResources).not.toHaveBeenCalled();
  });

  it('does not accept another scope even when revision, actor and values match', async () => {
    await mountPending();
    vi.mocked(getResources).mockResolvedValue(
      snapshot(payload({ curriculumId: otherReferenceId })),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Check saved settings' }));
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(3));
    await act(async () => {});
    expect(storage.has(journalKey)).toBe(true);
    expect(saveResources).not.toHaveBeenCalled();
  });

  it('checks current role again before readonly confirmation', async () => {
    await mountPending();
    const previousReads = vi.mocked(getResources).mock.calls.length;
    vi.mocked(getSession).mockResolvedValue(referenceSession());
    fireEvent.click(screen.getByRole('button', { name: 'Check saved settings' }));
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(3));
    await act(async () => {});
    expect(getResources).toHaveBeenCalledTimes(previousReads);
    expect(storage.has(journalKey)).toBe(true);
  });

  it.each(['corrupt', 'legacy', 'wrong owner'])(
    'retains %s journals until explicit local clearing',
    async (kind) => {
      storage.set(
        journalKey,
        kind === 'corrupt'
          ? '{bad'
          : JSON.stringify(
              kind === 'legacy' ? { ...payload() } : { userId: secondOwner, payload: payload() },
            ),
      );
      const original = storage.get(journalKey);
      render(<AdminResourceDashboard userId={ownerId} />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Clear local request' })).toBeEnabled(),
      );
      expect(storage.get(journalKey)).toBe(original);
      expect(saveResources).not.toHaveBeenCalled();
      expect(
        screen.queryByRole('button', { name: 'Check saved settings' }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Clear local request' }));
      await ready();
      expect(storage.has(journalKey)).toBe(false);
      expect(saveResources).not.toHaveBeenCalled();
    },
  );

  it('clears only the local request and reloads the same scope before unlocking', async () => {
    await mountPending(payload({ curriculumId: otherReferenceId }));
    const reload = deferred<ResourcesSnapshotDTO>();
    vi.mocked(getResources).mockReturnValueOnce(reload.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Clear local request' }));
    await waitFor(() =>
      expect(getResources).toHaveBeenLastCalledWith({
        curriculumId: otherReferenceId,
        semester: 'FALL',
        year: 2026,
      }),
    );
    expect(screen.queryByLabelText('Professors')).not.toBeInTheDocument();
    await act(async () =>
      reload.resolve(snapshot(payload({ curriculumId: otherReferenceId, professors: 12 }))),
    );
    await ready();
    expect(input('Professors')).toHaveValue(12);
    expect(saveResources).not.toHaveBeenCalled();
  });

  it('does not POST when durable journal storage fails', async () => {
    render(<AdminResourceDashboard userId={ownerId} />);
    await ready();
    fill();
    vi.mocked(sessionStorage.setItem).mockImplementation(() => {
      throw new Error('denied');
    });
    fireEvent.click(saveButton());
    await screen.findByRole('button', { name: 'Clear local request' });
    expect(saveResources).not.toHaveBeenCalled();
    expect(input('Professors')).toHaveValue(5);
  });

  it('keeps the journal and controls locked if matching confirmation cannot remove storage', async () => {
    await mountPending();
    vi.mocked(getResources).mockResolvedValue(snapshot(payload()));
    vi.mocked(sessionStorage.removeItem).mockImplementation(() => {
      throw new Error('denied');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check saved settings' }));
    await waitFor(() => expect(sessionStorage.removeItem).toHaveBeenCalled());
    expect(storage.has(journalKey)).toBe(true);
    expect(input('Professors')).toBeDisabled();
  });

  it('prevents duplicate click writes throughout POST and confirmation', async () => {
    vi.mocked(getResources)
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot(payload()));
    const post = deferred<ResourcesSnapshotDTO>();
    vi.mocked(saveResources).mockReturnValueOnce(post.promise);
    render(<AdminResourceDashboard userId={ownerId} />);
    await ready();
    fill();
    const button = saveButton();
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(saveResources).toHaveBeenCalledTimes(1));
    expect(input('Professors')).toBeDisabled();
    await act(async () => post.resolve(snapshot(payload())));
    await waitFor(() => expect(storage.has(journalKey)).toBe(false));
    expect(saveResources).toHaveBeenCalledTimes(1);
  });

  it('ignores focus and visibility events while preserving unsaved edits', async () => {
    render(<AdminResourceDashboard userId={ownerId} />);
    await ready();
    fill();
    const reads = vi.mocked(getResources).mock.calls.length;
    fireEvent(window, new Event('focus'));
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => {});
    expect(getResources).toHaveBeenCalledTimes(reads);
    expect(input('Professors')).toHaveValue(5);
  });

  it('keeps storage-read failures blocked until storage can be explicitly cleared', async () => {
    vi.mocked(sessionStorage.getItem).mockImplementation(() => {
      throw new Error('denied');
    });
    render(<AdminResourceDashboard userId={ownerId} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Clear local request' })).toBeEnabled(),
    );
    expect(input('Professors')).toBeDisabled();
    vi.mocked(sessionStorage.removeItem).mockImplementation(() => {
      throw new Error('denied');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear local request' }));
    await screen.findByText(/Could not clear recovery data/);
    expect(input('Professors')).toBeDisabled();
    expect(saveResources).not.toHaveBeenCalled();
  });

  it('preserves pending values after failed readonly confirmation', async () => {
    await mountPending();
    vi.mocked(getResources).mockRejectedValue(new Error('verification failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Check saved settings' }));
    await screen.findByText(/Could not confirm saved settings/);
    expect(storage.has(journalKey)).toBe(true);
    expect(input('Professors')).toHaveValue(5);
    expect(input('Professors')).toBeDisabled();
    expect(saveResources).not.toHaveBeenCalled();
  });

  it('preserves a successful POST with failed GET proof and recovers by read without replay', async () => {
    vi.mocked(getResources)
      .mockResolvedValueOnce(snapshot())
      .mockRejectedValueOnce(new Error('adapter verification failed'));
    render(<AdminResourceDashboard userId={ownerId} />);
    await ready();
    fill();
    fireEvent.click(saveButton());
    await screen.findByText(/Could not confirm this save or clear recovery data/);
    const original = storage.get(journalKey);
    expect(JSON.parse(original!)).toEqual({ userId: ownerId, payload: payload() });
    expect(input('Professors')).toHaveValue(5);
    expect(input('Professors')).toBeDisabled();
    expect(screen.getByLabelText('Reference curriculum')).toBeDisabled();
    fireEvent.click(saveButton());
    expect(saveResources).toHaveBeenCalledTimes(1);
    vi.mocked(getResources).mockResolvedValue(snapshot(payload()));
    fireEvent.click(screen.getByRole('button', { name: 'Check saved settings' }));
    await ready();
    expect(storage.has(journalKey)).toBe(false);
    expect(saveResources).toHaveBeenCalledTimes(1);
  });

  it('treats structurally equivalent override objects as proof regardless of key order', async () => {
    const request = payload({
      courseOverrides: { MA001IU: { capacity: 0, professorCount: 3 }, OLD001: { capacity: 20 } },
    });
    await mountPending(request);
    vi.mocked(getResources).mockResolvedValue(
      snapshot(request, {
        courseOverrides: { OLD001: { capacity: 20 }, MA001IU: { professorCount: 3, capacity: 0 } },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Check saved settings' }));
    await waitFor(() => expect(storage.has(journalKey)).toBe(false));
    expect(saveResources).not.toHaveBeenCalled();
    expect(input('Professors')).toBeEnabled();
  });

  it('requires GET proof even after a plausible successful POST reply', async () => {
    const confirmation = deferred<ResourcesSnapshotDTO>();
    vi.mocked(getResources)
      .mockResolvedValueOnce(snapshot())
      .mockReturnValueOnce(confirmation.promise);
    render(<AdminResourceDashboard userId={ownerId} />);
    await ready();
    fill();
    fireEvent.click(saveButton());
    await waitFor(() => expect(getResources).toHaveBeenCalledTimes(2));
    expect(storage.has(journalKey)).toBe(true);
    expect(input('Professors')).toBeDisabled();
    expect(screen.getByLabelText('Reference curriculum')).toBeDisabled();
    fireEvent.click(saveButton());
    expect(saveResources).toHaveBeenCalledTimes(1);
    await act(async () => confirmation.resolve(snapshot(payload())));
    await ready();
    expect(storage.has(journalKey)).toBe(false);
  });

  it('replaces unsaved edits only when explicit reload completes', async () => {
    vi.mocked(getResources).mockResolvedValue(snapshot(payload(), { professors: 11 }));
    render(<AdminResourceDashboard userId={ownerId} />);
    await ready();
    fill();
    const reload = deferred<ResourcesSnapshotDTO>();
    vi.mocked(getResources).mockReturnValueOnce(reload.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved settings' }));
    await waitFor(() => expect(getResources).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText('Professors')).not.toBeInTheDocument();
    await act(async () => reload.resolve(snapshot(payload(), { professors: 11 })));
    await ready();
    expect(input('Professors')).toHaveValue(11);
    expect(saveResources).not.toHaveBeenCalled();
  });

  it('ignores an obsolete A response after selecting B and returning to A', async () => {
    const firstA = deferred<ResourcesSnapshotDTO>();
    vi.mocked(getResources).mockReturnValueOnce(firstA.promise);
    render(<AdminResourceDashboard userId={ownerId} />);
    await waitFor(() => expect(getResources).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Reference curriculum'), {
      target: { value: otherReferenceId },
    });
    await ready();
    fireEvent.change(screen.getByLabelText('Reference curriculum'), {
      target: { value: referenceId },
    });
    await ready();
    fill();
    await act(async () => firstA.resolve(snapshot(payload(), { professors: 99 })));
    expect(input('Professors')).toHaveValue(5);
    expect(input('Professors')).toBeEnabled();
  });

  it('isolates an unmounted owner’s late POST/confirmation from the same owner’s remount', async () => {
    const post = deferred<ResourcesSnapshotDTO>();
    vi.mocked(saveResources).mockReturnValueOnce(post.promise);
    const view = render(<AdminResourceDashboard userId={ownerId} />);
    await ready();
    fill();
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveResources).toHaveBeenCalledTimes(1));
    const original = storage.get(journalKey);
    vi.mocked(getSession).mockResolvedValue(session(secondOwner));
    view.rerender(<AdminResourceDashboard userId={secondOwner} />);
    await ready();
    expect(input('Professors')).toHaveValue(null);
    vi.mocked(getSession).mockResolvedValue(session());
    view.rerender(<AdminResourceDashboard userId={ownerId} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Check saved settings' })).toBeEnabled(),
    );
    await act(async () => post.resolve(snapshot(payload())));
    expect(storage.get(journalKey)).toBe(original);
    expect(input('Professors')).toBeDisabled();
    expect(saveResources).toHaveBeenCalledTimes(1);
  });

  it('ignores a previous owner’s readonly proof after switching away and back', async () => {
    storePending();
    const view = render(<AdminResourceDashboard userId={ownerId} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Check saved settings' })).toBeEnabled(),
    );
    const proof = deferred<ResourcesSnapshotDTO>();
    vi.mocked(getResources).mockReturnValueOnce(proof.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Check saved settings' }));
    await waitFor(() => expect(getResources).toHaveBeenCalledTimes(2));
    vi.mocked(getSession).mockResolvedValue(session(secondOwner));
    view.rerender(<AdminResourceDashboard userId={secondOwner} />);
    await ready();
    vi.mocked(getSession).mockResolvedValue(session());
    view.rerender(<AdminResourceDashboard userId={ownerId} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Check saved settings' })).toBeEnabled(),
    );
    await act(async () => proof.resolve(snapshot(payload())));
    expect(storage.has(journalKey)).toBe(true);
    expect(input('Professors')).toBeDisabled();
    expect(saveResources).not.toHaveBeenCalled();
  });

  it('rejects duplicate override courses without collapsing them into a record', async () => {
    render(<AdminResourceDashboard userId={ownerId} />);
    await ready();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Add course override' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add course override' }));
    for (const course of screen.getAllByLabelText('Course'))
      fireEvent.change(course, { target: { value: 'MA001IU' } });
    for (const capacity of screen.getAllByLabelText('Capacity'))
      fireEvent.change(capacity, { target: { value: '30' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Simulation resource settings' }));
    await screen.findByText('Choose each course only once.');
    expect(saveResources).not.toHaveBeenCalled();
    expect(storage.has(journalKey)).toBe(false);
  });

  it('saves zero overrides explicitly and preserves unspecified professor counts', async () => {
    const request = payload({ courseOverrides: { MA001IU: { capacity: 0 } } });
    vi.mocked(getResources)
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot(request));
    render(<AdminResourceDashboard userId={ownerId} />);
    await ready();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Add course override' }));
    fireEvent.change(screen.getByLabelText('Course'), { target: { value: 'MA001IU' } });
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '0' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveResources).toHaveBeenCalledWith(request));
  });

  it('preserves historical overrides on read and requires their explicit removal before replacement', async () => {
    vi.mocked(getResources).mockResolvedValue(
      snapshot(payload({ courseOverrides: { HISTORICAL: { capacity: 22 } } })),
    );
    render(<AdminResourceDashboard userId={ownerId} />);
    await ready();
    expect(screen.getByLabelText('Course')).toHaveValue('HISTORICAL');
    fireEvent.submit(screen.getByRole('form', { name: 'Simulation resource settings' }));
    await screen.findByText(
      'Choose a current reference course for every override, or remove its row.',
    );
    expect(saveResources).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove override' }));
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(saveResources).toHaveBeenCalledWith(payload({ expectedRevision: 1 })),
    );
  });

  it('supports an empty curriculum reference without borrowing global courses', async () => {
    vi.mocked(getCurriculumReference).mockResolvedValue({
      ...curriculumReference(),
      courses: [],
      ratingPrior: null,
    });
    render(<AdminResourceDashboard userId={ownerId} />);
    await ready();
    fill();
    expect(screen.getByRole('button', { name: 'Add course override' })).toBeDisabled();
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveResources).toHaveBeenCalledWith(payload()));
  });

  it.each([
    ['Professors', '-1'],
    ['Classrooms', '100001'],
    ['Lab rooms', '1.5'],
    ['Students per section', '0'],
  ])('rejects invalid %s without writing a journal', async (label, value) => {
    render(<AdminResourceDashboard userId={ownerId} />);
    await ready();
    fill();
    fireEvent.change(input(label), { target: { value } });
    fireEvent.submit(screen.getByRole('form', { name: 'Simulation resource settings' }));
    await screen.findByText(/Enter whole numbers/);
    expect(saveResources).not.toHaveBeenCalled();
    expect(storage.has(journalKey)).toBe(false);
  });
});
