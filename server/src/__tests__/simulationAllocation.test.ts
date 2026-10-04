import {
  SimulationAllocationPolicySchema,
  SimulationAllocationResultSchema,
  SimulationAllocationRosterSchema,
  type SimulationAllocationPolicyDTO,
  type SimulationAllocationRosterDTO,
} from '@iu-study-planner/shared';
import { readSimulationAllocationPolicy } from '../config/simulationAllocation';
import { allocateSimulationRound } from '../services/simulationAllocation';
import { projectSimulationResourceEnvelope } from '../services/schoolResourceEnvelope';

const courseA = 'aaaaaaaa-0000-4000-8000-000000000001';
const courseB = 'bbbbbbbb-0000-4000-8000-000000000002';
const studentId = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const student = (
  n: number,
  choices: [string, number][],
): SimulationAllocationRosterDTO[number] => ({
  studentId: studentId(n),
  candidates: choices.map(([courseId, studentUtility]) => ({ courseId, studentUtility })),
});
const policy = readSimulationAllocationPolicy({});
function envelope(sections = 1, seats = 2, missing = false) {
  const curriculum = { id: courseA, code: 'SIM', name: 'Simulation', school: 'CSE' };
  return projectSimulationResourceEnvelope(
    {
      kind: 'SIMULATION',
      curriculum,
      semester: 'FALL',
      year: 2026,
      resource: missing
        ? null
        : {
            id: courseB,
            curriculumId: courseA,
            semester: 'FALL',
            year: 2026,
            professors: sections,
            classrooms: sections,
            labRooms: 17,
            maxStudentsPerSection: seats,
            courseOverrides: {},
            revision: 1,
            updatedBy: studentId(99),
            createdAt: '2026-10-04T00:00:00.000Z',
            updatedAt: '2026-10-04T00:00:00.000Z',
          },
    },
    {
      model: 'SHARED_CLASSROOM_SECTION_ENVELOPE_V1',
      classroomTimeBlocks: 1,
      sectionsPerProfessor: 1,
      roomBasis: 'ONE_CLASSROOM_SECTION_PER_ROOM_PER_BLOCK',
      teachingBasis: 'ONE_PROFESSOR_PER_SECTION_PER_BLOCK',
      sectionDurationBasis: 'ONE_SIMULATED_BLOCK',
      professorAssignmentBasis: 'INTERCHANGEABLE_FOR_ENVELOPE_ONLY',
    },
  );
}

