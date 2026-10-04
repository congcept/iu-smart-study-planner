import { z } from 'zod';
import {
  SimulationCapacitySnapshotSchema,
  type PlannedDemandSnapshotDTO,
  type ResourcesSnapshotDTO,
} from '@iu-study-planner/shared';
import { projectSimulationCapacity } from '../services/schoolSupply';

const context = {
  id: 'aaaaaaaa-1111-4111-8111-111111111111',
  code: 'CAPACITY',
  name: 'Capacity reference',
  school: 'Simulation school',
};
function demand(): PlannedDemandSnapshotDTO {
  return {
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    scope: { curriculumId: context.id, semester: 'FALL', year: 2026 },
    curriculum: { ...context },
    planningBasis: 'CURRENT_PLANNED_SELECTIONS',
    termBasis: 'SCENARIO_ONLY',
    recommendationDemandAvailable: false,
    eligibilityValidated: false,
    offeringValidationAvailable: false,
    resourceRevision: 2,
    cohortStudentCount: 4,
    plannedStudentCount: 3,
    plannedSelectionCount: 5,
    ignoredNonmemberSelectionCount: 1,
    courses: [
      {
        id: 'bbbbbbbb-1111-4111-8111-111111111111',
        code: 'A',
        name: 'A',
        plannedStudentCount: 3,
        supply: null,
        utilization: null,
      },
      {
        id: 'bbbbbbbb-2222-4222-8222-222222222222',
        code: 'B',
        name: 'B',
        plannedStudentCount: 2,
        supply: null,
        utilization: null,
      },
      {
        id: 'bbbbbbbb-3333-4333-8333-333333333333',
        code: 'C',
        name: 'C',
        plannedStudentCount: 0,
        supply: null,
        utilization: null,
      },
    ],
  };
}
function resources(): ResourcesSnapshotDTO {
  return {
    kind: 'SIMULATION',
    curriculum: { ...context },
    semester: 'FALL',
    year: 2026,
    resource: {
      id: 'cccccccc-1111-4111-8111-111111111111',
      curriculumId: context.id,
      semester: 'FALL',
      year: 2026,
      professors: 5,
      classrooms: 2,
      labRooms: 3,
      maxStudentsPerSection: 40,
      courseOverrides: {
        A: { capacity: 2 },
        B: { capacity: 0 },
        C: { professorCount: 2 },
        OLD: { capacity: 99 },
      },
      revision: 2,
      updatedBy: 'dddddddd-1111-4111-8111-111111111111',
      createdAt: '2026-10-04T00:00:00.000Z',
      updatedAt: '2026-10-04T00:00:00.000Z',
    },
  };
}
function configured() {
  const snapshot = resources();
  if (!snapshot.resource) throw new Error('Fixture requires resources');
  return { snapshot, row: snapshot.resource };
}

