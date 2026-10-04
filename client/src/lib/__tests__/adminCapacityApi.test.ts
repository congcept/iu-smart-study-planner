import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PlannedDemandSnapshotDTO,
  ResourceScopeDTO,
  SimulationCapacitySnapshotDTO,
} from '@iu-study-planner/shared';
import apiClient from '../api';
import { getSimulationCapacity } from '../adminResourcesApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const curriculumId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const firstId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const secondId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const scope: ResourceScopeDTO = { curriculumId, semester: 'FALL', year: 2026 };
const plannedSelections = (): PlannedDemandSnapshotDTO => ({
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
      id: firstId,
      code: 'IT001IU',
      name: 'Programming',
      plannedStudentCount: 2,
      supply: null,
      utilization: null,
    },
    {
      id: secondId,
      code: 'MA001IU',
      name: 'Calculus',
      plannedStudentCount: 1,
      supply: null,
      utilization: null,
    },
  ],
});
const snapshot = (): SimulationCapacitySnapshotDTO => ({
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  model: 'EXPLICIT_COURSE_CAPACITY_ONLY',
  plannedSelections: plannedSelections(),
  resources: { professors: 5, classrooms: 2, labRooms: 1, maxStudentsPerSection: 40 },
  classroomSeatProxy: { basis: 'ONE_SIMULTANEOUS_CLASSROOM_SECTION_PER_ROOM', seats: 80 },
  ignoredNonmemberOverrideCount: 1,
  labClassificationAvailable: false,
  teachingLoadValidated: false,
  allocationValidated: false,
  courses: [
    {
      id: firstId,
      code: 'IT001IU',
      declaredSeatCapacity: 1,
      capacityBasis: 'EXPLICIT_COURSE_OVERRIDE',
      plannedSelectionsPerDeclaredSeat: 2,
      excessPlannedSelections: 1,
    },
    {
      id: secondId,
      code: 'MA001IU',
      declaredSeatCapacity: null,
      capacityBasis: 'UNSPECIFIED',
      plannedSelectionsPerDeclaredSeat: null,
      excessPlannedSelections: null,
    },
  ],
});
const envelope = (data: unknown) => ({ data: { success: true, data } });
const firstCourseChanged = (changes: Record<string, unknown>) => {
  const value = snapshot();
  return { ...value, courses: [{ ...value.courses[0], ...changes }, value.courses[1]] };
};
async function expectRejected(values: unknown[]) {
  for (const value of values) {
    get.mockResolvedValueOnce(envelope(value));
    await expect(getSimulationCapacity(scope)).rejects.toThrow();
  }
  expect(get).toHaveBeenCalledTimes(values.length);
  expect(post).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue(envelope(snapshot()));
});

