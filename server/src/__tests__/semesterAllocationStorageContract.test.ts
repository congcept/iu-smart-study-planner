import {
  CreateSemesterAllocationRunSchema,
  OwnSemesterAllocationRunV1Schema,
  SemesterAllocationResultV1Schema,
  SemesterAllocationRunV1Schema,
  SemesterAllocationStorageV1Schema,
  type OwnSemesterAllocationRunV1DTO,
  type SemesterAllocationResultV1DTO,
  type SemesterAllocationRunV1DTO,
  type SemesterAllocationStorageV1DTO,
} from '@iu-study-planner/shared';

const a = 'aaaaaaaa-0000-4000-8000-000000000001';
const b = 'aaaaaaaa-0000-4000-8000-000000000002';
const first = 'cccccccc-0000-4000-8000-000000000001';
const second = 'cccccccc-0000-4000-8000-000000000002';
const runId = 'dddddddd-0000-4000-8000-000000000001';
const metadata = () => ({
  id: runId,
  formatVersion: 1 as const,
  capturedAt: '2026-10-06T01:00:00.000Z',
  createdAt: '2026-10-06T01:00:01.000Z',
  snapshotStored: true as const,
  simulationAssignmentsStored: true as const,
});

// Independently hand-calculated: two students receive two three-credit courses in two rounds.
function resultFixture(): SemesterAllocationResultV1DTO {
  return {
    kind: 'SIMULATION',
    usage: 'INTERNAL_REFERENCE_ONLY',
    model: 'SEMESTER_CREDIT_BUDGET_V1',
    utilityBasis: 'SUPPLIED_NORMALIZED_ELIGIBLE_CHOICES',
    processingBasis: 'ROUND_BARRIER_CURRENT_SCARCITY_THEN_ASSIGNED_CREDITS',
    congestionBasis: 'ORIGINAL_COURSE_DEMAND_OVER_OPENED_OR_PROSPECTIVE_SEATS',
    eligibilityValidated: false,
    allocationValidated: false,
    timetableValidated: false,
    persisted: false,
    envelope: {
      kind: 'SIMULATION',
      usage: 'REFERENCE_ONLY',
      scopeBasis: 'SCENARIO_ONLY',
      scope: { curriculumId: a, semester: 'FALL', year: 2026 },
      curriculum: { id: a, code: 'SIM', name: 'Simulation', school: 'CSE' },
      resourceRevision: 1,
      policy: {
        model: 'SHARED_CLASSROOM_SECTION_ENVELOPE_V1',
        classroomTimeBlocks: 1,
        sectionsPerProfessor: 1,
        roomBasis: 'ONE_CLASSROOM_SECTION_PER_ROOM_PER_BLOCK',
        teachingBasis: 'ONE_PROFESSOR_PER_SECTION_PER_BLOCK',
        sectionDurationBasis: 'ONE_SIMULATED_BLOCK',
        professorAssignmentBasis: 'INTERCHANGEABLE_FOR_ENVELOPE_ONLY',
      },
      resources: { professors: 2, classrooms: 2, labRooms: 0, maxStudentsPerSection: 2 },
      envelope: {
        classroomSectionCeiling: 2,
        professorSectionCeiling: 2,
        sharedSectionCeiling: 2,
        sharedSeatCeiling: 4,
      },
      labSectionsModeled: false,
      courseOverridesApplied: false,
      teachingLoadValidated: false,
      professorAvailabilityValidated: false,
      professorQualificationsValidated: false,
      crossCurriculumResourcesReconciled: false,
      timetableValidated: false,
      offeringValidationAvailable: false,
      demandValidated: false,
      allocationValidated: false,
    },
    policy: {
      studentUtilityWeight: 0.6,
      resourceFitWeight: 0.25,
      fairnessWeight: 0.15,
      congestionThreshold: 0.85,
    },
    input: {
      courses: [
        { courseId: a, credits: 3 },
        { courseId: b, credits: 3 },
      ],
      students: [first, second].map((studentId) => ({
        studentId,
        targetCredits: 6,
        candidates: [
          { courseId: a, studentUtility: 1 },
          { courseId: b, studentUtility: 0.9 },
        ],
      })),
    },
    students: [first, second].map((studentId) => ({
      studentId,
      targetCredits: 6,
      courseIds: [a, b],
      assignedCredits: 6,
      remainingCredits: 0,
      reason: 'TARGET_REACHED',
    })),
    assignments: [
      {
        studentId: first,
        courseId: a,
        round: 1,
        credits: 3,
        feasibleChoiceCount: 2,
        studentUtility: 1,
        resourceUtilization: 1,
        resourceFit: 0.85,
        fairness: 0.5,
        weightedScore: 0.8875,
      },
      {
        studentId: second,
        courseId: a,
        round: 1,
        credits: 3,
        feasibleChoiceCount: 2,
        studentUtility: 1,
        resourceUtilization: 1,
        resourceFit: 0.85,
        fairness: 0.5,
        weightedScore: 0.8875,
      },
      {
        studentId: first,
        courseId: b,
        round: 2,
        credits: 3,
        feasibleChoiceCount: 1,
        studentUtility: 0.9,
        resourceUtilization: 1,
        resourceFit: 0.85,
        fairness: 1,
        weightedScore: 0.9025,
      },
      {
        studentId: second,
        courseId: b,
        round: 2,
        credits: 3,
        feasibleChoiceCount: 1,
        studentUtility: 0.9,
        resourceUtilization: 1,
        resourceFit: 0.85,
        fairness: 1,
        weightedScore: 0.9025,
      },
    ],
    courses: [a, b].map((courseId) => ({
      courseId,
      credits: 3,
      demandStudentCount: 2,
      openedSections: 1,
      seatCapacity: 2,
      assignedStudentCount: 2,
    })),
    usedSections: 2,
    assignedCourseCount: 4,
    assignedStudentCount: 2,
    rounds: 2,
  };
}
function storageFixture(): SemesterAllocationStorageV1DTO {
  return { ...metadata(), result: resultFixture() };
}
function aggregateFixture(): SemesterAllocationRunV1DTO {
  const result = resultFixture();
  return {
    ...metadata(),
    result: {
      kind: 'SIMULATION',
      usage: 'REFERENCE_ONLY',
      model: 'SEMESTER_CREDIT_BUDGET_V1',
      scope: result.envelope.scope,
      curriculum: result.envelope.curriculum,
      envelope: result.envelope,
      policy: result.policy,
      studentCount: 2,
      assignedStudentCount: 2,
      assignedCourseCount: 4,
      totalTargetCredits: 12,
      totalAssignedCredits: 12,
      totalRemainingCredits: 0,
      stopReasonCounts: {
        TARGET_REACHED: 2,
        NO_REMAINING_CHOICES: 0,
        CREDIT_LIMIT: 0,
        RESOURCE_UNKNOWN: 0,
        CAPACITY_EXHAUSTED: 0,
      },
      usedSections: 2,
      rounds: 2,
      courses: result.courses,
      eligibilityValidated: false,
      allocationValidated: false,
      timetableValidated: false,
      academicPlansChanged: false,
    },
  };
}
function ownFixture(): OwnSemesterAllocationRunV1DTO {
  return {
    ...metadata(),
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    model: 'SEMESTER_CREDIT_BUDGET_V1',
    scope: { curriculumId: a, semester: 'FALL', year: 2026 },
    eligibilityValidated: false,
    allocationValidated: false,
    timetableValidated: false,
    academicPlansChanged: false,
    result: {
      targetCredits: 6,
      courseIds: [a, b],
      assignedCredits: 6,
      remainingCredits: 0,
      reason: 'TARGET_REACHED',
    },
    courses: [
      { courseId: a, credits: 3 },
      { courseId: b, credits: 3 },
    ],
  };
}

