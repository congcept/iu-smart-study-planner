vi.mock('../SemesterAllocationRunCapturePanel', () => ({
  SemesterAllocationRunCapturePanel: () => null,
}));
vi.mock('../AllocationPreviewPanel', () => ({ AllocationPreviewPanel: () => null }));
vi.mock('../AllocationJobPanel', () => ({ AllocationJobPanel: () => null }));
vi.mock('../AllocationJobHistoryPanel', () => ({ AllocationJobHistoryPanel: () => null }));
vi.mock('../AllocationRunHistoryPanel', () => ({ AllocationRunHistoryPanel: () => null }));
vi.mock('../AllocationRunCapturePanel', () => ({ AllocationRunCapturePanel: () => null }));
vi.mock('../PlannedDemandPanel', () => ({ PlannedDemandPanel: () => null }));
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CurriculumSummaryDTO,
  ResourcesSnapshotDTO,
  ResourceScopeDTO,
  SemesterAllocationPreviewDTO,
  UpsertResourcesDTO,
} from '@iu-study-planner/shared';
import { getSession } from '@/lib/api';
import { getResources, saveResources } from '@/lib/adminResourcesApi';
import { getSemesterAllocationPreview } from '@/lib/semesterAllocationApi';
import { getCurriculumReference, getCurriculumReferences } from '@/lib/curriculumApi';
import {
  curriculumReference,
  ownerId,
  referenceId,
  referenceSession,
} from '@/test/fixtures/curriculumReference';
import { semesterAllocationPreview } from '@/test/fixtures/semesterAllocationPreview';
import { AdminResourceDashboard } from '../AdminResourceDashboard';

vi.mock('@/lib/api', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/adminResourcesApi', () => ({
  getResources: vi.fn(),
  saveResources: vi.fn(),
}));
vi.mock('@/lib/semesterAllocationApi', () => ({ getSemesterAllocationPreview: vi.fn() }));
vi.mock('@/lib/curriculumApi', () => ({
  getCurriculumReference: vi.fn(),
  getCurriculumReferences: vi.fn(),
}));

const scope: ResourceScopeDTO = { curriculumId: referenceId, semester: 'FALL', year: 2026 };
const journalKey = `pending_resource_save:${ownerId}`;
const storage = new Map<string, string>();
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
  curriculum: { id: referenceId, code: 'SIM', name: 'Simulated reference', school: 'CSE' },
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
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const professors = () => screen.getByLabelText('Professors');
const report = () => screen.getByRole('region', { name: 'Semester allocation preview' });
const reloadPreview = () =>
  within(report()).getByRole('button', { name: 'Reload semester preview' });
const saveButton = () => screen.getByRole('button', { name: 'Save simulation settings' });
async function mount() {
  render(<AdminResourceDashboard userId={ownerId} />);
  await waitFor(() => expect(professors()).toBeEnabled());
  await within(report()).findByRole('table');
}

beforeEach(() => {
  vi.resetAllMocks();
  storage.clear();
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
  });
  vi.mocked(getSession).mockResolvedValue({ ...referenceSession(null), role: 'ADMIN' });
  const detail = curriculumReference();
  const summary: CurriculumSummaryDTO = {
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
  };
  vi.mocked(getCurriculumReferences).mockResolvedValue([summary]);
  vi.mocked(getCurriculumReference).mockResolvedValue(detail);
  vi.mocked(getResources).mockResolvedValue(resources());
  vi.mocked(getSemesterAllocationPreview).mockResolvedValue(semesterAllocationPreview(scope, 1));
  vi.mocked(saveResources).mockImplementation(async (values) => resources(values, 2));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('semester preview and resource confirmation integration', () => {
  it('reloads preview without replacing edits or writing a recovery journal', async () => {
    await mount();
    fireEvent.change(professors(), { target: { value: '17' } });
    const pending = deferred<SemesterAllocationPreviewDTO>();
    vi.mocked(getSemesterAllocationPreview).mockReturnValueOnce(pending.promise);
    fireEvent.click(reloadPreview());
    expect(professors()).toHaveValue(17);
    expect(within(report()).queryByRole('table')).not.toBeInTheDocument();
    await waitFor(() => expect(getSemesterAllocationPreview).toHaveBeenCalledTimes(2));
    await act(async () => pending.resolve(semesterAllocationPreview(scope, 1)));
    await within(report()).findByRole('table');
    expect(professors()).toHaveValue(17);
    expect(professors()).toBeEnabled();
    expect(getResources).toHaveBeenCalledTimes(1);
    expect(saveResources).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
  });
  it('keeps lost-save recovery and locked resource fields intact while preview reloads', async () => {
    await mount();
    vi.mocked(saveResources).mockRejectedValueOnce(new Error('Lost response'));
    fireEvent.change(professors(), { target: { value: '17' } });
    fireEvent.click(saveButton());
    await screen.findByText(/Could not confirm this save\. The request is preserved/);
    const preserved = storage.get(journalKey);
    expect(preserved).toBeTruthy();
    expect(professors()).toBeDisabled();
    fireEvent.click(reloadPreview());
    await waitFor(() => expect(getSemesterAllocationPreview).toHaveBeenCalledTimes(2));
    await within(report()).findByRole('table');
    expect(storage.get(journalKey)).toBe(preserved);
    expect(professors()).toHaveValue(17);
    expect(professors()).toBeDisabled();
    expect(saveResources).toHaveBeenCalledTimes(1);
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
  });
  it('refreshes preview only when a resource read confirms the saved revision', async () => {
    await mount();
    const confirmation = deferred<ResourcesSnapshotDTO>();
    const refreshed = deferred<SemesterAllocationPreviewDTO>();
    vi.mocked(getResources).mockReturnValueOnce(confirmation.promise);
    vi.mocked(getSemesterAllocationPreview).mockReturnValueOnce(refreshed.promise);
    fireEvent.change(professors(), { target: { value: '17' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(getResources).toHaveBeenCalledTimes(2));
    expect(getSemesterAllocationPreview).toHaveBeenCalledTimes(1);
    await act(async () => confirmation.resolve(resources(payload({ professors: 17 }), 2)));
    await screen.findByText('Simulation settings saved and confirmed.');
    await waitFor(() => expect(getSemesterAllocationPreview).toHaveBeenCalledTimes(2));
    expect(within(report()).queryByRole('table')).not.toBeInTheDocument();
    await act(async () => refreshed.resolve(semesterAllocationPreview(scope, 2)));
    await within(report()).findByRole('table');
    expect(
      within(report()).queryByText(/different saved resource revision/),
    ).not.toBeInTheDocument();
    expect(getSemesterAllocationPreview).toHaveBeenLastCalledWith(scope);
    expect(professors()).toHaveValue(17);
    expect(professors()).toBeEnabled();
    expect(storage.has(journalKey)).toBe(false);
  });
});
