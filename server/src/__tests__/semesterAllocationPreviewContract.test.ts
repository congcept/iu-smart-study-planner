import {
  SemesterAllocationPreviewSchema,
  type AllocationUtilityPolicyDTO,
  type EligibleCohortDemandPolicyDTO,
  type SemesterAllocationPreviewDTO,
} from '@iu-study-planner/shared';
import { allocateSimulationSemester } from '../services/simulationSemesterAllocation';
import { projectSemesterAllocationPreview } from '../services/semesterAllocationPreview';

const a = 'aaaaaaaa-0000-4000-8000-000000000001';
const b = 'aaaaaaaa-0000-4000-8000-000000000002';
const first = 'cccccccc-0000-4000-8000-000000000001';
const second = 'cccccccc-0000-4000-8000-000000000002';
const recommendation: EligibleCohortDemandPolicyDTO = { maxCredits: 6, maxDifficulty: 3.5 };
const utility: AllocationUtilityPolicyDTO = {
  difficultyFitWeight: 0.7,
  immediateUnlockWeight: 0.3,
};

function computed(target = 6) {
  return allocateSimulationSemester(
    {
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
    {
      courses: [
        { courseId: a, credits: 3 },
        { courseId: b, credits: 3 },
      ],
      students: [first, second].map((studentId) => ({
        studentId,
        targetCredits: target,
        candidates: [
          { courseId: a, studentUtility: 1 },
          { courseId: b, studentUtility: 0.9 },
        ],
      })),
    },
    {
      studentUtilityWeight: 0.6,
      resourceFitWeight: 0.25,
      fairnessWeight: 0.15,
      congestionThreshold: 0.85,
    },
  );
}
const preview = () => projectSemesterAllocationPreview(computed(), recommendation, utility);

describe('semester reference preview contract and aggregate projection', () => {
  it('projects a complete multi-course reference using configured uniform targets', () => {
    const source = computed();
    const before = JSON.stringify(source);
    const projected = projectSemesterAllocationPreview(source, recommendation, utility);
    expect(SemesterAllocationPreviewSchema.parse(projected)).toEqual(projected);
    expect(projected).toMatchObject({
      kind: 'SIMULATION',
      usage: 'REFERENCE_ONLY',
      consistencyBasis: 'SINGLE_DATABASE_SNAPSHOT',
      targetCreditsBasis: 'CONFIGURED_REFERENCE_MAX_CREDITS',
      recommendationPolicy: recommendation,
      utilityPolicy: utility,
      result: {
        model: 'SEMESTER_CREDIT_BUDGET_V1',
        studentCount: 2,
        assignedStudentCount: 2,
        assignedCourseCount: 4,
        totalTargetCredits: 12,
        totalAssignedCredits: 12,
        totalRemainingCredits: 0,
        usedSections: 2,
        rounds: 2,
        eligibilityValidated: false,
        allocationValidated: false,
        timetableValidated: false,
        academicPlansChanged: false,
      },
    });
    expect(projected.result.courses).toEqual([
      {
        courseId: a,
        credits: 3,
        demandStudentCount: 2,
        openedSections: 1,
        seatCapacity: 2,
        assignedStudentCount: 2,
      },
      {
        courseId: b,
        credits: 3,
        demandStudentCount: 2,
        openedSections: 1,
        seatCapacity: 2,
        assignedStudentCount: 2,
      },
    ]);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('does not expose participant identities, choices, score components or private persistence metadata', () => {
    const serialized = JSON.stringify(preview());
    for (const value of [
      first,
      second,
      'studentId',
      'candidates',
      '"studentUtility":',
      'assignments',
      '"input"',
      'requestId',
      'createdById',
      'capturedAt',
      'snapshotStored',
      'simulationAssignmentsStored',
    ])
      expect(serialized).not.toContain(value);
  });

  it.each([3, 5, 7])(
    'rejects a valid computed allocation with different uniform target %s',
    (target) => {
      expect(() =>
        projectSemesterAllocationPreview(computed(target), recommendation, utility),
      ).toThrow(/verif|target|policy/i);
    },
  );

  it.each([
    [5, 7],
    [9, 3],
  ])(
    'rejects nonuniform targets %s/%s even when their total matches the configured average',
    (firstTarget, secondTarget) => {
      const source = computed();
      const different = allocateSimulationSemester(
        source.envelope,
        {
          ...source.input,
          students: source.input.students.map((student, index) => ({
            ...student,
            targetCredits: index === 0 ? firstTarget : secondTarget,
          })),
        },
        source.policy,
      );
      expect(different.students.reduce((sum, student) => sum + student.targetCredits, 0)).toBe(12);
      expect(() => projectSemesterAllocationPreview(different, recommendation, utility)).toThrow(
        /verif|target|policy/i,
      );
    },
  );

  it.each(['students', 'assignments', 'input', 'createdById', 'requestId'] as const)(
    'rejects added private %s preview fields',
    (field) => {
      const value = preview();
      expect(SemesterAllocationPreviewSchema.safeParse({ ...value, [field]: first }).success).toBe(
        false,
      );
      expect(
        SemesterAllocationPreviewSchema.safeParse({
          ...value,
          result: { ...value.result, [field]: first },
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    [
      'persistence assertion',
      (value: SemesterAllocationPreviewDTO) => ({ ...value, persisted: true }),
    ],
    [
      'target basis',
      (value: SemesterAllocationPreviewDTO) => ({
        ...value,
        targetCreditsBasis: 'PERSONALIZED_GRADUATION_TARGET',
      }),
    ],
    [
      'snapshot basis',
      (value: SemesterAllocationPreviewDTO) => ({
        ...value,
        consistencyBasis: 'INDEPENDENT_READS',
      }),
    ],
    [
      'configured budget',
      (value: SemesterAllocationPreviewDTO) => ({
        ...value,
        recommendationPolicy: { ...value.recommendationPolicy, maxCredits: 3 },
      }),
    ],
    [
      'credit total',
      (value: SemesterAllocationPreviewDTO) => ({
        ...value,
        result: { ...value.result, totalTargetCredits: 13 },
      }),
    ],
    [
      'model',
      (value: SemesterAllocationPreviewDTO) => ({
        ...value,
        result: { ...value.result, model: 'ONE_COURSE_PER_STUDENT_ROUND_V1' },
      }),
    ],
    [
      'eligibility assertion',
      (value: SemesterAllocationPreviewDTO) => ({
        ...value,
        result: { ...value.result, eligibilityValidated: true },
      }),
    ],
    [
      'academic write assertion',
      (value: SemesterAllocationPreviewDTO) => ({
        ...value,
        result: { ...value.result, academicPlansChanged: true },
      }),
    ],
    [
      'reason partition',
      (value: SemesterAllocationPreviewDTO) => ({
        ...value,
        result: {
          ...value.result,
          stopReasonCounts: { ...value.result.stopReasonCounts, TARGET_REACHED: 1 },
        },
      }),
    ],
    [
      'assignment count',
      (value: SemesterAllocationPreviewDTO) => ({
        ...value,
        result: { ...value.result, assignedCourseCount: 3 },
      }),
    ],
    [
      'round count',
      (value: SemesterAllocationPreviewDTO) => ({
        ...value,
        result: { ...value.result, rounds: 0 },
      }),
    ],
    [
      'utility weights',
      (value: SemesterAllocationPreviewDTO) => ({
        ...value,
        utilityPolicy: { difficultyFitWeight: 1, immediateUnlockWeight: 1 },
      }),
    ],
  ] as const)('rejects altered %s', (_name, mutate) => {
    expect(SemesterAllocationPreviewSchema.safeParse(mutate(preview())).success).toBe(false);
  });

  it.each([
    { maxCredits: 0, maxDifficulty: 3.5 },
    { maxCredits: 31, maxDifficulty: 3.5 },
    { maxCredits: 6, maxDifficulty: 0 },
    { maxCredits: 6, maxDifficulty: 3.5, personalized: true },
  ])('rejects invalid reference recommendation policy %#', (policy) => {
    expect(() => projectSemesterAllocationPreview(computed(), policy, utility)).toThrow(/verif/i);
  });

  it('rejects corrupt computed results instead of publishing a partial summary', () => {
    const source = computed();
    source.assignments[0].weightedScore = 0;
    expect(() => projectSemesterAllocationPreview(source, recommendation, utility)).toThrow(
      /verif/i,
    );
  });

  it('supports missing resources with explicit shortfalls and no invented allocations', () => {
    const source = computed();
    const result = allocateSimulationSemester(
      { ...source.envelope, resources: null, envelope: null, resourceRevision: null },
      source.input,
      source.policy,
    );
    expect(projectSemesterAllocationPreview(result, recommendation, utility).result).toMatchObject({
      assignedCourseCount: 0,
      assignedStudentCount: 0,
      totalAssignedCredits: 0,
      totalRemainingCredits: 12,
      stopReasonCounts: { RESOURCE_UNKNOWN: 2, CAPACITY_EXHAUSTED: 0 },
    });
  });

  it('supports an empty cohort without inventing targets or assignments', () => {
    const source = computed();
    const result = allocateSimulationSemester(
      source.envelope,
      { ...source.input, students: [] },
      source.policy,
    );
    expect(projectSemesterAllocationPreview(result, recommendation, utility).result).toMatchObject({
      studentCount: 0,
      totalTargetCredits: 0,
      totalAssignedCredits: 0,
      totalRemainingCredits: 0,
      assignedCourseCount: 0,
    });
  });
});
