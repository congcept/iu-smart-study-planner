import type { ResourceScopeDTO, SemesterAllocationPreviewDTO } from '@iu-study-planner/shared';
import { memberId, referenceId } from './curriculumReference';

export const semesterAllocationScope: ResourceScopeDTO = {
  curriculumId: referenceId,
  semester: 'FALL',
  year: 2026,
};
export const secondSemesterCourseId = '55555555-5555-4555-8555-555555555555';
export const semesterAllocationCourseNames = [
  { id: memberId, code: 'MA001IU', name: 'Scoped Calculus' },
  { id: secondSemesterCourseId, code: 'SIM002', name: 'Simulated Seminar' },
];

/** Hand-computed reference: two students take 4 + 2 credits; a third has no choices. */
export function semesterAllocationPreview(
  scope = semesterAllocationScope,
  revision: number | null = 3,
): SemesterAllocationPreviewDTO {
  const curriculum = {
    id: scope.curriculumId,
    code: 'SIM',
    name: 'Simulated reference',
    school: 'CSE',
  };
  const resources =
    revision === null
      ? null
      : { professors: 2, classrooms: 2, labRooms: 1, maxStudentsPerSection: 2 };
  return {
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    consistencyBasis: 'SINGLE_DATABASE_SNAPSHOT',
    targetCreditsBasis: 'CONFIGURED_REFERENCE_MAX_CREDITS',
    persisted: false,
    recommendationPolicy: { maxCredits: 6, maxDifficulty: 3.5 },
    utilityPolicy: { difficultyFitWeight: 0.7, immediateUnlockWeight: 0.3 },
    result: {
      kind: 'SIMULATION',
      usage: 'REFERENCE_ONLY',
      model: 'SEMESTER_CREDIT_BUDGET_V1',
      scope,
      curriculum,
      envelope: {
        kind: 'SIMULATION',
        usage: 'REFERENCE_ONLY',
        scopeBasis: 'SCENARIO_ONLY',
        scope,
        curriculum,
        resourceRevision: revision,
        policy: {
          model: 'SHARED_CLASSROOM_SECTION_ENVELOPE_V1',
          classroomTimeBlocks: 1,
          sectionsPerProfessor: 1,
          roomBasis: 'ONE_CLASSROOM_SECTION_PER_ROOM_PER_BLOCK',
          teachingBasis: 'ONE_PROFESSOR_PER_SECTION_PER_BLOCK',
          sectionDurationBasis: 'ONE_SIMULATED_BLOCK',
          professorAssignmentBasis: 'INTERCHANGEABLE_FOR_ENVELOPE_ONLY',
        },
        resources,
        envelope: resources
          ? {
              classroomSectionCeiling: 2,
              professorSectionCeiling: 2,
              sharedSectionCeiling: 2,
              sharedSeatCeiling: 4,
            }
          : null,
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
      studentCount: 3,
      assignedStudentCount: resources ? 2 : 0,
      assignedCourseCount: resources ? 4 : 0,
      totalTargetCredits: 18,
      totalAssignedCredits: resources ? 12 : 0,
      totalRemainingCredits: resources ? 6 : 18,
      stopReasonCounts: {
        TARGET_REACHED: resources ? 2 : 0,
        NO_REMAINING_CHOICES: 1,
        CREDIT_LIMIT: 0,
        RESOURCE_UNKNOWN: resources ? 0 : 2,
        CAPACITY_EXHAUSTED: 0,
      },
      usedSections: resources ? 2 : 0,
      rounds: resources ? 2 : 0,
      courses: [
        { courseId: memberId, credits: 4 },
        { courseId: secondSemesterCourseId, credits: 2 },
      ].map((course) => ({
        ...course,
        demandStudentCount: 2,
        assignedStudentCount: resources ? 2 : 0,
        openedSections: resources ? 1 : 0,
        seatCapacity: resources ? 2 : 0,
      })),
      eligibilityValidated: false,
      allocationValidated: false,
      timetableValidated: false,
      academicPlansChanged: false,
    },
  };
}

export function emptySemesterAllocationPreview(cohort = 0, includeCourses = true) {
  const preview = semesterAllocationPreview();
  Object.assign(preview.result, {
    studentCount: cohort,
    assignedStudentCount: 0,
    assignedCourseCount: 0,
    totalTargetCredits: 6 * cohort,
    totalAssignedCredits: 0,
    totalRemainingCredits: 6 * cohort,
    stopReasonCounts: {
      TARGET_REACHED: 0,
      NO_REMAINING_CHOICES: cohort,
      CREDIT_LIMIT: 0,
      RESOURCE_UNKNOWN: 0,
      CAPACITY_EXHAUSTED: 0,
    },
    usedSections: 0,
    rounds: 0,
  });
  preview.result.courses = includeCourses
    ? preview.result.courses.map((course) => ({
        ...course,
        demandStudentCount: 0,
        assignedStudentCount: 0,
        openedSections: 0,
        seatCapacity: 0,
      }))
    : [];
  return preview;
}

export function zeroCapacitySemesterAllocationPreview() {
  const preview = semesterAllocationPreview();
  preview.result.envelope.resources = {
    professors: 0,
    classrooms: 0,
    labRooms: 1,
    maxStudentsPerSection: 2,
  };
  preview.result.envelope.envelope = {
    classroomSectionCeiling: 0,
    professorSectionCeiling: 0,
    sharedSectionCeiling: 0,
    sharedSeatCeiling: 0,
  };
  Object.assign(preview.result, {
    assignedStudentCount: 0,
    assignedCourseCount: 0,
    totalAssignedCredits: 0,
    totalRemainingCredits: 18,
    stopReasonCounts: {
      TARGET_REACHED: 0,
      NO_REMAINING_CHOICES: 1,
      CREDIT_LIMIT: 0,
      RESOURCE_UNKNOWN: 0,
      CAPACITY_EXHAUSTED: 2,
    },
    usedSections: 0,
    rounds: 0,
  });
  preview.result.courses = preview.result.courses.map((course) => ({
    ...course,
    assignedStudentCount: 0,
    openedSections: 0,
    seatCapacity: 0,
  }));
  return preview;
}
