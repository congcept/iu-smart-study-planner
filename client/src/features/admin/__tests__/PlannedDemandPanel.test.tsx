import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AuthUserDTO,
  PlannedDemandSnapshotDTO,
  ResourceScopeDTO,
  SimulationCapacitySnapshotDTO,
} from '@iu-study-planner/shared';
import { getSession } from '@/lib/api';
import { getPlannedDemand, getSimulationCapacity, saveResources } from '@/lib/adminResourcesApi';
import { referenceSession } from '@/test/fixtures/curriculumReference';
import { PlannedDemandPanel } from '../PlannedDemandPanel';

vi.mock('@/lib/api', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/adminResourcesApi', () => ({
  getSimulationCapacity: vi.fn(),
  getPlannedDemand: vi.fn(),
  saveResources: vi.fn(),
}));

const ownerId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const otherOwnerId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const curriculumId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherCurriculumId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const scope: ResourceScopeDTO = { curriculumId, semester: 'FALL', year: 2026 };
const session = (id = ownerId): AuthUserDTO => ({ ...referenceSession(null, id), role: 'ADMIN' });
const plannedSnapshot = (
  changes: Partial<PlannedDemandSnapshotDTO> = {},
): PlannedDemandSnapshotDTO => ({
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  scope,
  curriculum: { id: curriculumId, code: 'CS', name: 'Computer Science', school: 'CSE' },
  planningBasis: 'CURRENT_PLANNED_SELECTIONS',
  termBasis: 'SCENARIO_ONLY',
  recommendationDemandAvailable: false,
  eligibilityValidated: false,
  offeringValidationAvailable: false,
  resourceRevision: 3,
  cohortStudentCount: 3,
  plannedStudentCount: 2,
  plannedSelectionCount: 3,
  ignoredNonmemberSelectionCount: 1,
  courses: [
    {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      code: 'IT001IU',
      name: 'Programming',
      plannedStudentCount: 2,
      supply: null,
      utilization: null,
    },
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      code: 'MA001IU',
      name: 'Calculus',
      plannedStudentCount: 1,
      supply: null,
      utilization: null,
    },
  ],
  ...changes,
});
const snapshot = (
  changes: Partial<PlannedDemandSnapshotDTO> = {},
): SimulationCapacitySnapshotDTO => {
  const plannedSelections = plannedSnapshot(changes);
  const saved = plannedSelections.resourceRevision !== null;
  return {
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    model: 'EXPLICIT_COURSE_CAPACITY_ONLY',
    plannedSelections,
    resources: saved
      ? { professors: 5, classrooms: 2, labRooms: 1, maxStudentsPerSection: 40 }
      : null,
    classroomSeatProxy: saved
      ? { basis: 'ONE_SIMULTANEOUS_CLASSROOM_SECTION_PER_ROOM', seats: 80 }
      : null,
    ignoredNonmemberOverrideCount: saved ? 1 : 0,
    labClassificationAvailable: false,
    teachingLoadValidated: false,
    allocationValidated: false,
    courses: plannedSelections.courses.map((course) => ({
      id: course.id,
      code: course.code,
      declaredSeatCapacity: null,
      capacityBasis: 'UNSPECIFIED',
      plannedSelectionsPerDeclaredSeat: null,
      excessPlannedSelections: null,
    })),
  };
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const reloadButton = () => screen.getByRole('button', { name: 'Reload planned selections' });
const mount = (userId = ownerId, scenario = scope, resourceRevision: number | null = 3) =>
  render(
    <PlannedDemandPanel userId={userId} scope={scenario} resourceRevision={resourceRevision} />,
  );
const ready = async () => {
  await waitFor(() => expect(reloadButton()).toBeEnabled());
};
const expectNoReport = () => {
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByText(/students in the current assigned cohort/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Eligibility, recommendation demand/)).not.toBeInTheDocument();
  expect(screen.queryByText(/80.*classroom|classroom.*80/i)).not.toBeInTheDocument();
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue(session());
  vi.mocked(getSimulationCapacity).mockResolvedValue(snapshot());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('readonly current planned selections panel', () => {
  it('waits for a fresh matching admin session before reading the private report', async () => {
    const auth = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockReturnValueOnce(auth.promise);
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('Loading current planned selections');
    expect(reloadButton()).toBeDisabled();
    expect(getSimulationCapacity).not.toHaveBeenCalled();
    await act(async () => auth.resolve(session()));
    await ready();
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(getSimulationCapacity).toHaveBeenCalledExactlyOnceWith(scope);
    expect(getPlannedDemand).not.toHaveBeenCalled();
  });

  it.each([
    ['signed out', null],
    ['student role', { ...session(), role: 'STUDENT' as const }],
    ['another admin', session(otherOwnerId)],
  ])('denies the private report when the fresh session is %s', async (_label, account) => {
    vi.mocked(getSession).mockResolvedValue(account as unknown as AuthUserDTO);
    mount();
    await ready();
    expect(screen.getByRole('alert')).toHaveTextContent('Your admin session changed');
    expect(getSimulationCapacity).not.toHaveBeenCalled();
    expectNoReport();
  });

  it('allows a denied session to retry after the matching admin signs in', async () => {
    vi.mocked(getSession).mockResolvedValueOnce(null as unknown as AuthUserDTO);
    mount();
    await ready();
    fireEvent.click(reloadButton());
    await screen.findByRole('table');
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(getSimulationCapacity).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows distinct students separately from summed course selections and renders each course count', async () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const storageRemove = vi.spyOn(Storage.prototype, 'removeItem');
    mount();
    const table = await screen.findByRole('table');
    expect(screen.getByText(/3 students in the current assigned cohort/)).toHaveTextContent(
      '2 students have member-course selections, totaling 3 planned selections',
    );
    const programming = within(table).getByRole('row', { name: /IT001IU\s*Programming 2/ });
    expect(within(programming).getAllByRole('cell')[0]).toHaveTextContent('2');
    expect(within(table).getByRole('row', { name: /MA001IU\s*Calculus 1/ })).toBeInTheDocument();
    expect(screen.getByText(/1 selections outside the current curriculum/)).toBeInTheDocument();
    expect(screen.getByText(/selections are not filtered to that term/)).toBeInTheDocument();
    expect(screen.getByText(/Eligibility, recommendation demand/)).toHaveTextContent(
      'official offerings',
    );
    expect(saveResources).not.toHaveBeenCalled();
    expect(storageWrite).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it('clears verified rows and evidence during reload, failure, and retry', async () => {
    mount();
    await screen.findByRole('table');
    const pending = deferred<SimulationCapacitySnapshotDTO>();
    vi.mocked(getSimulationCapacity).mockReturnValueOnce(pending.promise);
    fireEvent.click(reloadButton());
    expectNoReport();
    expect(reloadButton()).toBeDisabled();
    await waitFor(() => expect(getSimulationCapacity).toHaveBeenCalledTimes(2));
    await act(async () => pending.reject(new Error('Offline')));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not verify planned selections');
    expectNoReport();
    const retry = deferred<SimulationCapacitySnapshotDTO>();
    vi.mocked(getSimulationCapacity).mockReturnValueOnce(retry.promise);
    fireEvent.click(reloadButton());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expectNoReport();
    await waitFor(() => expect(getSimulationCapacity).toHaveBeenCalledTimes(3));
    await act(async () => retry.resolve(snapshot()));
    await screen.findByRole('table');
    expect(getSession).toHaveBeenCalledTimes(3);
  });

  it('drops prior evidence when reload finds a changed session and never reads private demand', async () => {
    mount();
    await screen.findByRole('table');
    vi.mocked(getSession).mockResolvedValueOnce(session(otherOwnerId));
    fireEvent.click(reloadButton());
    await ready();
    expect(screen.getByRole('alert')).toHaveTextContent('Your admin session changed');
    expectNoReport();
    expect(getSimulationCapacity).toHaveBeenCalledTimes(1);
  });

  it('offers retry after session verification fails without reading private demand', async () => {
    vi.mocked(getSession).mockRejectedValueOnce(new Error('Offline'));
    mount();
    await ready();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not verify planned selections');
    expect(getSimulationCapacity).not.toHaveBeenCalled();
    fireEvent.click(reloadButton());
    await screen.findByRole('table');
  });

  it('deduplicates rapid reload clicks while session and report reads are pending', async () => {
    mount();
    await screen.findByRole('table');
    const auth = deferred<AuthUserDTO>();
    const report = deferred<SimulationCapacitySnapshotDTO>();
    vi.mocked(getSession).mockReturnValueOnce(auth.promise);
    vi.mocked(getSimulationCapacity).mockReturnValueOnce(report.promise);
    fireEvent.click(reloadButton());
    fireEvent.click(reloadButton());
    fireEvent.click(reloadButton());
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(getSimulationCapacity).toHaveBeenCalledTimes(1);
    await act(async () => auth.resolve(session()));
    expect(getSimulationCapacity).toHaveBeenCalledTimes(2);
    fireEvent.click(reloadButton());
    expect(getSession).toHaveBeenCalledTimes(2);
    await act(async () => report.resolve(snapshot()));
    await ready();
  });

  it.each(['curriculum', 'semester', 'year'] as const)(
    'clears existing evidence immediately when the %s scenario changes',
    async (dimension) => {
      const view = mount();
      await screen.findByRole('table');
      const pending = deferred<SimulationCapacitySnapshotDTO>();
      vi.mocked(getSimulationCapacity).mockReturnValueOnce(pending.promise);
      const next: ResourceScopeDTO = {
        ...scope,
        ...(dimension === 'curriculum' ? { curriculumId: otherCurriculumId } : {}),
        ...(dimension === 'semester' ? { semester: 'SPRING' as const } : {}),
        ...(dimension === 'year' ? { year: 2027 } : {}),
      };
      view.rerender(<PlannedDemandPanel userId={ownerId} scope={next} resourceRevision={3} />);
      expectNoReport();
      await waitFor(() => expect(getSimulationCapacity).toHaveBeenLastCalledWith(next));
      await act(async () =>
        pending.resolve(
          snapshot({
            scope: next,
            curriculum: { ...plannedSnapshot().curriculum, id: next.curriculumId },
          }),
        ),
      );
      await screen.findByRole('table');
    },
  );

  it('ignores an obsolete scenario A response after switching to B and back to A', async () => {
    const oldA = deferred<SimulationCapacitySnapshotDTO>();
    vi.mocked(getSimulationCapacity).mockReturnValueOnce(oldA.promise);
    const view = mount();
    await waitFor(() => expect(getSimulationCapacity).toHaveBeenCalledTimes(1));
    const b = { ...scope, year: 2027 };
    vi.mocked(getSimulationCapacity).mockResolvedValueOnce(snapshot({ scope: b }));
    view.rerender(<PlannedDemandPanel userId={ownerId} scope={b} resourceRevision={3} />);
    await screen.findByRole('table');
    view.rerender(<PlannedDemandPanel userId={ownerId} scope={scope} resourceRevision={3} />);
    await waitFor(() => expect(getSimulationCapacity).toHaveBeenCalledTimes(3));
    await screen.findByRole('table');
    const stale = snapshot();
    stale.plannedSelections.courses[0].name = 'Obsolete course evidence';
    await act(async () => oldA.resolve(stale));
    expect(screen.queryByText('Obsolete course evidence')).not.toBeInTheDocument();
    expect(screen.getByText('Programming')).toBeInTheDocument();
  });

  it('ignores an obsolete owner A session after switching to B and back to A', async () => {
    const oldAuth = deferred<AuthUserDTO>();
    vi.mocked(getSession).mockReturnValueOnce(oldAuth.promise);
    const view = mount();
    vi.mocked(getSession).mockResolvedValueOnce(session(otherOwnerId));
    view.rerender(<PlannedDemandPanel userId={otherOwnerId} scope={scope} resourceRevision={3} />);
    await screen.findByRole('table');
    view.rerender(<PlannedDemandPanel userId={ownerId} scope={scope} resourceRevision={3} />);
    await waitFor(() => expect(getSimulationCapacity).toHaveBeenCalledTimes(2));
    await screen.findByRole('table');
    await act(async () => oldAuth.resolve(session()));
    expect(getSimulationCapacity).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores an obsolete owner A report after switching to B and back to A', async () => {
    const oldReport = deferred<SimulationCapacitySnapshotDTO>();
    vi.mocked(getSimulationCapacity).mockReturnValueOnce(oldReport.promise);
    const view = mount();
    await waitFor(() => expect(getSimulationCapacity).toHaveBeenCalledTimes(1));
    vi.mocked(getSession).mockResolvedValueOnce(session(otherOwnerId));
    view.rerender(<PlannedDemandPanel userId={otherOwnerId} scope={scope} resourceRevision={3} />);
    await screen.findByRole('table');
    view.rerender(<PlannedDemandPanel userId={ownerId} scope={scope} resourceRevision={3} />);
    await waitFor(() => expect(getSimulationCapacity).toHaveBeenCalledTimes(3));
    await screen.findByRole('table');
    await act(async () => oldReport.reject(new Error('Obsolete owner failure')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('normalizes owner and curriculum UUIDs before comparing the session and requesting demand', async () => {
    vi.mocked(getSession).mockResolvedValue(session(ownerId.toUpperCase()));
    const value = snapshot();
    vi.mocked(getSimulationCapacity).mockResolvedValue({
      ...value,
      plannedSelections: {
        ...value.plannedSelections,
        scope: { ...scope, curriculumId: curriculumId.toUpperCase() },
        curriculum: { ...value.plannedSelections.curriculum, id: curriculumId.toUpperCase() },
        courses: value.plannedSelections.courses.map((course) => ({
          ...course,
          id: course.id.toUpperCase(),
        })),
      },
      courses: value.courses.map((course) => ({ ...course, id: course.id.toUpperCase() })),
    });
    mount(ownerId.toUpperCase(), { ...scope, curriculumId: curriculumId.toUpperCase() });
    await screen.findByRole('table');
    expect(getSimulationCapacity).toHaveBeenCalledExactlyOnceWith(scope);
  });

  it.each([
    [
      'unvalidated supply',
      { courses: plannedSnapshot().courses.map((course) => ({ ...course, supply: 40 })) },
    ],
    ['fabricated recommendations', { recommendationDemandAvailable: true }],
    ['private student data', { students: [{ id: otherOwnerId }] }],
    ['inconsistent totals', { plannedSelectionCount: 99 }],
    [
      'duplicate course identity',
      {
        courses: [plannedSnapshot().courses[0], plannedSnapshot().courses[0]],
        plannedSelectionCount: 4,
      },
    ],
    ['missing resource revision', { resourceRevision: undefined }],
  ])('rejects %s and displays no partial report', async (_label, changes) => {
    vi.mocked(getSimulationCapacity).mockResolvedValue({
      ...snapshot(),
      plannedSelections: { ...plannedSnapshot(), ...changes },
    } as unknown as SimulationCapacitySnapshotDTO);
    mount();
    await ready();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not verify planned selections');
    expectNoReport();
  });

  it.each([
    { ...scope, curriculumId: otherCurriculumId },
    { ...scope, semester: 'SPRING' as const },
    { ...scope, year: 2027 },
  ])('rejects a valid report for a different scenario %j', async (wrongScope) => {
    vi.mocked(getSimulationCapacity).mockResolvedValue(
      snapshot({
        scope: wrongScope,
        curriculum: { ...plannedSnapshot().curriculum, id: wrongScope.curriculumId },
      }),
    );
    mount();
    await ready();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not verify planned selections');
    expectNoReport();
  });

  it('rejects an invalid scenario before reading the session or private demand', async () => {
    mount(ownerId, { ...scope, year: 1999 });
    await ready();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not verify planned selections');
    expect(getSession).not.toHaveBeenCalled();
    expect(getSimulationCapacity).not.toHaveBeenCalled();
  });

  it('renders explicit zero counts for member courses when the assigned cohort is empty', async () => {
    vi.mocked(getSimulationCapacity).mockResolvedValue(
      snapshot({
        cohortStudentCount: 0,
        plannedStudentCount: 0,
        plannedSelectionCount: 0,
        ignoredNonmemberSelectionCount: 0,
        courses: plannedSnapshot().courses.map((course) => ({ ...course, plannedStudentCount: 0 })),
      }),
    );
    mount();
    const table = await screen.findByRole('table');
    expect(
      screen.getByText('No students are currently assigned to this curriculum.'),
    ).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /IT001IU\s*Programming 0/ })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /MA001IU\s*Calculus 0/ })).toBeInTheDocument();
  });

  it('shows an empty reference with assigned students without borrowing global course rows', async () => {
    vi.mocked(getSimulationCapacity).mockResolvedValue(
      snapshot({ courses: [], plannedStudentCount: 0, plannedSelectionCount: 0 }),
    );
    mount();
    await ready();
    expect(
      screen.getByText('No courses are listed in this reference curriculum.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No member courses are currently planned by this cohort.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Programming')).not.toBeInTheDocument();
  });

  it('keeps a zero-count current member course in the report without deriving placement or demand', async () => {
    const value = snapshot();
    value.plannedSelections.courses[1].plannedStudentCount = 0;
    value.plannedSelections.plannedSelectionCount = 2;
    vi.mocked(getSimulationCapacity).mockResolvedValue(value);
    mount();
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('row', { name: /MA001IU\s*Calculus 0/ })).toBeInTheDocument();
    expect(screen.queryByText(/unplaced/i)).not.toBeInTheDocument();
  });

  it.each([
    [3, 4],
    [null, 3],
    [3, null],
  ])(
    'warns when form resource revision %s differs from report revision %s',
    async (formRevision, reportRevision) => {
      vi.mocked(getSimulationCapacity).mockResolvedValue(
        snapshot({ resourceRevision: reportRevision }),
      );
      mount(ownerId, scope, formRevision);
      await screen.findByRole('table');
      expect(screen.getByRole('status')).toHaveTextContent(
        'The report uses a different saved resource revision from the form',
      );
      expect(screen.getByRole('status')).toHaveTextContent('it replaces unsaved edits');
      expect(screen.getByRole('status')).toHaveTextContent('leaves your form edits unchanged');
      expect(saveResources).not.toHaveBeenCalled();
    },
  );

  it('accepts no saved settings without treating unknown capacity as zero', async () => {
    vi.mocked(getSimulationCapacity).mockResolvedValue(snapshot({ resourceRevision: null }));
    mount(ownerId, scope, null);
    await screen.findByRole('table');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText(/Eligibility, recommendation demand/)).toBeInTheDocument();
    expect(screen.getByText(/No saved resource settings/)).toHaveTextContent(
      'classroom proxy are unknown',
    );
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
  });

  it('rechecks demand when confirmed resource revision changes and clears the old proof', async () => {
    const view = mount();
    await screen.findByRole('table');
    const report = deferred<SimulationCapacitySnapshotDTO>();
    vi.mocked(getSimulationCapacity).mockReturnValueOnce(report.promise);
    view.rerender(<PlannedDemandPanel userId={ownerId} scope={scope} resourceRevision={4} />);
    expectNoReport();
    await waitFor(() => expect(getSimulationCapacity).toHaveBeenCalledTimes(2));
    await act(async () => report.resolve(snapshot({ resourceRevision: 4 })));
    await screen.findByRole('table');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it('shows unknown declared seats and excess without converting the classroom proxy into course supply', async () => {
    mount();
    const table = await screen.findByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Course', 'Students planned', 'Declared seats', 'Above limit']);
    const row = within(table).getByRole('row', { name: /IT001IU\s*Programming/ });
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['2', 'Unknown', 'Unknown']);
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
    expect(
      within(table).queryByRole('columnheader', { name: /utilization|supply/i }),
    ).not.toBeInTheDocument();
    expect(getPlannedDemand).not.toHaveBeenCalled();
  });

  it('provides a named keyboard-focusable region for the full course comparison table', async () => {
    mount();
    const comparison = await screen.findByRole('region', { name: 'Course seat comparison' });
    expect(comparison).toHaveAttribute('tabindex', '0');
    comparison.focus();
    expect(comparison).toHaveFocus();
    const table = within(comparison).getByRole('table', {
      name: 'Current planned selections and declared seats',
    });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    expect(within(table).getAllByRole('cell', { name: 'Unknown' })).toHaveLength(4);
    expect(
      screen.getByText('Scroll the course table horizontally to see every column.'),
    ).toBeInTheDocument();
  });

  it('shows an explicit zero seat limit and its excess separately from an unspecified course', async () => {
    const value = snapshot();
    value.courses[0] = {
      ...value.courses[0],
      declaredSeatCapacity: 0,
      capacityBasis: 'EXPLICIT_COURSE_OVERRIDE',
      plannedSelectionsPerDeclaredSeat: null,
      excessPlannedSelections: 2,
    };
    vi.mocked(getSimulationCapacity).mockResolvedValue(value);
    mount();
    const table = await screen.findByRole('table');
    const zero = within(table).getByRole('row', { name: /IT001IU\s*Programming/ });
    const unknown = within(table).getByRole('row', { name: /MA001IU\s*Calculus/ });
    expect(
      within(zero)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['2', '0', '2']);
    expect(
      within(unknown)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['1', 'Unknown', 'Unknown']);
    expect(screen.queryByText(/Infinity|NaN|\d+%/)).not.toBeInTheDocument();
  });

  it('shows declared positive seats and excess using the same snapshot as current selections', async () => {
    const value = snapshot();
    value.courses[0] = {
      ...value.courses[0],
      declaredSeatCapacity: 1,
      capacityBasis: 'EXPLICIT_COURSE_OVERRIDE',
      plannedSelectionsPerDeclaredSeat: 2,
      excessPlannedSelections: 1,
    };
    value.courses[1] = {
      ...value.courses[1],
      declaredSeatCapacity: 40,
      capacityBasis: 'EXPLICIT_COURSE_OVERRIDE',
      plannedSelectionsPerDeclaredSeat: 1 / 40,
      excessPlannedSelections: 0,
    };
    vi.mocked(getSimulationCapacity).mockResolvedValue(value);
    mount();
    const table = await screen.findByRole('table');
    const excess = within(table).getByRole('row', { name: /IT001IU\s*Programming/ });
    const spare = within(table).getByRole('row', { name: /MA001IU\s*Calculus/ });
    expect(
      within(excess)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['2', '1', '1']);
    expect(
      within(spare)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['1', '40', '0']);
    expect(getSimulationCapacity).toHaveBeenCalledTimes(1);
    expect(getPlannedDemand).not.toHaveBeenCalled();
  });

  it('describes the classroom proxy separately and reports excluded historical overrides', async () => {
    mount();
    await screen.findByRole('table');
    const proxy = screen.getByText(/80.*classroom|classroom.*80/i);
    expect(proxy).toHaveTextContent(/one simultaneous section per room/i);
    expect(proxy).toHaveTextContent(/not semester supply/i);
    expect(proxy).toHaveTextContent(/not assigned to individual courses/i);
    expect(screen.getByText(/1.*override.*outside|1.*outside.*override/i)).toBeInTheDocument();
    expect(
      screen.getByText(/allocation.*not.*validated|not.*validated.*allocation/i),
    ).toBeInTheDocument();
  });

  it.each([
    ['mismatched course rows', { courses: [...snapshot().courses].reverse() }],
    [
      'fabricated room proxy',
      { classroomSeatProxy: { basis: 'ONE_SIMULTANEOUS_CLASSROOM_SECTION_PER_ROOM', seats: 999 } },
    ],
    ['allocation claim', { allocationValidated: true }],
    [
      'inconsistent course diagnostics',
      {
        courses: [{ ...snapshot().courses[0], excessPlannedSelections: 0 }, snapshot().courses[1]],
      },
    ],
  ])('rejects %s without showing count or capacity evidence', async (_label, changes) => {
    vi.mocked(getSimulationCapacity).mockResolvedValue({
      ...snapshot(),
      ...changes,
    } as unknown as SimulationCapacitySnapshotDTO);
    mount();
    await ready();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not verify planned selections');
    expectNoReport();
    expect(screen.queryByText(/80.*classroom|classroom.*80/i)).not.toBeInTheDocument();
  });
});