describe('explicit simulation capacity projection', () => {
  it('computes hand-checked ratios and excess against absolute explicit seats', () => {
    const result = projectSimulationCapacity(demand(), resources());
    expect(result.courses[0]).toEqual({
      id: demand().courses[0].id,
      code: 'A',
      declaredSeatCapacity: 2,
      capacityBasis: 'EXPLICIT_COURSE_OVERRIDE',
      plannedSelectionsPerDeclaredSeat: 1.5,
      excessPlannedSelections: 1,
    });
    expect(result.classroomSeatProxy).toEqual({
      basis: 'ONE_SIMULTANEOUS_CLASSROOM_SECTION_PER_ROOM',
      seats: 80,
    });
    expect(result.ignoredNonmemberOverrideCount).toBe(1);
  });

  it('keeps zero seats explicit with a null ratio and all selections in excess', () => {
    expect(projectSimulationCapacity(demand(), resources()).courses[1]).toMatchObject({
      declaredSeatCapacity: 0,
      capacityBasis: 'EXPLICIT_COURSE_OVERRIDE',
      plannedSelectionsPerDeclaredSeat: null,
      excessPlannedSelections: 2,
    });
  });

  it('leaves professor-only and absent overrides unspecified despite room inventory', () => {
    const { snapshot, row } = configured();
    delete row.courseOverrides.A;
    const result = projectSimulationCapacity(demand(), snapshot);
    for (const index of [0, 2])
      expect(result.courses[index]).toMatchObject({
        declaredSeatCapacity: null,
        capacityBasis: 'UNSPECIFIED',
        plannedSelectionsPerDeclaredSeat: null,
        excessPlannedSelections: null,
      });
    expect(result.resources).toEqual({
      professors: 5,
      classrooms: 2,
      labRooms: 3,
      maxStudentsPerSection: 40,
    });
  });

  it.each([3, 4])('computes full and spare capacity for %i seats', (capacity) => {
    const { snapshot, row } = configured();
    row.courseOverrides.A.capacity = capacity;
    expect(projectSimulationCapacity(demand(), snapshot).courses[0]).toMatchObject({
      plannedSelectionsPerDeclaredSeat: 3 / capacity,
      excessPlannedSelections: 0,
    });
  });

  it('preserves zero-selection members without placements or enrollment assumptions', () => {
    const { snapshot, row } = configured();
    row.courseOverrides.C = { capacity: 1 };
    const result = projectSimulationCapacity(demand(), snapshot);
    expect(result.courses).toHaveLength(3);
    expect(result.courses[2]).toMatchObject({
      declaredSeatCapacity: 1,
      plannedSelectionsPerDeclaredSeat: 0,
      excessPlannedSelections: 0,
    });
    expect(result.plannedSelections).toEqual(demand());
  });

  it('returns unknown capacities when no resource configuration exists', () => {
    const planned = demand();
    planned.resourceRevision = null;
    const snapshot = resources();
    snapshot.resource = null;
    const result = projectSimulationCapacity(planned, snapshot);
    expect(result.resources).toBeNull();
    expect(result.classroomSeatProxy).toBeNull();
    expect(result.ignoredNonmemberOverrideCount).toBe(0);
    expect(
      result.courses.every(
        (course) =>
          course.declaredSeatCapacity === null &&
          course.excessPlannedSelections === null &&
          course.plannedSelectionsPerDeclaredSeat === null,
      ),
    ).toBe(true);
  });

  it('accepts an empty context and counts all stale overrides without inventing courses', () => {
    const planned = demand();
    planned.courses = [];
    planned.plannedStudentCount = 0;
    planned.plannedSelectionCount = 0;
    const result = projectSimulationCapacity(planned, resources());
    expect(result.courses).toEqual([]);
    expect(result.ignoredNonmemberOverrideCount).toBe(4);
  });

  it('handles the bounded maximum classroom product without truncating it', () => {
    const { snapshot, row } = configured();
    row.classrooms = 100000;
    row.maxStudentsPerSection = 100000;
    expect(projectSimulationCapacity(demand(), snapshot).classroomSeatProxy?.seats).toBe(
      10000000000,
    );
  });

  it('normalizes UUIDs before scenario and course alignment', () => {
    const planned = demand();
    planned.scope.curriculumId = context.id.toUpperCase();
    planned.curriculum.id = context.id.toUpperCase();
    planned.courses[0].id = planned.courses[0].id.toUpperCase();
    expect(projectSimulationCapacity(planned, resources()).courses[0].id).toBe(
      demand().courses[0].id,
    );
  });

  it('does not expose audits, raw overrides or student identity', () => {
    const result = projectSimulationCapacity(demand(), resources());
    expect(result).toMatchObject({
      kind: 'SIMULATION',
      usage: 'REFERENCE_ONLY',
      model: 'EXPLICIT_COURSE_CAPACITY_ONLY',
      labClassificationAvailable: false,
      teachingLoadValidated: false,
      allocationValidated: false,
    });
    const serialized = JSON.stringify(result);
    for (const field of [
      'updatedBy',
      'createdAt',
      'updatedAt',
      'courseOverrides',
      'professorCount',
      'OLD',
    ])
      expect(serialized).not.toContain(field);
  });

  it.each(['semester', 'year', 'curriculum', 'revision', 'missingResources'] as const)(
    'rejects mismatched %s as a server metadata failure',
    (field) => {
      const { snapshot, row } = configured();
      if (field === 'semester') {
        snapshot.semester = 'SPRING';
        row.semester = 'SPRING';
      }
      if (field === 'year') {
        snapshot.year = 2027;
        row.year = 2027;
      }
      if (field === 'curriculum') {
        snapshot.curriculum.code = 'OTHER';
      }
      if (field === 'revision') {
        row.revision = 3;
      }
      if (field === 'missingResources') {
        snapshot.resource = null;
      }
      expect(() => projectSimulationCapacity(demand(), snapshot)).toThrow(Error);
      try {
        projectSimulationCapacity(demand(), snapshot);
      } catch (error) {
        expect(error).not.toBeInstanceOf(z.ZodError);
      }
    },
  );

  it.each(
    [
      { A: { capacity: -1 } },
      { A: { capacity: 100001 } },
      { A: { capacity: 1.5 } },
      { A: { capacity: 1, sections: 2 } },
      { A: {} },
      { ' A': { capacity: 1 } },
      { constructor: { capacity: 1 } },
      [],
      null,
    ].map((overrides: unknown) => ({ overrides })),
  )('rejects malformed persisted override JSON: %j', ({ overrides }) => {
    const { snapshot, row } = configured();
    row.courseOverrides = overrides as unknown as typeof row.courseOverrides;
    expect(() => projectSimulationCapacity(demand(), snapshot)).toThrow(
      'Stored simulation capacity metadata',
    );
  });

  it('validates every persisted override, including a malformed nonmember entry', () => {
    const { snapshot, row } = configured();
    row.courseOverrides.OLD.capacity = -1;
    expect(() => projectSimulationCapacity(demand(), snapshot)).toThrow(
      'Stored simulation capacity metadata',
    );
  });

  it('rejects corrupt resource counts and nested planned totals', () => {
    const { snapshot, row } = configured();
    row.classrooms = -1;
    expect(() => projectSimulationCapacity(demand(), snapshot)).toThrow(
      'Stored simulation capacity metadata',
    );
    const planned = demand();
    planned.plannedSelectionCount = 6;
    expect(() => projectSimulationCapacity(planned, resources())).toThrow(
      'Stored simulation capacity metadata',
    );
  });
});

