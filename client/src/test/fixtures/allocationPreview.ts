import type { AllocationPreviewDTO, ResourceScopeDTO } from '@iu-study-planner/shared';
import { memberId, referenceId } from './curriculumReference';

export const allocationScope: ResourceScopeDTO = {
  curriculumId: referenceId,
  semester: 'FALL',
  year: 2026,
};
export const allocationPreview = (
  scope = allocationScope,
  revision: number | null = 3,
): AllocationPreviewDTO => {
  const curriculum = {
    id: scope.curriculumId,
    code: 'SIM',
    name: 'Simulated reference',
    school: 'CSE',
  };
  const resources =
    revision === null
      ? null
      : { professors: 1, classrooms: 1, labRooms: 2, maxStudentsPerSection: 1 };
  const course = { id: memberId, code: 'MA001IU', name: 'Scoped Calculus', demandStudentCount: 2 };
  return {
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    consistencyBasis: 'SINGLE_DATABASE_SNAPSHOT',
    model: 'ONE_COURSE_PER_STUDENT_ROUND_V1',
    utilityBasis: 'BAYESIAN_DIFFICULTY_FIT_ONLY_V1',
    eligibilityValidated: false,
    allocationValidated: false,
    timetableValidated: false,
    persisted: false,
    categoryPersonalizationAvailable: false,
    gradePersonalizationAvailable: false,
    timelinePersonalizationAvailable: false,
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
        eligiblePlannedStudentCount: 1,
        recommendedStudentCount: 2,
        eligiblePlannedSelectionCount: 1,
        recommendedSelectionCount: 2,
        demandSelectionCount: 2,
        overlapSelectionCount: 1,
        ignoredNonmemberPlannedSelectionCount: 1,
        ineligibleMemberPlannedSelectionCount: 1,
        unresolvedGpaStudentCount: 1,
        courses: [
          {
            ...course,
            eligiblePlannedStudentCount: 1,
            recommendedStudentCount: 2,
            overlapStudentCount: 1,
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
              classroomSectionCeiling: 1,
              professorSectionCeiling: 1,
              sharedSectionCeiling: 1,
              sharedSeatCeiling: 1,
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
    },
    allocationPolicy: {
      studentUtilityWeight: 0.6,
      resourceFitWeight: 0.25,
      fairnessWeight: 0.15,
      congestionThreshold: 0.85,
    },
    assignedStudentCount: resources ? 1 : 0,
    noChoicesStudentCount: 1,
    resourceUnknownStudentCount: resources ? 0 : 2,
    capacityExhaustedStudentCount: resources ? 1 : 0,
    usedSections: resources ? 1 : 0,
    courses: [
      {
        ...course,
        assignedStudentCount: resources ? 1 : 0,
        openedSections: resources ? 1 : 0,
        seatCapacity: resources ? 1 : 0,
        seatUtilization: resources ? 1 : null,
      },
    ],
  };
};

export const emptyAllocationPreview = (cohort = 0, includeCourse = true) => {
  const value = allocationPreview();
  const demand = value.snapshot.demand;
  Object.assign(demand, {
    cohortStudentCount: cohort,
    demandStudentCount: 0,
    eligiblePlannedStudentCount: 0,
    recommendedStudentCount: 0,
    eligiblePlannedSelectionCount: 0,
    recommendedSelectionCount: 0,
    demandSelectionCount: 0,
    overlapSelectionCount: 0,
    ignoredNonmemberPlannedSelectionCount: 0,
    ineligibleMemberPlannedSelectionCount: 0,
    unresolvedGpaStudentCount: cohort,
  });
  demand.courses = includeCourse
    ? demand.courses.map((course) => ({
        ...course,
        eligiblePlannedStudentCount: 0,
        recommendedStudentCount: 0,
        overlapStudentCount: 0,
        demandStudentCount: 0,
      }))
    : [];
  Object.assign(value, {
    assignedStudentCount: 0,
    noChoicesStudentCount: cohort,
    resourceUnknownStudentCount: 0,
    capacityExhaustedStudentCount: 0,
    usedSections: 0,
  });
  value.courses = includeCourse
    ? value.courses.map((course) => ({
        ...course,
        demandStudentCount: 0,
        assignedStudentCount: 0,
        openedSections: 0,
        seatCapacity: 0,
        seatUtilization: null,
      }))
    : [];
  return value;
};
