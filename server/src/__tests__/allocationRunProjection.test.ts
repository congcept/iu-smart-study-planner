import {
  AllocationPreviewSchema,
  AllocationRunSummaryV1Schema,
  AllocationRunV1Schema,
  type AllocationPreviewDTO,
} from '@iu-study-planner/shared';
import { projectAllocationRunSummary } from '../services/allocationRunProjection';

const curriculumId = '11111111-AAAA-4111-8111-111111111111';
const courseId = '22222222-BBBB-4222-8222-222222222222';
const build = (): AllocationPreviewDTO => {
  const scope = { curriculumId, semester: 'FALL', year: 2026 };
  const curriculum = { id: curriculumId, code: 'REF', name: 'Reference', school: 'CSE' };
  return AllocationPreviewSchema.parse({
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    consistencyBasis: 'SINGLE_DATABASE_SNAPSHOT',
    model: 'ONE_COURSE_PER_STUDENT_ROUND_V1',
    utilityBasis: 'BAYESIAN_DIFFICULTY_AND_IMMEDIATE_UNLOCKS_V1',
    utilityPolicy: { difficultyFitWeight: 0.7, immediateUnlockWeight: 0.3 },
    eligibilityValidated: false,
    allocationValidated: false,
    timetableValidated: false,
    persisted: false,
    categoryPersonalizationAvailable: false,
    gradePersonalizationAvailable: false,
    timelinePersonalizationAvailable: false,
    allocationPolicy: {
      studentUtilityWeight: 0.6,
      resourceFitWeight: 0.25,
      fairnessWeight: 0.15,
      congestionThreshold: 0.85,
    },
    assignedStudentCount: 1,
    noChoicesStudentCount: 1,
    resourceUnknownStudentCount: 0,
    capacityExhaustedStudentCount: 1,
    usedSections: 1,
    courses: [
      {
        id: courseId,
        code: 'C1',
        name: 'Course one',
        demandStudentCount: 2,
        assignedStudentCount: 1,
        openedSections: 1,
        seatCapacity: 1,
        seatUtilization: 1,
      },
    ],
    snapshot: {
      kind: 'SIMULATION',
      usage: 'REFERENCE_ONLY',
      consistencyBasis: 'SINGLE_DATABASE_SNAPSHOT',
      demand: {
        kind: 'SIMULATION',
        usage: 'REFERENCE_ONLY',
        scope,
        curriculum,
        planningBasis: 'ELIGIBLE_PLANNED_OR_REFERENCE_RECOMMENDED',
        termBasis: 'SCENARIO_ONLY',
        prerequisitePolicy: 'ALL_CONTEXT_PREREQUISITES_MANDATORY',
        unknownGpaPolicy: 'DEFER_FORK_ONLY_PLACEMENTS',
        recommendationPolicy: { maxCredits: 18, maxDifficulty: 3.5 },
        recommendationDemandAvailable: true,
        eligibilityValidated: false,
        offeringValidationAvailable: false,
        allocationValidated: false,
        cohortStudentCount: 3,
        demandStudentCount: 2,
        eligiblePlannedStudentCount: 2,
        recommendedStudentCount: 0,
        eligiblePlannedSelectionCount: 2,
        recommendedSelectionCount: 0,
        demandSelectionCount: 2,
        overlapSelectionCount: 0,
        ignoredNonmemberPlannedSelectionCount: 0,
        ineligibleMemberPlannedSelectionCount: 0,
        unresolvedGpaStudentCount: 1,
        courses: [
          {
            id: courseId,
            code: 'C1',
            name: 'Course one',
            eligiblePlannedStudentCount: 2,
            recommendedStudentCount: 0,
            overlapStudentCount: 0,
            demandStudentCount: 2,
            supply: null,
            utilization: null,
          },
        ],
      },
      resourceEnvelope: {
        kind: 'SIMULATION',
        usage: 'REFERENCE_ONLY',
        scopeBasis: 'SCENARIO_ONLY',
        scope,
        curriculum,
        resourceRevision: 7,
        policy: {
          model: 'SHARED_CLASSROOM_SECTION_ENVELOPE_V1',
          classroomTimeBlocks: 1,
          sectionsPerProfessor: 1,
          roomBasis: 'ONE_CLASSROOM_SECTION_PER_ROOM_PER_BLOCK',
          teachingBasis: 'ONE_PROFESSOR_PER_SECTION_PER_BLOCK',
          sectionDurationBasis: 'ONE_SIMULATED_BLOCK',
          professorAssignmentBasis: 'INTERCHANGEABLE_FOR_ENVELOPE_ONLY',
        },
        resources: { professors: 1, classrooms: 1, labRooms: 9, maxStudentsPerSection: 1 },
        envelope: {
          classroomSectionCeiling: 1,
          professorSectionCeiling: 1,
          sharedSectionCeiling: 1,
          sharedSeatCeiling: 1,
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
    },
  });
};

describe('pinned aggregate allocation run projection', () => {
  it('captures normalized scope, policy, revision, ceiling and aggregate outcomes', () => {
    const preview = build();
    const summary = projectAllocationRunSummary(preview);
    expect(summary).toMatchObject({
      scope: { curriculumId: curriculumId.toLowerCase(), semester: 'FALL', year: 2026 },
      curriculum: preview.snapshot.demand.curriculum,
      cohortStudentCount: 3,
      demandStudentCount: 2,
      unresolvedGpaStudentCount: 1,
      assignedStudentCount: 1,
      noChoicesStudentCount: 1,
      resourceUnknownStudentCount: 0,
      capacityExhaustedStudentCount: 1,
      usedSections: 1,
      assignmentsPersisted: false,
      utilityPolicy: preview.utilityPolicy,
      allocationPolicy: preview.allocationPolicy,
      recommendationPolicy: preview.snapshot.demand.recommendationPolicy,
      resources: {
        resourceRevision: 7,
        professors: 1,
        classrooms: 1,
        labRooms: 9,
        maxStudentsPerSection: 1,
        classroomTimeBlocks: 1,
        sectionsPerProfessor: 1,
        sharedSectionCeiling: 1,
        sharedSeatCeiling: 1,
      },
      courses: preview.courses,
    });
    expect(AllocationRunSummaryV1Schema.parse(summary)).toEqual(summary);
  });

  it('copies every nested field without retaining live snapshots or private data', () => {
    const preview = build();
    const before = JSON.stringify(preview);
    const summary = projectAllocationRunSummary(preview);
    expect(JSON.stringify(preview)).toBe(before);
    for (const key of [
      'snapshot',
      'persisted',
      'actorId',
      'requestId',
      'studentId',
      'assignments',
      'scores',
    ])
      expect(summary).not.toHaveProperty(key);
    preview.utilityPolicy.difficultyFitWeight = 0;
    preview.snapshot.demand.curriculum.name = 'Changed';
    preview.courses[0].name = 'Changed';
    expect(summary.utilityPolicy.difficultyFitWeight).toBe(0.7);
    expect(summary.curriculum.name).toBe('Reference');
    expect(summary.courses[0].name).toBe('Course one');
  });

  it('preserves unknown resources and configured zero capacity as separate states', () => {
    const unknown = build();
    unknown.snapshot.resourceEnvelope.resources = null;
    unknown.snapshot.resourceEnvelope.envelope = null;
    unknown.snapshot.resourceEnvelope.resourceRevision = null;
    unknown.assignedStudentCount = 0;
    unknown.resourceUnknownStudentCount = 2;
    unknown.capacityExhaustedStudentCount = 0;
    unknown.usedSections = 0;
    Object.assign(unknown.courses[0], {
      assignedStudentCount: 0,
      openedSections: 0,
      seatCapacity: 0,
      seatUtilization: null,
    });
    expect(projectAllocationRunSummary(unknown)).toMatchObject({
      resources: null,
      resourceUnknownStudentCount: 2,
    });
    const zero = build();
    zero.snapshot.resourceEnvelope.resources!.classrooms = 0;
    Object.assign(zero.snapshot.resourceEnvelope.envelope!, {
      classroomSectionCeiling: 0,
      sharedSectionCeiling: 0,
      sharedSeatCeiling: 0,
    });
    zero.assignedStudentCount = 0;
    zero.capacityExhaustedStudentCount = 2;
    zero.usedSections = 0;
    Object.assign(zero.courses[0], {
      assignedStudentCount: 0,
      openedSections: 0,
      seatCapacity: 0,
      seatUtilization: null,
    });
    expect(projectAllocationRunSummary(zero)).toMatchObject({
      resources: { classrooms: 0, sharedSectionCeiling: 0 },
      resourceUnknownStudentCount: 0,
      capacityExhaustedStudentCount: 2,
    });
  });

  it('checks the current preview before projection', () => {
    const preview = build();
    preview.assignedStudentCount++;
    expect(() => projectAllocationRunSummary(preview)).toThrow();
  });

  it.each([
    { assignmentsPersisted: true },
    { allocationValidated: true },
    { actorId: curriculumId },
    { cohortStudentCount: 2 },
    { noChoicesStudentCount: 0 },
    { demandStudentCount: 4 },
    { unresolvedGpaStudentCount: 4 },
    { resourceUnknownStudentCount: 1 },
    { usedSections: 0 },
    { utilityPolicy: { difficultyFitWeight: 0.8, immediateUnlockWeight: 0.3 } },
    {
      allocationPolicy: {
        studentUtilityWeight: 0.7,
        resourceFitWeight: 0.25,
        fairnessWeight: 0.15,
        congestionThreshold: 0.85,
      },
    },
    { recommendationPolicy: { maxCredits: 31, maxDifficulty: 3 } },
  ])('rejects false, private or inconsistent pinned summary fields %#', (fields) => {
    expect(
      AllocationRunSummaryV1Schema.safeParse({ ...projectAllocationRunSummary(build()), ...fields })
        .success,
    ).toBe(false);
  });

  it.each(['id', 'code', 'capacity', 'sections', 'utilization', 'demand', 'private'] as const)(
    'rejects corrupt pinned course %s',
    (kind) => {
      const summary = projectAllocationRunSummary(build());
      if (kind === 'id') summary.courses.push({ ...summary.courses[0] });
      if (kind === 'code')
        summary.courses.push({ ...summary.courses[0], id: '33333333-cccc-4333-8333-333333333333' });
      if (kind === 'capacity') summary.courses[0].seatCapacity++;
      if (kind === 'sections') summary.courses[0].openedSections++;
      if (kind === 'utilization') summary.courses[0].seatUtilization = 0.5;
      if (kind === 'demand') summary.courses[0].demandStudentCount = 3;
      const input =
        kind === 'private'
          ? { ...summary, courses: [{ ...summary.courses[0], studentIds: [curriculumId] }] }
          : summary;
      expect(AllocationRunSummaryV1Schema.safeParse(input).success).toBe(false);
    },
  );

  it('checks the independent resource formula and normalized curriculum scope', () => {
    const summary = projectAllocationRunSummary(build());
    expect(
      AllocationRunSummaryV1Schema.safeParse({
        ...summary,
        resources: { ...summary.resources, sharedSeatCeiling: 2 },
      }).success,
    ).toBe(false);
    expect(
      AllocationRunSummaryV1Schema.safeParse({
        ...summary,
        scope: { ...summary.scope, curriculumId: courseId },
      }).success,
    ).toBe(false);
    expect(
      AllocationRunSummaryV1Schema.safeParse({
        ...summary,
        scope: { ...summary.scope, year: 1999 },
      }).success,
    ).toBe(false);
  });

  it('checks V1 wrapper version, storage assertion and capture chronology', () => {
    const run = {
      id: curriculumId,
      formatVersion: 1,
      capturedAt: '2026-10-05T01:00:00.000Z',
      createdAt: '2026-10-05T01:00:01.000Z',
      snapshotStored: true,
      result: projectAllocationRunSummary(build()),
    };
    expect(AllocationRunV1Schema.parse(run).id).toBe(curriculumId.toLowerCase());
    for (const fields of [
      { formatVersion: 2 },
      { snapshotStored: false },
      { capturedAt: '2026-10-05T01:00:02.000Z' },
      { createdAt: 'invalid' },
      { requestId: curriculumId },
    ])
      expect(AllocationRunV1Schema.safeParse({ ...run, ...fields }).success).toBe(false);
    expect(AllocationRunV1Schema.safeParse({ ...run, capturedAt: run.createdAt }).success).toBe(
      true,
    );
    expect(
      AllocationRunV1Schema.safeParse({
        ...run,
        capturedAt: '2026-10-05T01:00:00.0009Z',
        createdAt: '2026-10-05T01:00:00.0001Z',
      }).success,
    ).toBe(false);
    expect(
      AllocationRunV1Schema.safeParse({
        ...run,
        capturedAt: '2026-10-05T01:00:00Z',
        createdAt: '2026-10-05T01:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