describe('readonly simulation capacity adapter', () => {
  it('reads the explicit scenario once without a resource write or additional demand request', async () => {
    expect(await getSimulationCapacity(scope)).toEqual(snapshot());
    expect(get).toHaveBeenCalledExactlyOnceWith('/admin/capacity', { params: scope });
    expect(post).not.toHaveBeenCalled();
  });

  it('normalizes request and nested report UUIDs before matching scope and aligned course rows', async () => {
    const value = snapshot();
    value.plannedSelections.scope = { ...scope, curriculumId: curriculumId.toUpperCase() };
    value.plannedSelections.curriculum.id = curriculumId.toUpperCase();
    value.plannedSelections.courses = value.plannedSelections.courses.map((course) => ({
      ...course,
      id: course.id.toUpperCase(),
    }));
    value.courses = value.courses.map((course) => ({ ...course, id: course.id.toUpperCase() }));
    get.mockResolvedValue(envelope(value));
    expect(
      await getSimulationCapacity({ ...scope, curriculumId: curriculumId.toUpperCase() }),
    ).toEqual(snapshot());
    expect(get).toHaveBeenCalledExactlyOnceWith('/admin/capacity', { params: scope });
  });

  it('preserves unknown course capacities when no resource scenario has been saved', async () => {
    const value = snapshot();
    value.resources = null;
    value.classroomSeatProxy = null;
    value.plannedSelections.resourceRevision = null;
    value.ignoredNonmemberOverrideCount = 0;
    value.courses = value.courses.map((course) => ({
      ...course,
      declaredSeatCapacity: null,
      capacityBasis: 'UNSPECIFIED',
      plannedSelectionsPerDeclaredSeat: null,
      excessPlannedSelections: null,
    }));
    get.mockResolvedValue(envelope(value));
    expect(await getSimulationCapacity(scope)).toEqual(value);
  });

  it('keeps an explicit zero override with unknown ratio and the entire planned count as excess', async () => {
    const value = snapshot();
    value.courses[0] = {
      ...value.courses[0],
      declaredSeatCapacity: 0,
      plannedSelectionsPerDeclaredSeat: null,
      excessPlannedSelections: 2,
    };
    get.mockResolvedValue(envelope(value));
    expect((await getSimulationCapacity(scope)).courses[0]).toEqual(value.courses[0]);
  });

  it('preserves a fractional positive ratio and zero excess below the explicit capacity', async () => {
    const value = snapshot();
    value.courses[0] = {
      ...value.courses[0],
      declaredSeatCapacity: 3,
      plannedSelectionsPerDeclaredSeat: 2 / 3,
      excessPlannedSelections: 0,
    };
    get.mockResolvedValue(envelope(value));
    expect((await getSimulationCapacity(scope)).courses[0]).toEqual(value.courses[0]);
  });

  it('does not replace an oversubscribed explicit capacity with spare classroom seats', async () => {
    const value = await getSimulationCapacity(scope);
    expect(value.classroomSeatProxy?.seats).toBe(80);
    expect(value.courses[0].declaredSeatCapacity).toBe(1);
    expect(value.courses[0].plannedSelectionsPerDeclaredSeat).toBe(2);
    expect(value.courses[0].excessPlannedSelections).toBe(1);
    expect(value.plannedSelections.courses[0].supply).toBeNull();
    expect(value.plannedSelections.courses[0].utilization).toBeNull();
  });

  it('keeps an unspecified course unknown even with professors, lab rooms and a positive classroom proxy', async () => {
    const value = await getSimulationCapacity(scope);
    expect(value.resources?.professors).toBe(5);
    expect(value.courses[1]).toEqual({
      id: secondId,
      code: 'MA001IU',
      declaredSeatCapacity: null,
      capacityBasis: 'UNSPECIFIED',
      plannedSelectionsPerDeclaredSeat: null,
      excessPlannedSelections: null,
    });
  });

  it('accepts a zero classroom proxy without interpreting it as zero course capacity', async () => {
    const value = snapshot();
    value.resources = { professors: 5, classrooms: 0, labRooms: 4, maxStudentsPerSection: 40 };
    value.classroomSeatProxy = { basis: 'ONE_SIMULTANEOUS_CLASSROOM_SECTION_PER_ROOM', seats: 0 };
    get.mockResolvedValue(envelope(value));
    const report = await getSimulationCapacity(scope);
    expect(report.classroomSeatProxy?.seats).toBe(0);
    expect(report.courses[0].declaredSeatCapacity).toBe(1);
    expect(report.courses[1].declaredSeatCapacity).toBeNull();
  });

  it('accepts an empty current reference without adding global courses', async () => {
    const value = snapshot();
    value.plannedSelections.courses = [];
    value.plannedSelections.plannedStudentCount = 0;
    value.plannedSelections.plannedSelectionCount = 0;
    value.courses = [];
    get.mockResolvedValue(envelope(value));
    expect((await getSimulationCapacity(scope)).courses).toEqual([]);
  });

  it('rejects invalid or expanded request scopes before HTTP', async () => {
    for (const changes of [
      { curriculumId: 'CS' },
      { semester: 'WINTER' },
      { year: '2026' },
      { year: 2026.5 },
      { year: 1999 },
      { userId: otherId },
      { courseIds: [firstId] },
    ]) {
      await expect(
        getSimulationCapacity({ ...scope, ...changes } as unknown as ResourceScopeDTO),
      ).rejects.toThrow();
    }
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    { ...scope, curriculumId: otherId },
    { ...scope, semester: 'SPRING' as const },
    { ...scope, year: 2027 },
  ])('rejects a valid capacity report with different nested scope %j', async (wrongScope) => {
    const value = snapshot();
    value.plannedSelections.scope = wrongScope;
    value.plannedSelections.curriculum.id = wrongScope.curriculumId;
    await expectRejected([value]);
  });

  it.each([null, { success: false, data: snapshot() }, { success: true }])(
    'rejects absent or unsuccessful response envelopes %j',
    async (data) => {
      get.mockResolvedValue({ data });
      await expect(getSimulationCapacity(scope)).rejects.toThrow();
      expect(get).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects private student fields at the report, selection and capacity row boundaries', async () => {
    const value = snapshot();
    await expectRejected([
      { ...value, students: [{ id: otherId }] },
      { ...value, plannedSelections: { ...value.plannedSelections, studentIds: [otherId] } },
      firstCourseChanged({ students: [{ id: otherId, name: 'Private student' }] }),
      { ...value, resources: { ...value.resources, updatedBy: otherId } },
    ]);
  });

  it('rejects upgraded validation claims and unsupported capacity models', async () => {
    const value = snapshot();
    await expectRejected([
      { ...value, kind: 'OFFICIAL' },
      { ...value, model: 'CLASSROOM_POOL_PER_COURSE' },
      { ...value, labClassificationAvailable: true },
      { ...value, teachingLoadValidated: true },
      { ...value, allocationValidated: true },
    ]);
  });

  it('validates nested planned selections rather than trusting their totals or recommendation claims', async () => {
    const value = snapshot();
    await expectRejected([
      { ...value, plannedSelections: { ...value.plannedSelections, plannedSelectionCount: 99 } },
      { ...value, plannedSelections: { ...value.plannedSelections, resourceRevision: 0 } },
      {
        ...value,
        plannedSelections: { ...value.plannedSelections, recommendationDemandAvailable: true },
      },
      { ...value, plannedSelections: { ...value.plannedSelections, cohortStudentCount: 1 } },
    ]);
  });

  it('rejects duplicate, missing, reordered or misidentified capacity course rows', async () => {
    const value = snapshot();
    await expectRejected([
      { ...value, courses: [value.courses[0], value.courses[0]] },
      { ...value, courses: [value.courses[0]] },
      { ...value, courses: [...value.courses].reverse() },
      firstCourseChanged({ id: otherId }),
      firstCourseChanged({ code: 'OTHER' }),
    ]);
  });

  it('rejects a fabricated ratio or excess for a positive declared capacity', async () => {
    await expectRejected([
      firstCourseChanged({ plannedSelectionsPerDeclaredSeat: 0.5 }),
      firstCourseChanged({ plannedSelectionsPerDeclaredSeat: null }),
      firstCourseChanged({ excessPlannedSelections: 0 }),
      firstCourseChanged({ plannedSelectionsPerDeclaredSeat: Infinity }),
      firstCourseChanged({ plannedSelectionsPerDeclaredSeat: NaN }),
    ]);
  });

  it('rejects zero-capacity division and an excess count inconsistent with planned selections', async () => {
    await expectRejected([
      firstCourseChanged({
        declaredSeatCapacity: 0,
        plannedSelectionsPerDeclaredSeat: 0,
        excessPlannedSelections: 2,
      }),
      firstCourseChanged({
        declaredSeatCapacity: 0,
        plannedSelectionsPerDeclaredSeat: null,
        excessPlannedSelections: 1,
      }),
    ]);
  });

  it('rejects unspecified capacity with numerical ratio, excess, or an explicit basis', async () => {
    await expectRejected([
      firstCourseChanged({
        declaredSeatCapacity: null,
        capacityBasis: 'UNSPECIFIED',
        plannedSelectionsPerDeclaredSeat: 0,
        excessPlannedSelections: null,
      }),
      firstCourseChanged({
        declaredSeatCapacity: null,
        capacityBasis: 'UNSPECIFIED',
        plannedSelectionsPerDeclaredSeat: null,
        excessPlannedSelections: 0,
      }),
      firstCourseChanged({
        declaredSeatCapacity: null,
        capacityBasis: 'EXPLICIT_COURSE_OVERRIDE',
        plannedSelectionsPerDeclaredSeat: null,
        excessPlannedSelections: null,
      }),
      firstCourseChanged({ capacityBasis: 'UNSPECIFIED' }),
    ]);
  });

  it('rejects declared capacity outside integer limits and invalid excluded-override counts', async () => {
    const value = snapshot();
    await expectRejected([
      firstCourseChanged({ declaredSeatCapacity: -1 }),
      firstCourseChanged({ declaredSeatCapacity: 1.5 }),
      firstCourseChanged({ declaredSeatCapacity: 100001 }),
      { ...value, ignoredNonmemberOverrideCount: -1 },
      { ...value, ignoredNonmemberOverrideCount: 1.5 },
    ]);
  });

  it('rejects a classroom proxy inconsistent with room counts, section size, or its stated basis', async () => {
    const value = snapshot();
    await expectRejected([
      { ...value, classroomSeatProxy: { ...value.classroomSeatProxy, seats: 81 } },
      {
        ...value,
        classroomSeatProxy: { ...value.classroomSeatProxy, basis: 'OFFICIAL_TIMETABLE' },
      },
      { ...value, classroomSeatProxy: null },
      { ...value, resources: { ...value.resources, maxStudentsPerSection: 0 } },
      { ...value, resources: { ...value.resources, classrooms: -1 } },
    ]);
  });

  it('rejects evidence of saved capacity or overrides when resources are absent', async () => {
    const value = snapshot();
    const absent = {
      ...value,
      resources: null,
      classroomSeatProxy: null,
      ignoredNonmemberOverrideCount: 0,
      plannedSelections: { ...value.plannedSelections, resourceRevision: null },
      courses: value.courses.map((course) => ({
        ...course,
        declaredSeatCapacity: null,
        capacityBasis: 'UNSPECIFIED',
        plannedSelectionsPerDeclaredSeat: null,
        excessPlannedSelections: null,
      })),
    };
    await expectRejected([
      { ...absent, courses: value.courses },
      { ...absent, classroomSeatProxy: value.classroomSeatProxy },
      { ...absent, plannedSelections: value.plannedSelections },
      { ...absent, ignoredNonmemberOverrideCount: 1 },
    ]);
  });

  it('rejects saved resources without a nested confirmed resource revision', async () => {
    const value = snapshot();
    await expectRejected([
      { ...value, plannedSelections: { ...value.plannedSelections, resourceRevision: null } },
    ]);
  });

  it.each([{ response: { status: 403 } }, new Error('Network unavailable')])(
    'propagates access and transport failures without returning zeros or retrying automatically',
    async (failure) => {
      get.mockRejectedValueOnce(failure);
      await expect(getSimulationCapacity(scope)).rejects.toBe(failure);
      expect(get).toHaveBeenCalledTimes(1);
      expect(post).not.toHaveBeenCalled();
    },
  );
});
