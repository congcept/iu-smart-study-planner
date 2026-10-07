vi.mock('../SemesterAllocationPreviewPanel', () => ({
  SemesterAllocationPreviewPanel: () => null,
}));
vi.mock('../AllocationJobHistoryPanel', () => ({ AllocationJobHistoryPanel: () => null }));
vi.mock('../AllocationRunHistoryPanel', () => ({ AllocationRunHistoryPanel: () => null }));
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
import { allocationRun } from '@/test/fixtures/allocationRun';
import { createAllocationRun, getAllocationRun } from '@/lib/allocationRunsApi';
import { AdminResourceDashboard } from '../AdminResourceDashboard';

vi.mock('@/lib/allocationRunsApi', () => ({
  createAllocationRun: vi.fn(),
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
const report = () => screen.getByRole('region', { name: 'Saved simulation capture' });
const captureButton = () =>
  within(report()).getByRole('button', { name: 'Capture simulation run' });
const saveButton = () => screen.getByRole('button', { name: 'Save simulation settings' });
async function mount() {
  render(<AdminResourceDashboard userId={ownerId} />);
  await waitFor(() => expect(professors()).toBeEnabled());
  await waitFor(() => expect(captureButton()).toBeEnabled());
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
  vi.mocked(createAllocationRun).mockResolvedValue(allocationRun(scope));
  vi.mocked(getAllocationRun).mockResolvedValue(allocationRun(scope));
  vi.mocked(saveResources).mockImplementation(async (values) => resources(values, 2));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('simulation capture and resource settings integration', () => {
  it('captures server settings while leaving unsaved resource edits untouched', async () => {
    await mount();
    fireEvent.change(professors(), { target: { value: '17' } });
    fireEvent.click(captureButton());
    await within(report()).findByText('Last capture in this tab');
    expect(professors()).toHaveValue(17);
    expect(professors()).toBeEnabled();
    expect(saveResources).not.toHaveBeenCalled();
    expect(getResources).toHaveBeenCalledTimes(1);
    expect(storage.has(journalKey)).toBe(false);
    expect(createAllocationRun).toHaveBeenCalledWith({
      ...scope,
      expectedActorId: ownerId,
      requestId: expect.any(String),
    });
  });
  it('preserves a lost resource-save journal and locked form during capture', async () => {
    await mount();
    vi.mocked(saveResources).mockRejectedValueOnce(new Error('Lost response'));
    fireEvent.change(professors(), { target: { value: '17' } });
    fireEvent.click(saveButton());
    await screen.findByText(/Could not confirm this save\. The request is preserved/);
    const preserved = storage.get(journalKey);
    fireEvent.click(captureButton());
    await within(report()).findByText('Last capture in this tab');
    expect(storage.get(journalKey)).toBe(preserved);
    expect(professors()).toHaveValue(17);
    expect(professors()).toBeDisabled();
    expect(saveResources).toHaveBeenCalledTimes(1);
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
  });
  it('retries a lost capture using one key without touching form edits', async () => {
    await mount();
    fireEvent.change(professors(), { target: { value: '17' } });
    vi.mocked(createAllocationRun).mockRejectedValueOnce(new Error('Lost response'));
    fireEvent.click(captureButton());
    const retry = await within(report()).findByRole('button', { name: 'Retry simulation capture' });
    await waitFor(() => expect(retry).toBeEnabled());
    const original = vi.mocked(createAllocationRun).mock.calls[0][0];
    fireEvent.click(retry);
    await within(report()).findByText('Last capture in this tab');
    expect(createAllocationRun).toHaveBeenLastCalledWith(original);
    expect(professors()).toHaveValue(17);
    expect(saveResources).not.toHaveBeenCalled();
  });
});
