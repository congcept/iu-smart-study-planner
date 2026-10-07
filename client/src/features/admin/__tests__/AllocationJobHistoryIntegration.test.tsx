vi.mock('../SemesterAllocationPreviewPanel', () => ({
  SemesterAllocationPreviewPanel: () => null,
}));
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AllocationJobHistoryDTO,
  AllocationJobOutcomeDTO,
  CurriculumSummaryDTO,
  ResourceScopeDTO,
  ResourcesSnapshotDTO,
  UpsertResourcesDTO,
} from '@iu-study-planner/shared';
import { getSession } from '@/lib/api';
import { getResources, saveResources } from '@/lib/adminResourcesApi';
import { getCurriculumReference, getCurriculumReferences } from '@/lib/curriculumApi';
import {
  getAllocationJobOutcome,
  listAllocationJobs,
  enqueueAllocationJob,
  executeAllocationJob,
} from '@/lib/allocationJobsApi';
import {
  curriculumReference,
  ownerId,
  referenceId,
  otherReferenceId,
  referenceSession,
} from '@/test/fixtures/curriculumReference';
import { AdminResourceDashboard } from '../AdminResourceDashboard';
import { allocationJobRecoveryKey } from '../allocationJobRecovery';

vi.mock('../AllocationPreviewPanel', () => ({ AllocationPreviewPanel: () => null }));
vi.mock('../AllocationJobPanel', () => ({ AllocationJobPanel: () => null }));
vi.mock('../AllocationRunCapturePanel', () => ({ AllocationRunCapturePanel: () => null }));
vi.mock('../AllocationRunHistoryPanel', () => ({ AllocationRunHistoryPanel: () => null }));
vi.mock('../PlannedDemandPanel', () => ({ PlannedDemandPanel: () => null }));
vi.mock('@/lib/api', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/adminResourcesApi', () => ({ getResources: vi.fn(), saveResources: vi.fn() }));
vi.mock('@/lib/curriculumApi', () => ({
  getCurriculumReference: vi.fn(),
  getCurriculumReferences: vi.fn(),
}));
vi.mock('@/lib/allocationJobsApi', () => ({
  listAllocationJobs: vi.fn(),
  getAllocationJobOutcome: vi.fn(),
  enqueueAllocationJob: vi.fn(),
  executeAllocationJob: vi.fn(),
}));

const scope: ResourceScopeDTO = { curriculumId: referenceId, semester: 'FALL', year: 2026 };
const otherOwner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const jobId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const otherJobId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const requestId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const resourceKey = `pending_resource_save:${ownerId}`;
const requestKey = allocationJobRecoveryKey(ownerId, scope);
const storage = new Map<string, string>();
const seedRequest = () =>
  storage.set(
    requestKey,
    JSON.stringify({
      version: 1,
      ownerId,
      request: { ...scope, requestId, expectedActorId: ownerId },
      jobId,
    }),
  );
const payload = (professors = 5): UpsertResourcesDTO => ({
  ...scope,
  professors,
  classrooms: 6,
  labRooms: 2,
  maxStudentsPerSection: 40,
  courseOverrides: {},
  expectedRevision: 1,
});
const resources = (scenario = scope): ResourcesSnapshotDTO => ({
  kind: 'SIMULATION',
  curriculum: {
    id: scenario.curriculumId,
    code: 'SIM',
    name: 'Simulated reference',
    school: 'CSE',
  },
  semester: scenario.semester,
  year: scenario.year,
  resource: {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    ...scenario,
    professors: 5,
    classrooms: 6,
    labRooms: 2,
    maxStudentsPerSection: 40,
    courseOverrides: {},
    revision: 1,
    updatedBy: ownerId,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
  },
});
const outcome = (scenario = scope, id = jobId): AllocationJobOutcomeDTO => ({
  jobId: id,
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  executionModel: 'ATOMIC_SINGLE_JOB',
  scope: scenario,
  queuedAt: '2026-10-06T01:00:00.000Z',
  status: 'PENDING',
  runId: null,
  completedAt: null,
  failureCode: null,
});
const history = (scenario = scope, id = jobId): AllocationJobHistoryDTO => ({
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  scope: scenario,
  order: 'QUEUED_NEWEST_FIRST',
  pageSize: 20,
  jobs: [outcome(scenario, id)],
  nextAfter: null,
});
const professors = () => screen.getByLabelText('Professors');
const report = () => screen.getByRole('region', { name: 'Simulation request history' });
const reload = () => within(report()).getByRole('button', { name: 'Reload request history' });
const view = () => within(report()).getByRole('button', { name: /View request outcome/ });
const detail = () => within(report()).getByRole('region', { name: 'Selected request outcome' });
const noWrites = () => {
  expect(enqueueAllocationJob).not.toHaveBeenCalled();
  expect(executeAllocationJob).not.toHaveBeenCalled();
  expect(sessionStorage.setItem).not.toHaveBeenCalled();
  expect(sessionStorage.removeItem).not.toHaveBeenCalled();
};
const waitForHistory = async () => {
  await waitFor(() => expect(view()).toBeEnabled());
};
const mount = async () => {
  const result = render(<AdminResourceDashboard userId={ownerId} />);
  await waitForHistory();
  return result;
};
const selectOutcome = async () => {
  fireEvent.click(view());
  await within(report()).findByRole('region', { name: 'Selected request outcome' });
  await waitFor(() => expect(reload()).toBeEnabled());
};

beforeEach(() => {
  vi.resetAllMocks();
  storage.clear();
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
  });
  vi.mocked(getSession).mockResolvedValue({ ...referenceSession(null), role: 'ADMIN' });
  const reference = curriculumReference();
  const summary: CurriculumSummaryDTO = {
    id: reference.id,
    code: reference.code,
    name: reference.name,
    school: reference.school,
    degree: reference.degree,
    programUrl: reference.programUrl,
    totalCredits: reference.totalCredits,
    isGpaPath: reference.isGpaPath,
    sourceLabel: reference.sourceLabel,
    sourceUrl: reference.sourceUrl,
    usage: reference.usage,
  };
  const summaries: CurriculumSummaryDTO[] = [
    summary,
    { ...summary, id: otherReferenceId, code: 'OTHER' },
  ];
  vi.mocked(getCurriculumReferences).mockResolvedValue(summaries);
  vi.mocked(getCurriculumReference).mockImplementation(async (id) => ({ ...reference, id }));
  vi.mocked(getResources).mockImplementation(async (scenario) => resources(scenario));
  vi.mocked(listAllocationJobs).mockImplementation(async ({ curriculumId, semester, year }) =>
    history({ curriculumId, semester, year }),
  );
  vi.mocked(getAllocationJobOutcome).mockImplementation(async (id, scenario) =>
    outcome(scenario, id),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('request history in the admin scenario dashboard', () => {
  it('reloads history and reads one selected outcome while preserving unsaved resource fields', async () => {
    await mount();
    fireEvent.change(professors(), { target: { value: '17' } });
    fireEvent.click(reload());
    await waitFor(() => expect(listAllocationJobs).toHaveBeenCalledTimes(2));
    await waitForHistory();
    await selectOutcome();
    expect(getAllocationJobOutcome).toHaveBeenCalledExactlyOnceWith(jobId, scope);
    expect(listAllocationJobs).toHaveBeenNthCalledWith(1, scope);
    expect(listAllocationJobs).toHaveBeenNthCalledWith(2, scope);
    expect(professors()).toHaveValue(17);
    expect(professors()).toBeEnabled();
    expect(saveResources).not.toHaveBeenCalled();
    expect(getResources).toHaveBeenCalledTimes(1);
    noWrites();
  });

  it('preserves both unconfirmed resource recovery and a known request journal while reading history', async () => {
    const resourceJournal = JSON.stringify({ userId: ownerId, payload: payload(17) });
    const jobJournal = JSON.stringify({
      version: 1,
      ownerId,
      request: { ...scope, requestId, expectedActorId: ownerId },
      jobId,
    });
    storage.set(resourceKey, resourceJournal);
    storage.set(requestKey, jobJournal);
    await mount();
    expect(professors()).toHaveValue(17);
    expect(professors()).toBeDisabled();
    fireEvent.click(reload());
    await waitFor(() => expect(listAllocationJobs).toHaveBeenCalledTimes(2));
    await waitForHistory();
    await selectOutcome();
    expect(storage.get(resourceKey)).toBe(resourceJournal);
    expect(storage.get(requestKey)).toBe(jobJournal);
    expect(storage.size).toBe(2);
    expect(saveResources).not.toHaveBeenCalled();
    noWrites();
  });

  it('retries a failed selected history read without changing either recovery journal', async () => {
    storage.set(
      requestKey,
      JSON.stringify({
        version: 1,
        ownerId,
        request: { ...scope, requestId, expectedActorId: ownerId },
      }),
    );
    await mount();
    const preserved = [...storage];
    vi.mocked(getAllocationJobOutcome).mockRejectedValueOnce(new Error('Lost response'));
    fireEvent.click(view());
    const retry = await within(report()).findByRole('button', { name: 'Retry selected outcome' });
    await waitFor(() => expect(retry).toBeEnabled());
    expect(getAllocationJobOutcome).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);
    await within(report()).findByRole('region', { name: 'Selected request outcome' });
    expect(getAllocationJobOutcome).toHaveBeenNthCalledWith(2, jobId, scope);
    expect([...storage]).toEqual(preserved);
    expect(saveResources).not.toHaveBeenCalled();
    noWrites();
  });

  it.each([
    ['Semester', 'SPRING', { ...scope, semester: 'SPRING' as const }],
    ['Year', '2027', { ...scope, year: 2027 }],
    ['Reference curriculum', otherReferenceId, { ...scope, curriculumId: otherReferenceId }],
  ] as const)(
    'remounts history on a %s change and rejects the old scenario reply',
    async (label, value, nextScope) => {
      seedRequest();
      const preserved = [...storage];
      await mount();
      let resolveOld: (page: AllocationJobHistoryDTO) => void = () => undefined;
      vi.mocked(listAllocationJobs).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      );
      fireEvent.click(reload());
      await waitFor(() => expect(listAllocationJobs).toHaveBeenCalledTimes(2));
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      await waitFor(() => expect(listAllocationJobs).toHaveBeenLastCalledWith(nextScope));
      await waitForHistory();
      expect(
        within(report()).getByText(`${nextScope.semester} ${nextScope.year}`, { exact: false }),
      ).toBeInTheDocument();
      await act(async () => {
        resolveOld(history(scope, otherJobId));
      });
      expect(within(report()).queryByText(otherJobId)).not.toBeInTheDocument();
      await selectOutcome();
      expect(getAllocationJobOutcome).toHaveBeenCalledExactlyOnceWith(jobId, nextScope);
      expect(saveResources).not.toHaveBeenCalled();
      expect([...storage]).toEqual(preserved);
      noWrites();
    },
  );

  it('clears the selected history detail when saved settings reload remounts the active scenario', async () => {
    await mount();
    await selectOutcome();
    expect(detail()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved settings' }));
    await waitFor(() => expect(getResources).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listAllocationJobs).toHaveBeenCalledTimes(2));
    await waitForHistory();
    expect(
      within(report()).queryByRole('region', { name: 'Selected request outcome' }),
    ).not.toBeInTheDocument();
    expect(getAllocationJobOutcome).toHaveBeenCalledTimes(1);
    noWrites();
  });

  it('remounts for another owner and ignores the prior owner’s delayed selected outcome', async () => {
    seedRequest();
    storage.set(resourceKey, JSON.stringify({ userId: ownerId, payload: payload(17) }));
    const preserved = [...storage];
    const mounted = await mount();
    let resolveOld: (result: AllocationJobOutcomeDTO) => void = () => undefined;
    vi.mocked(getAllocationJobOutcome).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    fireEvent.click(view());
    await waitFor(() => expect(getAllocationJobOutcome).toHaveBeenCalledTimes(1));
    vi.mocked(getSession).mockResolvedValue({
      ...referenceSession(null, otherOwner),
      role: 'ADMIN',
    });
    mounted.rerender(<AdminResourceDashboard userId={otherOwner} />);
    await waitFor(() => expect(listAllocationJobs).toHaveBeenCalledTimes(2));
    await waitForHistory();
    await act(async () => {
      resolveOld({
        ...outcome(scope),
        status: 'SUCCEEDED',
        runId: requestId,
        completedAt: '2026-10-06T01:00:01.000Z',
      });
    });
    expect(
      within(report()).queryByRole('region', { name: 'Selected request outcome' }),
    ).not.toBeInTheDocument();
    expect(within(report()).queryByText(/Simulation completed/)).not.toBeInTheDocument();
    await selectOutcome();
    expect(within(detail()).getByText(/No terminal outcome is committed/)).toBeInTheDocument();
    expect(saveResources).not.toHaveBeenCalled();
    expect([...storage]).toEqual(preserved);
    noWrites();
  });
});
