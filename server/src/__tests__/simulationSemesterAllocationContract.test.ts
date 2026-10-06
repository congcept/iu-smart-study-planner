import {
  SimulationSemesterAllocationResultSchema,
  type SimulationSemesterAllocationResultDTO,
} from '@iu-study-planner/shared';

const a = 'aaaaaaaa-0000-4000-8000-000000000001';
const b = 'aaaaaaaa-0000-4000-8000-000000000002';
const unknown = 'aaaaaaaa-0000-4000-8000-000000000003';
const first = 'cccccccc-0000-4000-8000-000000000001';
const second = 'cccccccc-0000-4000-8000-000000000002';

// These values are hand-worked, without calling the allocation implementation.
function fixture(): SimulationSemesterAllocationResultDTO {
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

type Mutation = (result: SimulationSemesterAllocationResultDTO) => void;

describe('semester allocation replay contract', () => {
  it('accepts independently calculated rounds, budgets, section ledgers and score components', () => {
    const source = fixture();
    expect(SimulationSemesterAllocationResultSchema.parse(source)).toEqual(source);
  });

  it.each([
    { reason: 'TARGET_REACHED' as const, target: 0, choices: true, resources: 'known' },
    { reason: 'NO_REMAINING_CHOICES' as const, target: 6, choices: false, resources: 'missing' },
    { reason: 'CREDIT_LIMIT' as const, target: 2, choices: true, resources: 'missing' },
    { reason: 'RESOURCE_UNKNOWN' as const, target: 6, choices: true, resources: 'missing' },
    { reason: 'CAPACITY_EXHAUSTED' as const, target: 6, choices: true, resources: 'zero' },
  ])(
    'accepts the hand-worked empty $reason outcome and rejects a false terminal reason',
    ({ reason, target, choices, resources }) => {
      const source = fixture();
      source.input = {
        courses: [{ courseId: a, credits: 3 }],
        students: [
          {
            studentId: first,
            targetCredits: target,
            candidates: choices ? [{ courseId: a, studentUtility: 1 }] : [],
          },
        ],
      };
      source.students = [
        {
          studentId: first,
          targetCredits: target,
          courseIds: [],
          assignedCredits: 0,
          remainingCredits: target,
          reason,
        },
      ];
      source.assignments = [];
      source.courses = [
        {
          courseId: a,
          credits: 3,
          demandStudentCount: choices ? 1 : 0,
          openedSections: 0,
          seatCapacity: 0,
          assignedStudentCount: 0,
        },
      ];
      source.usedSections = 0;
      source.assignedCourseCount = 0;
      source.assignedStudentCount = 0;
      source.rounds = 0;
      if (resources === 'missing') {
        source.envelope.resources = null;
        source.envelope.envelope = null;
        source.envelope.resourceRevision = null;
      } else if (resources === 'zero') {
        source.envelope.resources = {
          professors: 0,
          classrooms: 0,
          labRooms: 0,
          maxStudentsPerSection: 2,
        };
        source.envelope.envelope = {
          classroomSectionCeiling: 0,
          professorSectionCeiling: 0,
          sharedSectionCeiling: 0,
          sharedSeatCeiling: 0,
        };
      }
      expect(SimulationSemesterAllocationResultSchema.parse(source)).toEqual(source);
      source.students[0].reason =
        reason === 'TARGET_REACHED' ? 'NO_REMAINING_CHOICES' : 'TARGET_REACHED';
      expect(SimulationSemesterAllocationResultSchema.safeParse(source).success).toBe(false);
    },
  );

  it.each([
    { resources: { professors: 2, classrooms: 2, labRooms: 0, maxStudentsPerSection: -1 } },
    { scope: { curriculumId: 'broken', semester: 'FALL', year: 2026 } },
  ])('rejects malformed nested envelopes without throwing from safeParse %#', (patch) => {
    const source = fixture();
    const corrupted = { ...source, envelope: { ...source.envelope, ...patch } };
    expect(() => SimulationSemesterAllocationResultSchema.safeParse(corrupted)).not.toThrow();
    expect(SimulationSemesterAllocationResultSchema.safeParse(corrupted).success).toBe(false);
  });

  it.each<{ name: string; mutate: Mutation }>([
    {
      name: 'same student twice in one round',
      mutate: (r) => {
        r.assignments[1].studentId = first;
      },
    },
    {
      name: 'next round before every feasible student is processed',
      mutate: (r) => {
        r.assignments[1].round = 2;
      },
    },
    {
      name: 'skipped round',
      mutate: (r) => {
        r.assignments[2].round = 3;
      },
    },
    {
      name: 'return to an earlier round',
      mutate: (r) => {
        r.assignments[3].round = 1;
      },
    },
    {
      name: 'UUID tie broken in reverse order',
      mutate: (r) => {
        [r.assignments[0], r.assignments[1]] = [r.assignments[1], r.assignments[0]];
      },
    },
    {
      name: 'unlisted assignment student',
      mutate: (r) => {
        r.assignments[0].studentId = unknown;
      },
    },
    {
      name: 'unlisted assignment course',
      mutate: (r) => {
        r.assignments[0].courseId = unknown;
      },
    },
    {
      name: 'lower-scoring course chosen first',
      mutate: (r) => {
        r.assignments[0].courseId = b;
      },
    },
    {
      name: 'same course chosen again in a later round',
      mutate: (r) => {
        r.assignments[2].courseId = a;
      },
    },
    {
      name: 'course credit mismatch',
      mutate: (r) => {
        r.assignments[0].credits = 2;
      },
    },
    {
      name: 'fabricated feasible choice count',
      mutate: (r) => {
        r.assignments[0].feasibleChoiceCount = 1;
      },
    },
    {
      name: 'utility differs from frozen supplied choice',
      mutate: (r) => {
        r.assignments[0].studentUtility = 0.99;
      },
    },
    {
      name: 'utilization differs from original demand',
      mutate: (r) => {
        r.assignments[0].resourceUtilization = 0.5;
      },
    },
    {
      name: 'fabricated resource fit',
      mutate: (r) => {
        r.assignments[0].resourceFit = 1;
      },
    },
    {
      name: 'fabricated fairness',
      mutate: (r) => {
        r.assignments[0].fairness = 1;
      },
    },
    {
      name: 'fabricated weighted score',
      mutate: (r) => {
        r.assignments[0].weightedScore = 1;
      },
    },
    {
      name: 'changed policy without matching scores',
      mutate: (r) => {
        r.policy = { ...r.policy, studentUtilityWeight: 0.5, fairnessWeight: 0.25 };
      },
    },
    {
      name: 'missing student outcome',
      mutate: (r) => {
        r.students.pop();
      },
    },
    {
      name: 'duplicate student outcome',
      mutate: (r) => {
        r.students[1] = { ...r.students[0] };
      },
    },
    {
      name: 'foreign student outcome',
      mutate: (r) => {
        r.students[0].studentId = unknown;
      },
    },
    {
      name: 'outcome order differs from normalized roster',
      mutate: (r) => {
        r.students.reverse();
      },
    },
    {
      name: 'target differs from captured budget',
      mutate: (r) => {
        r.students[0].targetCredits = 7;
      },
    },
    {
      name: 'assigned credits understated',
      mutate: (r) => {
        r.students[0].assignedCredits = 5;
      },
    },
    {
      name: 'remaining credits fabricated',
      mutate: (r) => {
        r.students[0].remainingCredits = 1;
      },
    },
    {
      name: 'duplicate course in outcome',
      mutate: (r) => {
        r.students[0].courseIds = [a, a];
      },
    },
    {
      name: 'outcome course order differs from rounds',
      mutate: (r) => {
        r.students[0].courseIds.reverse();
      },
    },
    {
      name: 'incorrect terminal reason',
      mutate: (r) => {
        r.students[0].reason = 'NO_REMAINING_CHOICES';
      },
    },
    {
      name: 'missing course ledger',
      mutate: (r) => {
        r.courses.pop();
      },
    },
    {
      name: 'extra foreign course ledger',
      mutate: (r) => {
        r.courses.push({ ...r.courses[0], courseId: unknown });
      },
    },
    {
      name: 'duplicate course ledger',
      mutate: (r) => {
        r.courses[1] = { ...r.courses[0] };
      },
    },
    {
      name: 'ledger order differs from normalized catalog',
      mutate: (r) => {
        r.courses.reverse();
      },
    },
    {
      name: 'ledger course credits differ',
      mutate: (r) => {
        r.courses[0].credits = 4;
      },
    },
    {
      name: 'original demand understated',
      mutate: (r) => {
        r.courses[0].demandStudentCount = 1;
      },
    },
    {
      name: 'opened sections overstated',
      mutate: (r) => {
        r.courses[0].openedSections = 2;
      },
    },
    {
      name: 'seat ledger reset across rounds',
      mutate: (r) => {
        r.courses[0].seatCapacity = 0;
      },
    },
    {
      name: 'course seat count understated',
      mutate: (r) => {
        r.courses[0].assignedStudentCount = 1;
      },
    },
    {
      name: 'used section total understated',
      mutate: (r) => {
        r.usedSections = 1;
      },
    },
    {
      name: 'assignment total understated',
      mutate: (r) => {
        r.assignedCourseCount = 3;
      },
    },
    {
      name: 'assigned student total overstated',
      mutate: (r) => {
        r.assignedStudentCount = 3;
      },
    },
    {
      name: 'round total understated',
      mutate: (r) => {
        r.rounds = 1;
      },
    },
    {
      name: 'premature stop with otherwise consistent partial totals',
      mutate: (r) => {
        r.assignments = r.assignments.slice(0, 2);
        r.students = r.students.map((row) => ({
          ...row,
          courseIds: [a],
          assignedCredits: 3,
          remainingCredits: 3,
          reason: 'CAPACITY_EXHAUSTED',
        }));
        r.courses[1] = {
          ...r.courses[1],
          openedSections: 0,
          seatCapacity: 0,
          assignedStudentCount: 0,
        };
        r.usedSections = 1;
        r.assignedCourseCount = 2;
        r.rounds = 1;
      },
    },
    {
      name: 'allocation under missing resources',
      mutate: (r) => {
        r.envelope.resources = null;
        r.envelope.envelope = null;
        r.envelope.resourceRevision = null;
      },
    },
  ])('rejects $name without throwing from safeParse', ({ mutate }) => {
    const source = fixture();
    mutate(source);
    expect(() => SimulationSemesterAllocationResultSchema.safeParse(source)).not.toThrow();
    expect(SimulationSemesterAllocationResultSchema.safeParse(source).success).toBe(false);
  });

  it.each<{ name: string; mutate: Mutation }>([
    {
      name: 'unknown choice reference',
      mutate: (r) => {
        r.input.students[0].candidates[0].courseId = unknown;
      },
    },
    {
      name: 'duplicate captured course',
      mutate: (r) => {
        r.input.courses[1].courseId = a;
      },
    },
    {
      name: 'duplicate captured student',
      mutate: (r) => {
        r.input.students[1].studentId = first;
      },
    },
    {
      name: 'duplicate captured choice',
      mutate: (r) => {
        r.input.students[0].candidates[1].courseId = a;
      },
    },
    {
      name: 'out-of-range captured credits',
      mutate: (r) => {
        r.input.courses[0].credits = 11;
      },
    },
    {
      name: 'out-of-range captured budget',
      mutate: (r) => {
        r.input.students[0].targetCredits = -1;
      },
    },
    {
      name: 'out-of-range captured utility',
      mutate: (r) => {
        r.input.students[0].candidates[0].studentUtility = 1.1;
      },
    },
    {
      name: 'invalid assignment UUID',
      mutate: (r) => {
        r.assignments[0].courseId = 'broken';
      },
    },
  ])('rejects dirty nested $name through safeParse rather than dereferencing it', ({ mutate }) => {
    const source = fixture();
    mutate(source);
    expect(() => SimulationSemesterAllocationResultSchema.safeParse(source)).not.toThrow();
    expect(SimulationSemesterAllocationResultSchema.safeParse(source).success).toBe(false);
  });

  it.each([
    'eligibilityValidated',
    'allocationValidated',
    'timetableValidated',
    'persisted',
  ] as const)('rejects a promoted %s claim', (field) => {
    expect(
      SimulationSemesterAllocationResultSchema.safeParse({ ...fixture(), [field]: true }).success,
    ).toBe(false);
  });

  it('rejects an old one-course model or added private metadata', () => {
    expect(
      SimulationSemesterAllocationResultSchema.safeParse({
        ...fixture(),
        model: 'ONE_COURSE_PER_STUDENT_ROUND_V1',
      }).success,
    ).toBe(false);
    expect(
      SimulationSemesterAllocationResultSchema.safeParse({ ...fixture(), updatedBy: first })
        .success,
    ).toBe(false);
    const source = fixture();
    expect(
      SimulationSemesterAllocationResultSchema.safeParse({
        ...source,
        assignments: source.assignments.map((row) => ({ ...row, studentName: 'Private' })),
      }).success,
    ).toBe(false);
  });
});