describe('one-course simulation allocation round', () => {
  it('protects the student with one option before a lower-ID flexible student', () => {
    const result = allocateSimulationRound(
      envelope(1, 1),
      [
        student(1, [
          [courseA, 1],
          [courseB, 0.8],
        ]),
        student(2, [[courseA, 0.1]]),
      ],
      policy,
    );
    expect(result.assignments.map(({ studentId: id, courseId }) => [id, courseId])).toEqual([
      [studentId(2), courseA],
    ]);
    expect(result.unassigned).toEqual([{ studentId: studentId(1), reason: 'CAPACITY_EXHAUSTED' }]);
    expect(result.usedSections).toBe(1);
  });
  it('reuses the chosen course section after all shared section opportunities are spent', () => {
    const result = allocateSimulationRound(
      envelope(1, 2),
      [
        student(1, [[courseA, 1]]),
        student(2, [[courseB, 1]]),
        student(3, [
          [courseA, 0.1],
          [courseB, 1],
        ]),
      ],
      policy,
    );
    expect(result.assignments.map(({ studentId: id }) => id)).toEqual([studentId(1), studentId(3)]);
    expect(result.assignments[1].feasibleChoiceCount).toBe(1);
    expect(result.unassigned).toEqual([{ studentId: studentId(2), reason: 'CAPACITY_EXHAUSTED' }]);
    expect(result.courses.find(({ courseId }) => courseId === courseA)).toMatchObject({
      openedSections: 1,
      seatCapacity: 2,
      assignedStudentCount: 2,
    });
  });
  it('opens additional sections only as packed course seats fill and never exceeds the shared budget', () => {
    const result = allocateSimulationRound(
      envelope(2, 2),
      Array.from({ length: 7 }, (_, n) => student(n + 1, [[courseA, 0.8]])),
      policy,
    );
    expect(result).toMatchObject({
      usedSections: 2,
      assignedStudentCount: 4,
      unassignedStudentCount: 3,
    });
    expect(result.courses).toEqual([
      {
        courseId: courseA,
        demandStudentCount: 7,
        openedSections: 2,
        seatCapacity: 4,
        assignedStudentCount: 4,
      },
    ]);
    expect(result.assignments.map(({ resourceUtilization }) => resourceUtilization)).toEqual([
      3.5, 3.5, 1.75, 1.75,
    ]);
  });
  it('defers a saturated choice when an under-saturated feasible alternative exists', () => {
    const result = allocateSimulationRound(
      envelope(2, 2),
      [
        student(1, [
          [courseA, 1],
          [courseB, 0],
        ]),
        student(2, [[courseA, 1]]),
      ],
      policy,
    );
    expect(result.assignments.find(({ studentId: id }) => id === studentId(1))).toMatchObject({
      courseId: courseB,
      feasibleChoiceCount: 2,
      resourceUtilization: 0.5,
      fairness: 0.5,
    });
    expect(result.usedSections).toBe(2);
  });
  it('retains choices when all feasible alternatives are saturated', () => {
    const result = allocateSimulationRound(
      envelope(2, 1),
      [
        student(1, [
          [courseA, 0.9],
          [courseB, 1],
        ]),
        student(2, [[courseA, 1]]),
      ],
      policy,
    );
    expect(result.assignedStudentCount).toBe(2);
    expect(result.assignments.find(({ studentId: id }) => id === studentId(1))?.courseId).toBe(
      courseB,
    );
  });
  it('computes hand-checked normalized score components from applied weights', () => {
    const row = allocateSimulationRound(envelope(1, 1), [student(1, [[courseA, 0.8]])], policy)
      .assignments[0];
    expect(row.resourceUtilization).toBe(1);
    expect(row.resourceFit).toBeCloseTo(0.85, 12);
    expect(row.fairness).toBe(1);
    expect(row.weightedScore).toBeCloseTo(0.8425, 12);
  });
  it.each([
    [17, 1],
    [18, 0.95],
    [20, 0.85],
  ] as const)(
    'applies congestion above the exact threshold for %i/20 original demand',
    (count, expectedFit) => {
      const rows = Array.from({ length: count }, (_, n) => student(n + 1, [[courseA, 0.5]]));
      const result = allocateSimulationRound(envelope(1, 20), rows, policy);
      expect(result.assignments[0].resourceFit).toBeCloseTo(expectedFit, 12);
    },
  );
  it('changes course ranking with resource-fit weights without changing scarcity order', () => {
    const roster = [
      student(1, [
        [courseA, 1],
        [courseB, 0.9],
      ]),
      ...Array.from({ length: 8 }, (_, n) => student(n + 2, [[courseA, 1]])),
    ];
    const usual = allocateSimulationRound(envelope(2, 10), roster, policy);
    const resourceOnly = allocateSimulationRound(envelope(2, 10), roster, {
      ...policy,
      studentUtilityWeight: 0,
      resourceFitWeight: 1,
      fairnessWeight: 0,
    });
    expect(usual.assignments.at(-1)?.studentId).toBe(studentId(1));
    expect(usual.assignments.at(-1)?.courseId).toBe(courseA);
    expect(resourceOnly.assignments.at(-1)?.courseId).toBe(courseB);
  });
  it('keeps both input permutations and uppercase UUIDs deterministic', () => {
    const roster = [
      student(3, [
        [courseB, 0.8],
        [courseA, 0.8],
      ]),
      student(2, [[courseA, 0.8]]),
      student(1, [[courseB, 0.8]]),
    ];
    const first = allocateSimulationRound(envelope(2, 2), roster, policy);
    const reversed = roster
      .slice()
      .reverse()
      .map((row) => ({
        studentId: row.studentId.toUpperCase(),
        candidates: row.candidates
          .slice()
          .reverse()
          .map((choice) => ({ ...choice, courseId: choice.courseId.toUpperCase() })),
      }));
    expect(allocateSimulationRound(envelope(2, 2), reversed, policy)).toEqual(first);
    expect(first.assignments[0].studentId).toBe(studentId(1));
  });
  it('uses normalized course UUID ties when scores and feasibility agree', () => {
    const result = allocateSimulationRound(
      envelope(1, 3),
      [
        student(1, [
          [courseB, 0.5],
          [courseA, 0.5],
        ]),
      ],
      policy,
    );
    expect(result.assignments[0].courseId).toBe(courseA);
  });
  it('distinguishes empty choices, missing resources and configured zero opportunities', () => {
    const roster = [student(1, []), student(2, [[courseA, 0.5]])];
    const missing = allocateSimulationRound(envelope(0, 2, true), roster, policy);
    expect(missing.unassigned).toEqual([
      { studentId: studentId(1), reason: 'NO_CHOICES' },
      { studentId: studentId(2), reason: 'RESOURCE_UNKNOWN' },
    ]);
    expect(missing.envelope.envelope).toBeNull();
    const zero = allocateSimulationRound(envelope(0, 2), roster, policy);
    expect(zero.unassigned).toEqual([
      { studentId: studentId(1), reason: 'NO_CHOICES' },
      { studentId: studentId(2), reason: 'CAPACITY_EXHAUSTED' },
    ]);
    expect(zero.envelope.envelope?.sharedSeatCeiling).toBe(0);
    expect(missing.assignments).toEqual([]);
    expect(zero.assignments).toEqual([]);
  });
  it('preserves inputs and declares the internal simulation and persistence limits', () => {
    const sourceEnvelope = envelope();
    const roster = [student(1, [[courseA, 1]])];
    const before = JSON.stringify({ sourceEnvelope, roster, policy });
    const result = allocateSimulationRound(sourceEnvelope, roster, policy);
    expect(JSON.stringify({ sourceEnvelope, roster, policy })).toBe(before);
    expect(result).toMatchObject({
      kind: 'SIMULATION',
      usage: 'INTERNAL_REFERENCE_ONLY',
      model: 'ONE_COURSE_PER_STUDENT_ROUND_V1',
      utilityBasis: 'SUPPLIED_NORMALIZED_ELIGIBLE_CHOICES',
      eligibilityValidated: false,
      allocationValidated: false,
      timetableValidated: false,
      persisted: false,
    });
    expect(JSON.stringify(result)).not.toContain('updatedBy');
    expect(SimulationAllocationResultSchema.parse(result)).toEqual(result);
  });
  it('accepts an empty roster without inventing demand or allocations', () => {
    expect(allocateSimulationRound(envelope(), [], policy)).toMatchObject({
      rosterStudentIds: [],
      assignments: [],
      unassigned: [],
      courses: [],
      usedSections: 0,
      assignedStudentCount: 0,
      unassignedStudentCount: 0,
    });
  });
  it('handles accepted policy floating-point tolerance without an out-of-range score', () => {
    const almostUnit: SimulationAllocationPolicyDTO = {
      ...policy,
      studentUtilityWeight: 0.600000000001,
    };
    expect(SimulationAllocationPolicySchema.safeParse(almostUnit).success).toBe(true);
    const result = allocateSimulationRound(
      envelope(1, 2),
      [student(1, [[courseA, 1]])],
      almostUnit,
    );
    expect(result.assignments[0].weightedScore).toBeLessThanOrEqual(1);
    expect(SimulationAllocationResultSchema.safeParse(result).success).toBe(true);
  });
  it.each(
    [
      [student(1, []), student(1, [])],
      [student(1, []), { ...student(1, []), studentId: studentId(1).toUpperCase() }],
      [
        student(1, [
          [courseA, 1],
          [courseA.toUpperCase(), 0],
        ]),
      ],
      [{ studentId: 'invalid', candidates: [] }],
      [{ studentId: studentId(1), candidates: [{ courseId: 'invalid', studentUtility: 0.5 }] }],
      [student(1, [[courseA, -0.1]])],
      [student(1, [[courseA, 1.1]])],
      [student(1, [[courseA, NaN]])],
      [student(1, [[courseA, Infinity]])],
      [{ ...student(1, []), completedIds: [] }],
    ].map((roster) => ({ roster })),
  )('rejects malformed or duplicate choice matrices %#', ({ roster }) => {
    expect(SimulationAllocationRosterSchema.safeParse(roster).success).toBe(false);
    expect(() => allocateSimulationRound(envelope(), roster, policy)).toThrow();
  });
  it.each([
    ['usedSections', 99],
    ['assignedStudentCount', 99],
    ['unassignedStudentCount', 99],
    ['allocationValidated', true],
    ['persisted', true],
    ['userEmail', 'private@example.test'],
  ])('rejects corrupt or misleading result field %s', (key, value) => {
    const valid = allocateSimulationRound(envelope(), [student(1, [[courseA, 1]])], policy);
    expect(SimulationAllocationResultSchema.safeParse({ ...valid, [key]: value }).success).toBe(
      false,
    );
  });
  it('checks roster partition, seat accounting, utilization and weighted-score arithmetic', () => {
    const valid = allocateSimulationRound(envelope(), [student(1, [[courseA, 1]])], policy);
    for (const patch of [
      { fairness: 0 },
      { resourceUtilization: 100 },
      { resourceFit: 0 },
      { weightedScore: 0 },
    ])
      expect(
        SimulationAllocationResultSchema.safeParse({
          ...valid,
          assignments: [{ ...valid.assignments[0], ...patch }],
        }).success,
      ).toBe(false);
    expect(
      SimulationAllocationResultSchema.safeParse({ ...valid, rosterStudentIds: [] }).success,
    ).toBe(false);
    expect(
      SimulationAllocationResultSchema.safeParse({
        ...valid,
        courses: [{ ...valid.courses[0], seatCapacity: 99 }],
      }).success,
    ).toBe(false);
    expect(
      SimulationAllocationResultSchema.safeParse({
        ...valid,
        assignments: [valid.assignments[0], valid.assignments[0]],
        assignedStudentCount: 2,
      }).success,
    ).toBe(false);
  });
});
