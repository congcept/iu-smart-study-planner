import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AuthUserDTO,
  CurriculumDetailDTO,
  CurriculumSummaryDTO,
  ResourcesSnapshotDTO,
  ResourceScopeDTO,
  UpsertResourcesDTO,
} from '@iu-study-planner/shared';
import { getSession } from '@/lib/api';
import { getResources, saveResources } from '@/lib/adminResourcesApi';
import { getCurriculumReference, getCurriculumReferences } from '@/lib/curriculumApi';
import {
  curriculumReference,
  ownerId,
  referenceId,
  referenceSession,
} from '@/test/fixtures/curriculumReference';
import { AdminResourceDashboard } from '../AdminResourceDashboard';

const { panelProps } = vi.hoisted(() => ({ panelProps: vi.fn() }));
function MockSemesterJobPanel(props: { userId: string; scope: ResourceScopeDTO }) {
  panelProps(props);
  const [requestStaged, setRequestStaged] = useState(false);
  return (
    <section aria-label="Semester request test panel">
      <p>{`${props.userId} · ${props.scope.curriculumId} · ${props.scope.semester} · ${props.scope.year}`}</p>
      <button onClick={() => setRequestStaged(true)}>Stage tab request</button>
      {requestStaged && <p>Staged tab request</p>}
    </section>
  );
}
vi.mock('../SemesterAllocationJobPanel', () => ({
  SemesterAllocationJobPanel: MockSemesterJobPanel,
}));
vi.mock('../SemesterAllocationRunCapturePanel', () => ({
  SemesterAllocationRunCapturePanel: () => null,
}));
vi.mock('../SemesterAllocationPreviewPanel', () => ({
  SemesterAllocationPreviewPanel: () => null,
}));
vi.mock('../AllocationPreviewPanel', () => ({ AllocationPreviewPanel: () => null }));
vi.mock('../AllocationRunCapturePanel', () => ({ AllocationRunCapturePanel: () => null }));
vi.mock('../AllocationRunHistoryPanel', () => ({ AllocationRunHistoryPanel: () => null }));
vi.mock('../AllocationJobPanel', () => ({ AllocationJobPanel: () => null }));
vi.mock('../AllocationJobHistoryPanel', () => ({ AllocationJobHistoryPanel: () => null }));
vi.mock('../PlannedDemandPanel', () => ({ PlannedDemandPanel: () => null }));
vi.mock('@/lib/api', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/adminResourcesApi', () => ({ getResources: vi.fn(), saveResources: vi.fn() }));
vi.mock('@/lib/curriculumApi', () => ({
  getCurriculumReference: vi.fn(),
  getCurriculumReferences: vi.fn(),
}));

const otherOwner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherContext = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const scope: ResourceScopeDTO = { curriculumId: referenceId, semester: 'FALL', year: 2026 };
const journalKey = `pending_resource_save:${ownerId}`;
const storage = new Map<string, string>();
const admin = (id = ownerId): AuthUserDTO => ({ ...referenceSession(null, id), role: 'ADMIN' });
const payload = (changes: Partial<UpsertResourcesDTO> = {}): UpsertResourcesDTO => ({
  ...scope,
  professors: 5,
  classrooms: 6,
  labRooms: 2,
  maxStudentsPerSection: 40,
  courseOverrides: {},
  expectedRevision: 1,
  ...changes,
});
const resources = (values = payload(), revision = 1): ResourcesSnapshotDTO => ({
  kind: 'SIMULATION',
  curriculum: { id: values.curriculumId, code: 'SIM', name: 'Simulated reference', school: 'CSE' },
  semester: values.semester,
  year: values.year,
  resource: {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    curriculumId: values.curriculumId,
    semester: values.semester,
    year: values.year,
    professors: values.professors,
    classrooms: values.classrooms,
    labRooms: values.labRooms,
    maxStudentsPerSection: values.maxStudentsPerSection,
    courseOverrides: values.courseOverrides,
    revision,
    updatedBy: ownerId,
    createdAt: '2026-10-04T00:00:00.000Z',
    updatedAt: '2026-10-04T01:00:00.000Z',
  },
});
const summary = (detail: CurriculumDetailDTO): CurriculumSummaryDTO => ({
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
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const panel = () => screen.getByRole('region', { name: 'Semester request test panel' });
const noPanel = () =>
  expect(
    screen.queryByRole('region', { name: 'Semester request test panel' }),
  ).not.toBeInTheDocument();
const reload = () => screen.getByRole('button', { name: 'Reload saved settings' });
const professors = () => screen.getByLabelText('Professors');
const save = () => screen.getByRole('button', { name: 'Save simulation settings' });
async function mount() {
  const view = render(<AdminResourceDashboard userId={ownerId} />);
  await screen.findByRole('region', { name: 'Semester request test panel' });
  return view;
}

beforeEach(() => {
  vi.resetAllMocks();
  storage.clear();
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
  });
  vi.mocked(getSession).mockResolvedValue(admin());
  vi.mocked(getCurriculumReferences).mockResolvedValue([summary(curriculumReference())]);
  vi.mocked(getCurriculumReference).mockImplementation(async (id) => ({
    ...curriculumReference(),
    id,
  }));
  vi.mocked(getResources).mockResolvedValue(resources());
  vi.mocked(saveResources).mockImplementation(async (values) => resources(values, 2));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('semester job panel and confirmed resource scenario integration', () => {
  it('mounts only after owner authorization and the complete current reference/resource read', async () => {
    const session = deferred<AuthUserDTO>();
    const settings = deferred<ResourcesSnapshotDTO>();
    const reference = deferred<CurriculumDetailDTO>();
    vi.mocked(getSession).mockReturnValueOnce(session.promise);
    vi.mocked(getResources).mockReturnValueOnce(settings.promise);
    vi.mocked(getCurriculumReference).mockReturnValueOnce(reference.promise);
    render(<AdminResourceDashboard userId={ownerId.toUpperCase()} />);
    noPanel();
    expect(getCurriculumReferences).not.toHaveBeenCalled();
    await act(async () => session.resolve(admin()));
    await waitFor(() => expect(getResources).toHaveBeenCalledWith(scope));
    noPanel();
    await act(async () => settings.resolve(resources()));
    noPanel();
    await act(async () => reference.resolve(curriculumReference()));
    await screen.findByRole('region', { name: 'Semester request test panel' });
    expect(panelProps).toHaveBeenLastCalledWith({ userId: ownerId, scope });
    expect(saveResources).not.toHaveBeenCalled();
  });

  it.each(['wrong owner', 'student role', 'session failure'] as const)(
    'does not mount a semester request panel for %s',
    async (reason) => {
      if (reason === 'wrong owner') vi.mocked(getSession).mockResolvedValue(admin(otherOwner));
      if (reason === 'student role') vi.mocked(getSession).mockResolvedValue(referenceSession());
      if (reason === 'session failure')
        vi.mocked(getSession).mockRejectedValue(new Error('Session offline'));
      render(<AdminResourceDashboard userId={ownerId} />);
      await screen.findByRole('button', { name: 'Reload references' });
      noPanel();
      expect(panelProps).not.toHaveBeenCalled();
      expect(getResources).not.toHaveBeenCalled();
    },
  );

  it('does not invent a request scenario when the curriculum catalog is empty', async () => {
    vi.mocked(getCurriculumReferences).mockResolvedValue([]);
    render(<AdminResourceDashboard userId={ownerId} />);
    await screen.findByText(/No reference curricula are available/);
    noPanel();
    expect(panelProps).not.toHaveBeenCalled();
    expect(getResources).not.toHaveBeenCalled();
  });

  it('accepts a confirmed scenario without saved resource settings', async () => {
    vi.mocked(getResources).mockResolvedValue({ ...resources(), resource: null });
    await mount();
    expect(panelProps).toHaveBeenLastCalledWith({ userId: ownerId, scope });
    expect(professors()).toHaveValue(null);
  });

  it('hides the panel during reload and after a failed saved-resource read', async () => {
    await mount();
    const settings = deferred<ResourcesSnapshotDTO>();
    vi.mocked(getResources).mockReturnValueOnce(settings.promise);
    fireEvent.click(reload());
    noPanel();
    await act(async () => settings.resolve(resources()));
    await screen.findByRole('region', { name: 'Semester request test panel' });
    vi.mocked(getResources).mockRejectedValueOnce(new Error('Resource unavailable'));
    fireEvent.click(reload());
    await screen.findByText(/Could not load saved settings and reference courses/);
    noPanel();
  });

  it('unmounts the panel after a fresh reload detects that the acting role changed', async () => {
    await mount();
    vi.mocked(getSession).mockResolvedValue(referenceSession());
    fireEvent.click(reload());
    await screen.findByText(/Your admin session changed/);
    noPanel();
    expect(getResources).toHaveBeenCalledTimes(1);
  });

  it.each(['wrong owner', 'student role'] as const)(
    'hides confirmed child evidence when resource-save preflight detects %s while retaining the dirty form',
    async (reason) => {
      await mount();
      fireEvent.click(within(panel()).getByRole('button', { name: 'Stage tab request' }));
      fireEvent.change(professors(), { target: { value: '17' } });
      vi.mocked(getSession).mockResolvedValueOnce(
        reason === 'wrong owner' ? admin(otherOwner) : referenceSession(),
      );
      fireEvent.click(save());
      await screen.findByText(/Your admin session changed/);
      noPanel();
      expect(professors()).toHaveValue(17);
      expect(saveResources).not.toHaveBeenCalled();
      expect(getResources).toHaveBeenCalledTimes(1);
      expect(storage.has(journalKey)).toBe(false);
      fireEvent.click(reload());
      await screen.findByRole('region', { name: 'Semester request test panel' });
      expect(panelProps).toHaveBeenLastCalledWith({ userId: ownerId, scope });
      expect(within(panel()).queryByText('Staged tab request')).not.toBeInTheDocument();
      expect(getResources).toHaveBeenCalledTimes(2);
    },
  );

  it.each([401, 403])(
    'removes old child evidence after a confirmed auth %i resource preflight failure and remounts on fresh owner verification',
    async (status) => {
      await mount();
      fireEvent.change(professors(), { target: { value: '17' } });
      vi.mocked(getSession).mockRejectedValueOnce({ isAxiosError: true, response: { status } });
      fireEvent.click(save());
      await screen.findByText(/Could not preserve this request for recovery/);
      noPanel();
      expect(professors()).toHaveValue(17);
      expect(saveResources).not.toHaveBeenCalled();
      expect(getResources).toHaveBeenCalledTimes(1);
      fireEvent.click(reload());
      await screen.findByRole('region', { name: 'Semester request test panel' });
      expect(panelProps).toHaveBeenLastCalledWith({ userId: ownerId, scope });
    },
  );

  it.each(['', 'not-a-uuid', null])(
    'hides confirmed child evidence for malformed fulfilled session identity %j without losing dirty resource edits',
    async (id) => {
      await mount();
      fireEvent.change(professors(), { target: { value: '17' } });
      const invalidSession = { ...admin(), id } as unknown as AuthUserDTO;
      vi.mocked(getSession).mockResolvedValueOnce(invalidSession);
      fireEvent.click(save());
      await screen.findByText(/Your admin session changed/);
      noPanel();
      expect(professors()).toHaveValue(17);
      expect(saveResources).not.toHaveBeenCalled();
      expect(getResources).toHaveBeenCalledTimes(1);
      expect(storage.has(journalKey)).toBe(false);
      if (id === null) {
        fireEvent.click(reload());
        await screen.findByRole('region', { name: 'Semester request test panel' });
        expect(panelProps).toHaveBeenLastCalledWith({ userId: ownerId, scope });
      }
    },
  );

  it('keeps independent child state and dirty resource values during a generic resource-save session transport failure', async () => {
    await mount();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Stage tab request' }));
    fireEvent.change(professors(), { target: { value: '17' } });
    vi.mocked(getSession).mockRejectedValueOnce(new Error('Session connection unavailable'));
    fireEvent.click(save());
    await screen.findByText(/Could not preserve this request for recovery/);
    expect(within(panel()).getByText('Staged tab request')).toBeInTheDocument();
    expect(professors()).toHaveValue(17);
    expect(saveResources).not.toHaveBeenCalled();
    expect(getResources).toHaveBeenCalledTimes(1);
    expect(storage.has(journalKey)).toBe(false);
  });

  it('drops the old owner panel immediately and waits for the new account scenario confirmation', async () => {
    const mounted = await mount();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Stage tab request' }));
    const session = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockReturnValueOnce(session.promise).mockResolvedValue(admin(otherOwner));
    mounted.rerender(<AdminResourceDashboard userId={otherOwner} />);
    noPanel();
    await act(async () => session.resolve(admin(otherOwner)));
    await screen.findByRole('region', { name: 'Semester request test panel' });
    expect(panelProps).toHaveBeenLastCalledWith({ userId: otherOwner, scope });
    expect(within(panel()).queryByText('Staged tab request')).not.toBeInTheDocument();
  });

  it('unmounts an old scenario while a changed semester loads and ignores its stale result', async () => {
    await mount();
    const spring = deferred<ResourcesSnapshotDTO>();
    const summer = deferred<ResourcesSnapshotDTO>();
    vi.mocked(getResources).mockReturnValueOnce(spring.promise).mockReturnValueOnce(summer.promise);
    fireEvent.change(screen.getByLabelText('Semester'), { target: { value: 'SPRING' } });
    noPanel();
    await waitFor(() =>
      expect(getResources).toHaveBeenCalledWith({ ...scope, semester: 'SPRING' }),
    );
    fireEvent.change(screen.getByLabelText('Semester'), { target: { value: 'SUMMER' } });
    await waitFor(() =>
      expect(getResources).toHaveBeenCalledWith({ ...scope, semester: 'SUMMER' }),
    );
    await act(async () => summer.resolve(resources(payload({ semester: 'SUMMER' }))));
    await screen.findByRole('region', { name: 'Semester request test panel' });
    expect(panelProps).toHaveBeenLastCalledWith({
      userId: ownerId,
      scope: { ...scope, semester: 'SUMMER' },
    });
    await act(async () => spring.resolve(resources(payload({ semester: 'SPRING' }))));
    expect(panelProps).toHaveBeenLastCalledWith({
      userId: ownerId,
      scope: { ...scope, semester: 'SUMMER' },
    });
  });

  it('requires a new curriculum reference and rejects an invalid year before mounting its request panel', async () => {
    const nextReference = { ...curriculumReference(), id: otherContext, code: 'OTHER' };
    vi.mocked(getCurriculumReferences).mockResolvedValue([
      summary(curriculumReference()),
      summary(nextReference),
    ]);
    await mount();
    const settings = deferred<ResourcesSnapshotDTO>();
    vi.mocked(getResources).mockReturnValueOnce(settings.promise);
    fireEvent.change(screen.getByLabelText('Reference curriculum'), {
      target: { value: otherContext },
    });
    noPanel();
    await waitFor(() => expect(getCurriculumReference).toHaveBeenCalledWith(otherContext));
    await act(async () => settings.resolve(resources(payload({ curriculumId: otherContext }))));
    await screen.findByRole('region', { name: 'Semester request test panel' });
    expect(panelProps).toHaveBeenLastCalledWith({
      userId: ownerId,
      scope: { ...scope, curriculumId: otherContext },
    });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '1999' } });
    await screen.findByText(/Choose a curriculum and a whole year/);
    noPanel();
    expect(getResources).toHaveBeenCalledTimes(2);
  });

  it('preserves staged child state and unsaved resource edits when a child action changes local state', async () => {
    await mount();
    fireEvent.change(professors(), { target: { value: '17' } });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Stage tab request' }));
    expect(within(panel()).getByText('Staged tab request')).toBeInTheDocument();
    expect(professors()).toHaveValue(17);
    expect(saveResources).not.toHaveBeenCalled();
    expect(getResources).toHaveBeenCalledTimes(1);
    expect(storage.has(journalKey)).toBe(false);
  });

  it('keeps the child request identity across confirmed resource revisions and a preserved lost-save journal', async () => {
    await mount();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Stage tab request' }));
    vi.mocked(getResources).mockResolvedValueOnce(resources(payload({ professors: 17 }), 2));
    fireEvent.change(professors(), { target: { value: '17' } });
    fireEvent.click(save());
    await screen.findByText('Simulation settings saved and confirmed.');
    expect(within(panel()).getByText('Staged tab request')).toBeInTheDocument();
    expect(panelProps).toHaveBeenLastCalledWith({ userId: ownerId, scope });
    expect(professors()).toHaveValue(17);
    vi.mocked(saveResources).mockRejectedValueOnce(new Error('Response lost'));
    vi.mocked(getResources).mockResolvedValueOnce(resources(payload({ professors: 17 }), 2));
    fireEvent.change(professors(), { target: { value: '18' } });
    fireEvent.click(save());
    await screen.findByText(/Could not confirm this save\. The request is preserved/);
    const journal = storage.get(journalKey);
    expect(journal).toBeTruthy();
    expect(within(panel()).getByText('Staged tab request')).toBeInTheDocument();
    expect(professors()).toHaveValue(18);
    expect(professors()).toBeDisabled();
    expect(storage.get(journalKey)).toBe(journal);
    expect(saveResources).toHaveBeenCalledTimes(2);
  });
});