describe('simulation capacity response contract', () => {
  it.each([
    'extra',
    'nestedExtra',
    'order',
    'missingCourse',
    'duplicate',
    'basis',
    'ratio',
    'excess',
    'proxy',
    'resourceRevision',
    'allocation',
  ] as const)('rejects contradictory or unknown %s metadata', (field) => {
    const result = projectSimulationCapacity(demand(), resources());
    let payload: unknown = result;
    if (field === 'extra') payload = { ...result, audit: 'private' };
    if (field === 'nestedExtra')
      payload = { ...result, resources: { ...result.resources, courseOverrides: {} } };
    if (field === 'order') result.courses.reverse();
    if (field === 'missingCourse') result.courses.pop();
    if (field === 'duplicate') result.courses[1] = { ...result.courses[0] };
    if (field === 'basis') result.courses[0].capacityBasis = 'UNSPECIFIED';
    if (field === 'ratio') result.courses[0].plannedSelectionsPerDeclaredSeat = 1.5000000000000002;
    if (field === 'excess') result.courses[0].excessPlannedSelections = 0;
    if (field === 'proxy' && result.classroomSeatProxy) result.classroomSeatProxy.seats = 81;
    if (field === 'resourceRevision') result.plannedSelections.resourceRevision = null;
    if (field === 'allocation') payload = { ...result, allocationValidated: true };
    expect(SimulationCapacitySnapshotSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects configuration-free declared capacity or stale override counts', () => {
    const planned = demand();
    planned.resourceRevision = null;
    const snapshot = resources();
    snapshot.resource = null;
    const result = projectSimulationCapacity(planned, snapshot);
    expect(
      SimulationCapacitySnapshotSchema.safeParse({ ...result, ignoredNonmemberOverrideCount: 1 })
        .success,
    ).toBe(false);
    result.courses[0] = {
      ...result.courses[0],
      declaredSeatCapacity: 1,
      capacityBasis: 'EXPLICIT_COURSE_OVERRIDE',
      plannedSelectionsPerDeclaredSeat: 3,
      excessPlannedSelections: 2,
    };
    expect(SimulationCapacitySnapshotSchema.safeParse(result).success).toBe(false);
  });
});
