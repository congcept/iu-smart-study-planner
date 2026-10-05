import {
  AllocationPreviewSchema,
  AllocationRunSummaryV1Schema,
  type AllocationPreviewDTO,
  type AllocationRunSummaryV1DTO,
} from '@iu-study-planner/shared';

/** Pin the verified aggregate preview without retaining private allocation inputs. */
export function projectAllocationRunSummary(
  input: AllocationPreviewDTO,
): AllocationRunSummaryV1DTO {
  const preview = AllocationPreviewSchema.parse(input);
  const { demand, resourceEnvelope } = preview.snapshot;
  const { resources, envelope, resourceRevision, policy } = resourceEnvelope;
  return AllocationRunSummaryV1Schema.parse({
    kind: preview.kind,
    usage: preview.usage,
    model: preview.model,
    utilityBasis: preview.utilityBasis,
    assignmentsPersisted: false,
    eligibilityValidated: preview.eligibilityValidated,
    timetableValidated: preview.timetableValidated,
    allocationValidated: preview.allocationValidated,
    categoryPersonalizationAvailable: preview.categoryPersonalizationAvailable,
    gradePersonalizationAvailable: preview.gradePersonalizationAvailable,
    timelinePersonalizationAvailable: preview.timelinePersonalizationAvailable,
    scope: { ...demand.scope },
    curriculum: { ...demand.curriculum },
    cohortStudentCount: demand.cohortStudentCount,
    demandStudentCount: demand.demandStudentCount,
    unresolvedGpaStudentCount: demand.unresolvedGpaStudentCount,
    assignedStudentCount: preview.assignedStudentCount,
    noChoicesStudentCount: preview.noChoicesStudentCount,
    resourceUnknownStudentCount: preview.resourceUnknownStudentCount,
    capacityExhaustedStudentCount: preview.capacityExhaustedStudentCount,
    usedSections: preview.usedSections,
    utilityPolicy: { ...preview.utilityPolicy },
    allocationPolicy: { ...preview.allocationPolicy },
    recommendationPolicy: { ...demand.recommendationPolicy },
    resources:
      resources === null || envelope === null || resourceRevision === null
        ? null
        : {
            resourceRevision,
            professors: resources.professors,
            classrooms: resources.classrooms,
            labRooms: resources.labRooms,
            maxStudentsPerSection: resources.maxStudentsPerSection,
            classroomTimeBlocks: policy.classroomTimeBlocks,
            sectionsPerProfessor: policy.sectionsPerProfessor,
            sharedSectionCeiling: envelope.sharedSectionCeiling,
            sharedSeatCeiling: envelope.sharedSeatCeiling,
          },
    courses: preview.courses.map((course) => ({ ...course })),
  });
}