describe('pinned semester allocation storage and privacy contracts', () => {
  it('accepts independently calculated private, aggregate and own formats', () => {
    expect(SemesterAllocationResultV1Schema.parse(resultFixture())).toEqual(resultFixture());
    expect(SemesterAllocationStorageV1Schema.parse(storageFixture())).toEqual(storageFixture());
    expect(SemesterAllocationRunV1Schema.parse(aggregateFixture())).toEqual(aggregateFixture());
    expect(OwnSemesterAllocationRunV1Schema.parse(ownFixture())).toEqual(ownFixture());
  });

  it('normalizes UUIDs while preserving the stored result ordering', () => {
    const input = {
      ...resultFixture().envelope.scope,
      requestId: runId.toUpperCase(),
      expectedActorId: first.toUpperCase(),
      curriculumId: a.toUpperCase(),
    };
    expect(CreateSemesterAllocationRunSchema.parse(input)).toEqual({
      ...input,
      requestId: runId,
      expectedActorId: first,
      curriculumId: a,
    });
  });

  it.each(['expectedActorId', 'requestId', 'curriculumId', 'semester', 'year'] as const)(
    'requires the %s write precondition',
    (field) => {
      const input: Record<string, unknown> = {
        ...resultFixture().envelope.scope,
        requestId: runId,
        expectedActorId: first,
      };
      delete input[field];
      expect(CreateSemesterAllocationRunSchema.safeParse(input).success).toBe(false);
    },
  );

  it.each(['result', 'students', 'input', 'capturedAt', 'createdById', 'formatVersion'] as const)(
    'rejects uploaded or controlled %s write fields',
    (field) => {
      const input = {
        ...resultFixture().envelope.scope,
        requestId: runId,
        expectedActorId: first,
        [field]: {},
      };
      expect(CreateSemesterAllocationRunSchema.safeParse(input).success).toBe(false);
    },
  );

  it.each(['private', 'aggregate', 'own'] as const)(
    'rejects wrong version and storage assertions for %s',
    (kind) => {
      const schemas = {
        private: SemesterAllocationStorageV1Schema,
        aggregate: SemesterAllocationRunV1Schema,
        own: OwnSemesterAllocationRunV1Schema,
      };
      const fixtures = {
        private: storageFixture(),
        aggregate: aggregateFixture(),
        own: ownFixture(),
      };
      const schema = schemas[kind];
      for (const override of [
        { formatVersion: 2 },
        { snapshotStored: false },
        { simulationAssignmentsStored: false },
      ]) {
        expect(schema.safeParse({ ...fixtures[kind], ...override }).success).toBe(false);
      }
    },
  );

  it.each(['private', 'aggregate', 'own'] as const)(
    'preserves precise capture chronology in %s',
    (kind) => {
      const schemas = {
        private: SemesterAllocationStorageV1Schema,
        aggregate: SemesterAllocationRunV1Schema,
        own: OwnSemesterAllocationRunV1Schema,
      };
      const fixtures = {
        private: storageFixture(),
        aggregate: aggregateFixture(),
        own: ownFixture(),
      };
      const schema = schemas[kind];
      expect(
        schema.safeParse({
          ...fixtures[kind],
          capturedAt: '2026-10-06T01:00:00.0009Z',
          createdAt: '2026-10-06T01:00:00.0001Z',
        }).success,
      ).toBe(false);
      expect(
        schema.safeParse({
          ...fixtures[kind],
          capturedAt: '2026-10-06T01:00:00.0001Z',
          createdAt: '2026-10-06T01:00:00.0009Z',
        }).success,
      ).toBe(true);
      expect(
        schema.safeParse({
          ...fixtures[kind],
          capturedAt: '2026-10-06T01:00:00Z',
          createdAt: '2026-10-06T01:00:00.000Z',
        }).success,
      ).toBe(true);
    },
  );

  it.each([
    'input',
    'students',
    'assignments',
    'candidates',
    'studentId',
    'createdById',
    'requestId',
  ] as const)('rejects private %s fields inside public aggregate results', (field) => {
    const run = aggregateFixture();
    expect(
      SemesterAllocationRunV1Schema.safeParse({
        ...run,
        result: { ...run.result, [field]: [first] },
      }).success,
    ).toBe(false);
    expect(SemesterAllocationRunV1Schema.safeParse({ ...run, [field]: [first] }).success).toBe(
      false,
    );
  });

  it.each([
    'studentId',
    'candidates',
    'assignments',
    'students',
    'studentUtility',
    'createdById',
    'requestId',
  ] as const)('rejects private %s fields inside own results', (field) => {
    const run = ownFixture();
    expect(
      OwnSemesterAllocationRunV1Schema.safeParse({
        ...run,
        result: { ...run.result, [field]: first },
      }).success,
    ).toBe(false);
    expect(OwnSemesterAllocationRunV1Schema.safeParse({ ...run, [field]: first }).success).toBe(
      false,
    );
  });

  it.each([
    [
      'assignment order',
      (result: SemesterAllocationResultV1DTO) => {
        [result.assignments[0], result.assignments[1]] = [
          result.assignments[1],
          result.assignments[0],
        ];
      },
    ],
    [
      'round barrier',
      (result: SemesterAllocationResultV1DTO) => {
        result.assignments[1].round = 2;
      },
    ],
    [
      'weighted score',
      (result: SemesterAllocationResultV1DTO) => {
        result.assignments[0].weightedScore = 0.5;
      },
    ],
    [
      'remaining credits',
      (result: SemesterAllocationResultV1DTO) => {
        result.students[0].remainingCredits = 1;
      },
    ],
    [
      'packed seats',
      (result: SemesterAllocationResultV1DTO) => {
        result.courses[0].seatCapacity = 3;
      },
    ],
    [
      'total assignments',
      (result: SemesterAllocationResultV1DTO) => {
        result.assignedCourseCount = 3;
      },
    ],
  ] as const)('rejects altered private %s during pinned replay', (_name, mutate) => {
    const result = resultFixture();
    mutate(result);
    expect(SemesterAllocationStorageV1Schema.safeParse({ ...metadata(), result }).success).toBe(
      false,
    );
  });

  it('safeParse rejects dirty unknown references without throwing', () => {
    const result = resultFixture();
    result.input.students[0].candidates[0].courseId = runId;
    expect(() =>
      SemesterAllocationStorageV1Schema.safeParse({ ...metadata(), result }),
    ).not.toThrow();
    expect(SemesterAllocationStorageV1Schema.safeParse({ ...metadata(), result }).success).toBe(
      false,
    );
  });

  it('does not change the pure-core persistence assertion when storing its snapshot', () => {
    const run = storageFixture();
    expect(run.result.persisted).toBe(false);
    expect(
      SemesterAllocationStorageV1Schema.safeParse({
        ...run,
        result: { ...run.result, persisted: true },
      }).success,
    ).toBe(false);
  });

  it.each([
    [
      'scope',
      (run: SemesterAllocationRunV1DTO) => {
        run.result.scope = { ...run.result.scope, semester: 'SPRING' };
      },
    ],
    [
      'curriculum',
      (run: SemesterAllocationRunV1DTO) => {
        run.result.curriculum = { ...run.result.curriculum, name: 'Changed' };
      },
    ],
    [
      'student reason partition',
      (run: SemesterAllocationRunV1DTO) => {
        run.result.stopReasonCounts.TARGET_REACHED = 1;
      },
    ],
    [
      'credit partition',
      (run: SemesterAllocationRunV1DTO) => {
        run.result.totalTargetCredits = 13;
      },
    ],
    [
      'remaining credit reason',
      (run: SemesterAllocationRunV1DTO) => {
        run.result.totalRemainingCredits = 1;
        run.result.totalTargetCredits = 13;
      },
    ],
    [
      'student count',
      (run: SemesterAllocationRunV1DTO) => {
        run.result.assignedStudentCount = 3;
      },
    ],
    [
      'course count',
      (run: SemesterAllocationRunV1DTO) => {
        run.result.assignedCourseCount = 3;
      },
    ],
    [
      'ledger credits',
      (run: SemesterAllocationRunV1DTO) => {
        run.result.courses[0].credits = 2;
      },
    ],
    [
      'packed sections',
      (run: SemesterAllocationRunV1DTO) => {
        run.result.courses[0].openedSections = 2;
        run.result.courses[0].seatCapacity = 4;
        run.result.usedSections = 3;
      },
    ],
    [
      'seat count',
      (run: SemesterAllocationRunV1DTO) => {
        run.result.courses[0].seatCapacity = 3;
      },
    ],
    [
      'duplicate course',
      (run: SemesterAllocationRunV1DTO) => {
        run.result.courses[1].courseId = a;
      },
    ],
    [
      'round count',
      (run: SemesterAllocationRunV1DTO) => {
        run.result.rounds = 0;
      },
    ],
    [
      'sections total',
      (run: SemesterAllocationRunV1DTO) => {
        run.result.usedSections = 1;
      },
    ],
    [
      'false unknown resource',
      (run: SemesterAllocationRunV1DTO) => {
        run.result.stopReasonCounts.TARGET_REACHED = 1;
        run.result.stopReasonCounts.RESOURCE_UNKNOWN = 1;
      },
    ],
  ] as const)('rejects corrupt aggregate %s', (_name, mutate) => {
    const run = aggregateFixture();
    mutate(run);
    expect(SemesterAllocationRunV1Schema.safeParse(run).success).toBe(false);
  });

  it.each([
    [
      'course order',
      (run: OwnSemesterAllocationRunV1DTO) => {
        run.courses.reverse();
      },
    ],
    [
      'missing course',
      (run: OwnSemesterAllocationRunV1DTO) => {
        run.courses.pop();
      },
    ],
    [
      'extra course',
      (run: OwnSemesterAllocationRunV1DTO) => {
        run.courses.push({ courseId: runId, credits: 0 });
      },
    ],
    [
      'duplicate course',
      (run: OwnSemesterAllocationRunV1DTO) => {
        run.result.courseIds[1] = a;
        run.courses[1].courseId = a;
      },
    ],
    [
      'course credit sum',
      (run: OwnSemesterAllocationRunV1DTO) => {
        run.courses[0].credits = 2;
      },
    ],
    [
      'target credit partition',
      (run: OwnSemesterAllocationRunV1DTO) => {
        run.result.targetCredits = 7;
      },
    ],
    [
      'terminal reason',
      (run: OwnSemesterAllocationRunV1DTO) => {
        run.result.reason = 'NO_REMAINING_CHOICES';
      },
    ],
  ] as const)('rejects corrupt own %s', (_name, mutate) => {
    const run = ownFixture();
    mutate(run);
    expect(OwnSemesterAllocationRunV1Schema.safeParse(run).success).toBe(false);
  });

  it('accepts the empty aggregate with zero targets, rounds, sections and assignments', () => {
    const run = aggregateFixture();
    run.result.studentCount = 0;
    run.result.assignedStudentCount = 0;
    run.result.assignedCourseCount = 0;
    run.result.totalTargetCredits = 0;
    run.result.totalAssignedCredits = 0;
    run.result.totalRemainingCredits = 0;
    run.result.stopReasonCounts.TARGET_REACHED = 0;
    run.result.rounds = 0;
    run.result.usedSections = 0;
    run.result.courses = [];
    expect(SemesterAllocationRunV1Schema.parse(run)).toEqual(run);
  });

  it('accepts a zero-target owner without assigning optional zero-credit choices', () => {
    const run = ownFixture();
    run.result = {
      targetCredits: 0,
      courseIds: [],
      assignedCredits: 0,
      remainingCredits: 0,
      reason: 'TARGET_REACHED',
    };
    run.courses = [];
    expect(OwnSemesterAllocationRunV1Schema.parse(run)).toEqual(run);
  });
});
