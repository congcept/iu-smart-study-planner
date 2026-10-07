vi.mock('../SemesterAllocationRunCapturePanel', () => ({
  SemesterAllocationRunCapturePanel: () => null,
}));
vi.mock('../SemesterAllocationPreviewPanel', () => ({
  SemesterAllocationPreviewPanel: () => null,
}));
vi.mock('../AllocationJobHistoryPanel', () => ({ AllocationJobHistoryPanel: () => null }));
vi.mock('../AllocationRunHistoryPanel', () => ({ AllocationRunHistoryPanel: () => null }));
vi.mock('../AllocationPreviewPanel', () => ({ AllocationPreviewPanel: () => null }));
vi.mock('../AllocationRunCapturePanel', () => ({ AllocationRunCapturePanel: () => null }));
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CurriculumSummaryDTO,
  PlannedDemandSnapshotDTO,
  ResourcesSnapshotDTO,
  ResourceScopeDTO,
  SimulationCapacitySnapshotDTO,
  UpsertResourcesDTO,
} from '@iu-study-planner/shared';
import { getSession } from '@/lib/api';
import {
  getPlannedDemand,
  getSimulationCapacity,
  getResources,
  saveResources,
} from '@/lib/adminResourcesApi';
import { getCurriculumReference, getCurriculumReferences } from '@/lib/curriculumApi';
import {
  curriculumReference,
  memberId,
  ownerId,
  referenceId,
  referenceSession,
} from '@/test/fixtures/curriculumReference';
import { AdminResourceDashboard } from '../AdminResourceDashboard';

