vi.mock('../SemesterAllocationPreviewPanel', () => ({
  SemesterAllocationPreviewPanel: () => null,
}));
vi.mock('../AllocationJobHistoryPanel', () => ({ AllocationJobHistoryPanel: () => null }));
vi.mock('../AllocationRunCapturePanel', () => ({ AllocationRunCapturePanel: () => null }));
vi.mock('../AllocationPreviewPanel', () => ({ AllocationPreviewPanel: () => null }));
vi.mock('../PlannedDemandPanel', () => ({ PlannedDemandPanel: () => null }));
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CurriculumSummaryDTO,
  ResourcesSnapshotDTO,
  ResourceScopeDTO,
  UpsertResourcesDTO,
} from '@iu-study-planner/shared';
import { getSession } from '@/lib/api';
import { getAllocationPreview, getResources, saveResources } from '@/lib/adminResourcesApi';
import { getCurriculumReference, getCurriculumReferences } from '@/lib/curriculumApi';
import {
  curriculumReference,
  ownerId,
  referenceId,
  referenceSession,
} from '@/test/fixtures/curriculumReference';
import { allocationPreview } from '@/test/fixtures/allocationPreview';
import { allocationHistory } from '@/test/fixtures/allocationRun';
import { listAllocationRuns, getAllocationRun } from '@/lib/allocationRunsApi';
import { AdminResourceDashboard } from '../AdminResourceDashboard';

vi.mock('@/lib/allocationRunsApi', () => ({
  listAllocationRuns: vi.fn(),
  getAllocationRun: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/adminResourcesApi', () => ({
  getResources: vi.fn(),
  saveResources: vi.fn(),
  getAllocationPreview: vi.fn(),
}));
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
const professors = () => screen.getByLabelText('Professors');
const report = () => screen.getByRole('region', { name: 'Simulation run history' });
const reloadHistory = () =>
  within(report()).getByRole('button', { name: 'Reload simulation history' });
const view = () => within(report()).getAllByRole('button', { name: /View capture/ })[0];
const saveButton = () => screen.getByRole('button', { name: 'Save simulation settings' });
async function mount() {
  render(<AdminResourceDashboard userId={ownerId} />);
  await waitFor(() => expect(professors()).toBeEnabled());
  await waitFor(() => expect(view()).toBeEnabled());
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
  vi.mocked(getAllocationPreview).mockResolvedValue(allocationPreview(scope, 1));
  vi.mocked(listAllocationRuns).mockResolvedValue(allocationHistory(scope));
  vi.mocked(getAllocationRun).mockResolvedValue(allocationHistory(scope).runs[0]);
  vi.mocked(saveResources).mockImplementation(async (values) => resources(values, 2));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('simulation history and resource settings integration', () => {
  it('reloads history and views a capture without replacing unsaved resource edits', async () => {
    await mount();
    fireEvent.change(professors(), { target: { value: '17' } });
    fireEvent.click(reloadHistory());
    await waitFor(() => expect(listAllocationRuns).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view()).toBeEnabled());
    fireEvent.click(view());
    await waitFor(() =>
      expect(getAllocationRun).toHaveBeenCalledWith(allocationHistory(scope).runs[0].id, scope),
    );
    await within(report()).findByRole('region', { name: 'Selected simulation capture' });
    await waitFor(() => expect(reloadHistory()).toBeEnabled());
    expect(professors()).toHaveValue(17);
    expect(professors()).toBeEnabled();
    expect(saveResources).not.toHaveBeenCalled();
    expect(getResources).toHaveBeenCalledTimes(1);
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
  });
  it('preserves resource-save recovery while browsing historical captures', async () => {
    await mount();
    vi.mocked(saveResources).mockRejectedValueOnce(new Error('Lost response'));
    fireEvent.change(professors(), { target: { value: '17' } });
    fireEvent.click(saveButton());
    await screen.findByText(/Could not confirm this save\. The request is preserved/);
    const preserved = storage.get(journalKey);
    fireEvent.click(reloadHistory());
    await waitFor(() => expect(listAllocationRuns).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view()).toBeEnabled());
    fireEvent.click(view());
    await waitFor(() => expect(getAllocationRun).toHaveBeenCalledTimes(1));
    await within(report()).findByRole('region', { name: 'Selected simulation capture' });
    await waitFor(() => expect(reloadHistory()).toBeEnabled());
    expect(storage.get(journalKey)).toBe(preserved);
    expect(professors()).toHaveValue(17);
    expect(professors()).toBeDisabled();
    expect(saveResources).toHaveBeenCalledTimes(1);
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
  });
});
