import {
  SimulationSemesterAllocationInputSchema,
  SimulationSemesterAllocationResultSchema,
  type SimulationSemesterAllocationInputDTO,
} from '@iu-study-planner/shared';
import { readSimulationAllocationPolicy } from '../config/simulationAllocation';
import { allocateSimulationSemester } from '../services/simulationSemesterAllocation';
import { projectSimulationResourceEnvelope } from '../services/schoolResourceEnvelope';

const course = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const studentId = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const a = course(1),
  b = course(2),
  c = course(3);
const policy = readSimulationAllocationPolicy({});
const student = (n: number, targetCredits: number, choices: [string, number][]) => ({
  studentId: studentId(n),
  targetCredits,
  candidates: choices.map(([courseId, studentUtility]) => ({ courseId, studentUtility })),
});
const input = (
  credits: [string, number][],
  students: SimulationSemesterAllocationInputDTO['students'],
): SimulationSemesterAllocationInputDTO => ({
  courses: credits.map(([courseId, credits]) => ({ courseId, credits })),
  students,
});
function envelope(sections = 2, seats = 2, missing = false) {
  return projectSimulationResourceEnvelope(
    {
      kind: 'SIMULATION',
      curriculum: { id: a, code: 'SIM', name: 'Simulation', school: 'CSE' },
      semester: 'FALL',
      year: 2026,
      resource: missing
        ? null
        : {
            id: b,
            curriculumId: a,
            semester: 'FALL',
            year: 2026,
            professors: sections,
            classrooms: sections,
            labRooms: 0,
            maxStudentsPerSection: seats,
            courseOverrides: {},
            revision: 1,
            updatedBy: studentId(99),
            createdAt: '2026-10-06T00:00:00.000Z',
            updatedAt: '2026-10-06T00:00:00.000Z',
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
const trace = (result: ReturnType<typeof allocateSimulationSemester>) =>
  result.assignments.map((row) => [row.round, row.studentId, row.courseId]);
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe('pure bounded semester credit allocation', () => {
  it('protects a one-choice student before a lower-ID flexible student at a scarce seat', () => {
    const result = allocateSimulationSemester(
      envelope(1, 1),
      input(
        [
          [a, 3],
          [b, 3],
        ],
        [
          student(1, 6, [
            [a, 1],
            [b, 0.8],
          ]),
          student(2, 3, [[a, 0.1]]),
        ],
      ),
      policy,
    );
    expect(trace(result)).toEqual([[1, studentId(2), a]]);
    expect(result.students).toEqual([
      {
        studentId: studentId(1),
        targetCredits: 6,
        courseIds: [],
        assignedCredits: 0,
        remainingCredits: 6,
        reason: 'CAPACITY_EXHAUSTED',
      },
      {
        studentId: studentId(2),
        targetCredits: 3,
        courseIds: [a],
        assignedCredits: 3,
        remainingCredits: 0,
        reason: 'TARGET_REACHED',
      },
    ]);
    expect(result.usedSections).toBe(1);
  });

  it('enforces a round barrier rather than giving one student an entire semester first', () => {
    const result = allocateSimulationSemester(
      envelope(2, 2),
      input(
        [
          [a, 3],
          [b, 3],
        ],
        [
          student(1, 6, [
            [a, 1],
            [b, 0.9],
          ]),
          student(2, 6, [
            [a, 1],
            [b, 0.9],
          ]),
        ],
      ),
      policy,
    );
    expect(trace(result)).toEqual([
      [1, studentId(1), a],
      [1, studentId(2), a],
      [2, studentId(1), b],
      [2, studentId(2), b],
    ]);
    expect(result).toMatchObject({
      rounds: 2,
      usedSections: 2,
      assignedCourseCount: 4,
      assignedStudentCount: 2,
    });
    expect(
      result.students.map(({ courseIds, assignedCredits, remainingCredits, reason }) => ({
        courseIds,
        assignedCredits,
        remainingCredits,
        reason,
      })),
    ).toEqual([
      { courseIds: [a, b], assignedCredits: 6, remainingCredits: 0, reason: 'TARGET_REACHED' },
      { courseIds: [a, b], assignedCredits: 6, remainingCredits: 0, reason: 'TARGET_REACHED' },
    ]);
    expect(result.assignments[0]).toMatchObject({
      feasibleChoiceCount: 2,
      studentUtility: 1,
      resourceUtilization: 1,
      fairness: 0.5,
      credits: 3,
    });
    expect(result.assignments[0].resourceFit).toBeCloseTo(0.85, 12);
    expect(result.assignments[0].weightedScore).toBeCloseTo(0.8875, 12);
    expect(result.assignments[2]).toMatchObject({
      feasibleChoiceCount: 1,
      resourceUtilization: 1,
      fairness: 1,
    });
    expect(result.assignments[2].weightedScore).toBeCloseTo(0.9025, 12);
  });

  it('breaks equal current scarcity by fewer assigned credits before student UUID', () => {
    const result = allocateSimulationSemester(
      envelope(3, 1),
      input(
        [
          [a, 4],
          [b, 1],
          [c, 2],
        ],
        [
          student(1, 10, [
            [a, 1],
            [c, 0],
          ]),
          student(2, 6, [
            [b, 1],
            [c, 0],
          ]),
        ],
      ),
      policy,
    );
    expect(trace(result)).toEqual([
      [1, studentId(1), a],
      [1, studentId(2), b],
      [2, studentId(2), c],
    ]);
    expect(result.students).toEqual([
      {
        studentId: studentId(1),
        targetCredits: 10,
        courseIds: [a],
        assignedCredits: 4,
        remainingCredits: 6,
        reason: 'CAPACITY_EXHAUSTED',
      },
      {
        studentId: studentId(2),
        targetCredits: 6,
        courseIds: [b, c],
        assignedCredits: 3,
        remainingCredits: 3,
        reason: 'NO_REMAINING_CHOICES',
      },
    ]);
  });

  it('reuses an earlier round’s spare seats after the shared section ceiling is spent', () => {
    const result = allocateSimulationSemester(
      envelope(2, 2),
      input(
        [
          [a, 1],
          [b, 2],
        ],
        [
          student(1, 3, [
            [a, 0],
            [b, 1],
          ]),
          student(2, 2, [[b, 1]]),
        ],
      ),
      policy,
    );
    expect(trace(result)).toEqual([
      [1, studentId(2), b],
      [1, studentId(1), a],
      [2, studentId(1), b],
    ]);
    expect(result.courses).toEqual([
      {
        courseId: a,
        credits: 1,
        demandStudentCount: 1,
        openedSections: 1,
        seatCapacity: 2,
        assignedStudentCount: 1,
      },
      {
        courseId: b,
        credits: 2,
        demandStudentCount: 2,
        openedSections: 1,
        seatCapacity: 2,
        assignedStudentCount: 2,
      },
    ]);
    expect(result.usedSections).toBe(2);
    expect(result.assignments[2]).toMatchObject({ resourceUtilization: 1, feasibleChoiceCount: 1 });
  });

  it('recomputes capacity scarcity after each seat and never reassigns an already chosen course', () => {
    const result = allocateSimulationSemester(
      envelope(1, 2),
      input(
        [
          [a, 1],
          [b, 1],
        ],
        [
          student(1, 2, [
            [a, 1],
            [b, 0.9],
          ]),
          student(2, 1, [[b, 1]]),
          student(3, 2, [
            [a, 0.8],
            [b, 1],
          ]),
        ],
      ),
      policy,
    );
    expect(trace(result)).toEqual([
      [1, studentId(2), b],
      [1, studentId(1), b],
    ]);
    expect(result.rounds).toBe(1);
    expect(result.students[0]).toMatchObject({
      courseIds: [b],
      assignedCredits: 1,
      remainingCredits: 1,
      reason: 'CAPACITY_EXHAUSTED',
    });
    expect(result.students[2]).toMatchObject({ courseIds: [], reason: 'CAPACITY_EXHAUSTED' });
  });

  it('respects mixed credit sizes and reports a shortfall instead of rounding or overfilling', () => {
    const result = allocateSimulationSemester(
      envelope(3, 2),
      input(
        [
          [a, 4],
          [b, 3],
          [c, 0],
        ],
        [
          student(1, 5, [
            [a, 1],
            [b, 0.8],
            [c, 0],
          ]),
        ],
      ),
      policy,
    );
    expect(trace(result)).toEqual([
      [1, studentId(1), a],
      [2, studentId(1), c],
    ]);
    expect(result.students).toEqual([
      {
        studentId: studentId(1),
        targetCredits: 5,
        courseIds: [a, c],
        assignedCredits: 4,
        remainingCredits: 1,
        reason: 'CREDIT_LIMIT',
      },
    ]);
    expect(result.courses.find((row) => row.courseId === b)).toMatchObject({
      openedSections: 0,
      assignedStudentCount: 0,
    });
    expect(result).toMatchObject({ rounds: 2, assignedCourseCount: 2, usedSections: 2 });
  });

  it('terminates a positive target with only zero-credit choices after consuming each choice once', () => {
    const result = allocateSimulationSemester(
      envelope(3, 1),
      input(
        [
          [a, 0],
          [b, 0],
          [c, 0],
        ],
        [
          student(1, 1, [
            [c, 1],
            [b, 1],
            [a, 1],
          ]),
        ],
      ),
      policy,
    );
    expect(trace(result)).toEqual([
      [1, studentId(1), a],
      [2, studentId(1), b],
      [3, studentId(1), c],
    ]);
    expect(result.students).toEqual([
      {
        studentId: studentId(1),
        targetCredits: 1,
        courseIds: [a, b, c],
        assignedCredits: 0,
        remainingCredits: 1,
        reason: 'NO_REMAINING_CHOICES',
      },
    ]);
    expect(result).toMatchObject({
      rounds: 3,
      assignedCourseCount: 3,
      assignedStudentCount: 1,
      usedSections: 3,
    });
  });

  it('stops target-zero and exact-target students before allocating surplus zero-credit choices', () => {
    const result = allocateSimulationSemester(
      envelope(2, 2),
      input(
        [
          [a, 3],
          [b, 0],
        ],
        [
          student(1, 0, [
            [a, 1],
            [b, 1],
          ]),
          student(2, 3, [
            [a, 1],
            [b, 0],
          ]),
        ],
      ),
      policy,
    );
    expect(trace(result)).toEqual([[1, studentId(2), a]]);
    expect(result.students.map((row) => row.reason)).toEqual(['TARGET_REACHED', 'TARGET_REACHED']);
    expect(result.students[0]).toMatchObject({
      assignedCredits: 0,
      courseIds: [],
      remainingCredits: 0,
    });
    expect(result.courses.find((row) => row.courseId === b)?.assignedStudentCount).toBe(0);
  });

  it('terminates at the hundred-choice round boundary even when all credits are zero', () => {
    const catalog = Array.from(
      { length: 100 },
      (_, offset) => [course(offset + 1), 0] as [string, number],
    );
    const result = allocateSimulationSemester(
      envelope(100, 1),
      input(catalog, [
        student(
          1,
          1,
          catalog.map(([id]) => [id, 1]),
        ),
      ]),
      policy,
    );
    expect(result.assignments.map((row) => row.round)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1),
    );
    expect(result.students[0]).toEqual({
      studentId: studentId(1),
      targetCredits: 1,
      courseIds: catalog.map(([id]) => id),
      assignedCredits: 0,
      remainingCredits: 1,
      reason: 'NO_REMAINING_CHOICES',
    });
    expect(result).toMatchObject({
      rounds: 100,
      usedSections: 100,
      assignedCourseCount: 100,
      assignedStudentCount: 1,
    });
  });

  it('opens another section only after the existing seats are filled and keeps original demand', () => {
    const result = allocateSimulationSemester(
      envelope(2, 2),
      input(
        [[a, 3]],
        Array.from({ length: 3 }, (_, offset) => student(offset + 1, 3, [[a, 1]])),
      ),
      policy,
    );
    expect(trace(result)).toEqual([
      [1, studentId(1), a],
      [1, studentId(2), a],
      [1, studentId(3), a],
    ]);
    expect(result.assignments.map((row) => row.resourceUtilization)).toEqual([1.5, 1.5, 0.75]);
    expect(result.assignments.map((row) => row.resourceFit)).toEqual([0.35, 0.35, 1]);
    expect(result.assignments[0].weightedScore).toBeCloseTo(0.8375, 12);
    expect(result.assignments[2].weightedScore).toBe(1);
    expect(result.courses).toEqual([
      {
        courseId: a,
        credits: 3,
        demandStudentCount: 3,
        openedSections: 2,
        seatCapacity: 4,
        assignedStudentCount: 3,
      },
    ]);
  });

  it('excludes a saturated choice when an under-capacity alternative exists despite lower utility', () => {
    const result = allocateSimulationSemester(
      envelope(2, 2),
      input(
        [
          [a, 3],
          [b, 3],
        ],
        [
          student(1, 3, [
            [a, 1],
            [b, 0],
          ]),
          student(2, 0, [[a, 1]]),
        ],
      ),
      policy,
    );
    expect(trace(result)).toEqual([[1, studentId(1), b]]);
    expect(result.assignments[0]).toMatchObject({
      studentUtility: 0,
      feasibleChoiceCount: 2,
      resourceUtilization: 0.5,
      resourceFit: 1,
      fairness: 0.5,
      weightedScore: 0.325,
    });
    expect(result.courses[0]).toMatchObject({ demandStudentCount: 2, openedSections: 0 });
  });

  it('never invents same-slot prerequisite unlocks or unsupplied eligible choices from the catalog', () => {
    const result = allocateSimulationSemester(
      envelope(2, 2),
      input(
        [
          [a, 3],
          [b, 3],
        ],
        [student(1, 6, [[a, 1]])],
      ),
      policy,
    );
    expect(trace(result)).toEqual([[1, studentId(1), a]]);
    expect(result.students[0]).toMatchObject({
      remainingCredits: 3,
      reason: 'NO_REMAINING_CHOICES',
    });
    expect(result.courses.find((row) => row.courseId === b)).toEqual({
      courseId: b,
      credits: 3,
      demandStudentCount: 0,
      openedSections: 0,
      seatCapacity: 0,
      assignedStudentCount: 0,
    });
  });

  it('distinguishes no choices, exhausted credits, unknown resources and known zero capacity', () => {
    const source = input(
      [[a, 3]],
      [
        student(1, 0, [[a, 1]]),
        student(2, 3, []),
        student(3, 2, [[a, 1]]),
        student(4, 3, [[a, 1]]),
      ],
    );
    const missing = allocateSimulationSemester(envelope(0, 2, true), source, policy);
    expect(missing.students.map((row) => row.reason)).toEqual([
      'TARGET_REACHED',
      'NO_REMAINING_CHOICES',
      'CREDIT_LIMIT',
      'RESOURCE_UNKNOWN',
    ]);
    const zero = allocateSimulationSemester(envelope(0, 2), source, policy);
    expect(zero.students.map((row) => row.reason)).toEqual([
      'TARGET_REACHED',
      'NO_REMAINING_CHOICES',
      'CREDIT_LIMIT',
      'CAPACITY_EXHAUSTED',
    ]);
    expect(missing.rounds).toBe(0);
    expect(zero.usedSections).toBe(0);
  });

  it('is deterministic across shuffled students, catalog and choices and normalized UUID casing', () => {
    const source = input(
      [
        [a, 3],
        [b, 2],
        [c, 0],
      ],
      [
        student(1, 5, [
          [a, 1],
          [b, 0.8],
          [c, 0],
        ]),
        student(2, 5, [
          [b, 1],
          [a, 0.8],
        ]),
      ],
    );
    const reversed = {
      courses: [...source.courses]
        .reverse()
        .map((row) => ({ ...row, courseId: row.courseId.toUpperCase() })),
      students: [...source.students]
        .reverse()
        .map((row) => ({
          ...row,
          studentId: row.studentId.toUpperCase(),
          candidates: [...row.candidates]
            .reverse()
            .map((choice) => ({ ...choice, courseId: choice.courseId.toUpperCase() })),
        })),
    };
    expect(allocateSimulationSemester(envelope(3, 2), reversed, policy)).toEqual(
      allocateSimulationSemester(envelope(3, 2), source, policy),
    );
  });

  it('accepts deeply frozen sources without mutation and makes only internal simulation claims', () => {
    const resource = deepFreeze(envelope());
    const source = deepFreeze(
      input(
        [
          [a, 3],
          [b, 3],
        ],
        [
          student(1, 6, [
            [a, 1],
            [b, 0.9],
          ]),
        ],
      ),
    );
    const weights = deepFreeze({ ...policy });
    const before = JSON.stringify({ resource, source, weights });
    const result = allocateSimulationSemester(resource, source, weights);
    expect(JSON.stringify({ resource, source, weights })).toBe(before);
    expect(result).toMatchObject({
      kind: 'SIMULATION',
      usage: 'INTERNAL_REFERENCE_ONLY',
      model: 'SEMESTER_CREDIT_BUDGET_V1',
      eligibilityValidated: false,
      allocationValidated: false,
      timetableValidated: false,
      persisted: false,
    });
    expect(JSON.stringify(result)).not.toContain('updatedBy');
    expect(SimulationSemesterAllocationResultSchema.parse(result)).toEqual(result);
  });

  it('handles an empty roster and unused catalog without inventing assignments', () => {
    expect(allocateSimulationSemester(envelope(), input([[a, 3]], []), policy)).toMatchObject({
      students: [],
      assignments: [],
      assignedCourseCount: 0,
      assignedStudentCount: 0,
      usedSections: 0,
      rounds: 0,
    });
  });

  it('accepts the 500-student/10,000-choice input boundary without executing target-zero work', () => {
    const catalog = Array.from(
      { length: 20 },
      (_, offset) => [course(offset + 1), 3] as [string, number],
    );
    const source = input(
      catalog,
      Array.from({ length: 500 }, (_, offset) =>
        student(
          offset + 1,
          0,
          catalog.map(([id]) => [id, 1]),
        ),
      ),
    );
    const result = allocateSimulationSemester(envelope(20, 500), source, policy);
    expect(result.students).toHaveLength(500);
    expect(result.input.students.reduce((count, row) => count + row.candidates.length, 0)).toBe(
      10000,
    );
    expect(result).toMatchObject({
      assignments: [],
      rounds: 0,
      usedSections: 0,
      assignedCourseCount: 0,
    });
  });

  it.each([
    input(
      [],
      Array.from({ length: 501 }, (_, offset) => student(offset + 1, 0, [])),
    ),
    input(
      Array.from({ length: 101 }, (_, offset) => [course(offset + 1), 0] as [string, number]),
      [
        student(
          1,
          1,
          Array.from({ length: 101 }, (_, offset) => [course(offset + 1), 1]),
        ),
      ],
    ),
    input(
      Array.from({ length: 100 }, (_, offset) => [course(offset + 1), 0] as [string, number]),
      Array.from({ length: 101 }, (_, offset) =>
        student(
          offset + 1,
          0,
          Array.from({ length: offset === 100 ? 1 : 100 }, (_, index) => [course(index + 1), 1]),
        ),
      ),
    ),
  ])('rejects work above a student, per-student choice or total-choice limit %#', (source) => {
    expect(SimulationSemesterAllocationInputSchema.safeParse(source).success).toBe(false);
    expect(() => allocateSimulationSemester(envelope(), source, policy)).toThrow();
  });

  it.each([
    {
      courses: [
        { courseId: a, credits: 3 },
        { courseId: a.toUpperCase(), credits: 3 },
      ],
      students: [],
    },
    input(
      [[a, 3]],
      [student(1, 3, []), { ...student(1, 3, []), studentId: studentId(1).toUpperCase() }],
    ),
    input(
      [[a, 3]],
      [
        student(1, 3, [
          [a, 1],
          [a.toUpperCase(), 0.5],
        ]),
      ],
    ),
    input([[a, 3]], [student(1, 3, [[b, 1]])]),
    input([[a, -1]], []),
    input([[a, 10.5]], []),
    input([[a, 11]], []),
    input([[a, 3]], [student(1, 31, [[a, 1]])]),
    input([[a, 3]], [student(1, -1, [[a, 1]])]),
    input([[a, 3]], [student(1, 1.5, [[a, 1]])]),
    input([[a, 3]], [student(1, NaN, [[a, 1]])]),
    input([[a, 3]], [student(1, 3, [[a, Infinity]])]),
    input([[a, 3]], [student(1, 3, [[a, -0.1]])]),
    input([[a, 3]], [student(1, 3, [[a, 1.1]])]),
    { courses: [{ courseId: a, credits: 3, prerequisiteIds: [b] }], students: [] },
    { courses: [], students: [{ ...student(1, 0, []), completedCourseIds: [] }] },
    {
      courses: [{ courseId: a, credits: 3 }],
      students: [
        { ...student(1, 3, []), candidates: [{ courseId: a, studentUtility: 1, gradeFit: 1 }] },
      ],
    },
    { ...input([[a, 3]], []), prerequisitePolicy: 'IGNORE' },
    { courses: [{ courseId: `${a}\n`, credits: 3 }], students: [] },
  ])('rejects malformed, duplicate, unknown or expanded frozen choice input %#', (source) => {
    expect(SimulationSemesterAllocationInputSchema.safeParse(source).success).toBe(false);
    expect(() =>
      allocateSimulationSemester(
        envelope(),
        source as SimulationSemesterAllocationInputDTO,
        policy,
      ),
    ).toThrow();
  });
});