vi.mock('@/lib/api', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/adminResourcesApi', () => ({
  getResources: vi.fn(),
  saveResources: vi.fn(),
  getSimulationCapacity: vi.fn(),
  getPlannedDemand: vi.fn(),
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
const plannedDemand = (resourceRevision = 1, count = 2): PlannedDemandSnapshotDTO => ({
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  scope,
  curriculum: { id: referenceId, code: 'SIM', name: 'Simulated reference', school: 'CSE' },
  planningBasis: 'CURRENT_PLANNED_SELECTIONS',
  termBasis: 'SCENARIO_ONLY',
  recommendationDemandAvailable: false,
  eligibilityValidated: false,
  offeringValidationAvailable: false,
  resourceRevision,
  cohortStudentCount: 3,
  plannedStudentCount: count,
  plannedSelectionCount: count,
  ignoredNonmemberSelectionCount: 0,
  courses: [
    {
      id: memberId,
      code: 'MA001IU',
      name: 'Scoped Calculus',
      plannedStudentCount: count,
      supply: null,
      utilization: null,
    },
  ],
});
const demand = (resourceRevision = 1, count = 2): SimulationCapacitySnapshotDTO => ({
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  model: 'EXPLICIT_COURSE_CAPACITY_ONLY',
  plannedSelections: plannedDemand(resourceRevision, count),
  resources: { professors: 5, classrooms: 6, labRooms: 2, maxStudentsPerSection: 40 },
  classroomSeatProxy: { basis: 'ONE_SIMULTANEOUS_CLASSROOM_SECTION_PER_ROOM', seats: 240 },
  ignoredNonmemberOverrideCount: 0,
  labClassificationAvailable: false,
  teachingLoadValidated: false,
  allocationValidated: false,
  courses: [
    {
      id: memberId,
      code: 'MA001IU',
      declaredSeatCapacity: null,
      capacityBasis: 'UNSPECIFIED',
      plannedSelectionsPerDeclaredSeat: null,
      excessPlannedSelections: null,
    },
  ],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const professors = () => screen.getByLabelText('Professors');
const report = () => screen.getByRole('region', { name: 'Planned selections' });
const reloadDemand = () =>
  within(report()).getByRole('button', { name: 'Reload planned selections' });
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
  vi.mocked(getSimulationCapacity).mockResolvedValue(demand());
  vi.mocked(saveResources).mockImplementation(async (values) => resources(values, 2));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('planned selections and resource form integration', () => {
  it('reloads counts without replacing unsaved resource edits or writing a recovery journal', async () => {
    await mount();
    fireEvent.change(professors(), { target: { value: '17' } });
    const pending = deferred<SimulationCapacitySnapshotDTO>();
    vi.mocked(getSimulationCapacity).mockReturnValueOnce(pending.promise);
    fireEvent.click(reloadDemand());
    expect(professors()).toHaveValue(17);
    expect(professors()).toBeEnabled();
    expect(within(report()).queryByRole('table')).not.toBeInTheDocument();
    await waitFor(() => expect(getSimulationCapacity).toHaveBeenCalledTimes(2));
    await act(async () => pending.resolve(demand(1, 3)));
    expect(await within(report()).findByRole('cell', { name: '3' })).toBeInTheDocument();
    expect(professors()).toHaveValue(17);
    expect(getResources).toHaveBeenCalledTimes(1);
    expect(saveResources).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
    expect(getPlannedDemand).not.toHaveBeenCalled();
  });

  it('keeps a lost-save journal and locked resource fields intact when counts are reloaded', async () => {
    await mount();
    vi.mocked(saveResources).mockRejectedValueOnce(new Error('Response lost'));
    fireEvent.change(professors(), { target: { value: '17' } });
    fireEvent.click(saveButton());
    await screen.findByText(/Could not confirm this save\. The request is preserved/);
    const preserved = storage.get(journalKey);
    expect(preserved).toBe(
      JSON.stringify({ userId: ownerId, payload: payload({ professors: 17 }) }),
    );
    expect(professors()).toBeDisabled();
    expect(professors()).toHaveValue(17);
    vi.mocked(getSimulationCapacity).mockResolvedValueOnce(demand(1, 3));
    fireEvent.click(reloadDemand());
    await within(report()).findByRole('cell', { name: '3' });
    expect(storage.get(journalKey)).toBe(preserved);
    expect(sessionStorage.setItem).toHaveBeenCalledTimes(1);
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    expect(professors()).toBeDisabled();
    expect(professors()).toHaveValue(17);
    expect(getSimulationCapacity).toHaveBeenCalledTimes(2);
    expect(getResources).toHaveBeenCalledTimes(2);
    expect(saveResources).toHaveBeenCalledExactlyOnceWith(payload({ professors: 17 }));
    expect(screen.getByRole('button', { name: 'Check saved settings' })).toBeEnabled();
    expect(getPlannedDemand).not.toHaveBeenCalled();
  });

  it('refreshes counts only after the resource read confirms the new saved revision', async () => {
    await mount();
    const confirmation = deferred<ResourcesSnapshotDTO>();
    const refreshedDemand = deferred<SimulationCapacitySnapshotDTO>();
    vi.mocked(getResources).mockReturnValueOnce(confirmation.promise);
    vi.mocked(getSimulationCapacity).mockReturnValueOnce(refreshedDemand.promise);
    fireEvent.change(professors(), { target: { value: '17' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(getResources).toHaveBeenCalledTimes(2));
    expect(getSimulationCapacity).toHaveBeenCalledTimes(1);
    expect(storage.has(journalKey)).toBe(true);
    await act(async () => confirmation.resolve(resources(payload({ professors: 17 }), 2)));
    await screen.findByText('Simulation settings saved and confirmed.');
    await waitFor(() => expect(getSimulationCapacity).toHaveBeenCalledTimes(2));
    expect(within(report()).queryByRole('table')).not.toBeInTheDocument();
    expect(within(report()).getByRole('status')).toHaveTextContent(
      'Loading current planned selections',
    );
    await act(async () => refreshedDemand.resolve(demand(2, 3)));
    await within(report()).findByRole('cell', { name: '3' });
    expect(within(report()).queryByRole('status')).not.toBeInTheDocument();
    expect(professors()).toHaveValue(17);
    expect(professors()).toBeEnabled();
    expect(saveResources).toHaveBeenCalledExactlyOnceWith(payload({ professors: 17 }));
    expect(getResources).toHaveBeenLastCalledWith(scope);
    expect(getSimulationCapacity).toHaveBeenLastCalledWith(scope);
    expect(storage.has(journalKey)).toBe(false);
    expect(sessionStorage.removeItem).toHaveBeenCalledExactlyOnceWith(journalKey);
    expect(getPlannedDemand).not.toHaveBeenCalled();
  });
});
