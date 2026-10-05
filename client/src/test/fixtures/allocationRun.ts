import {
  AllocationRunV1Schema,
  AllocationRunHistorySchema,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';
import { allocationPreview, allocationScope } from './allocationPreview';

export const allocationRun = (scope: ResourceScopeDTO = allocationScope) => {
  const preview = allocationPreview(scope);
  const { demand, resourceEnvelope } = preview.snapshot;
  const { resources, envelope, resourceRevision, policy } = resourceEnvelope;
  return AllocationRunV1Schema.parse({
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    formatVersion: 1,
    capturedAt: '2026-10-05T02:00:00.000Z',
    createdAt: '2026-10-05T02:00:01.000Z',
    snapshotStored: true,
    result: {
      kind: preview.kind,
      usage: preview.usage,
      model: preview.model,
      utilityBasis: preview.utilityBasis,
      assignmentsPersisted: false,
      eligibilityValidated: false,
      timetableValidated: false,
      allocationValidated: false,
      categoryPersonalizationAvailable: false,
      gradePersonalizationAvailable: false,
      timelinePersonalizationAvailable: false,
      scope: demand.scope,
      curriculum: demand.curriculum,
      cohortStudentCount: demand.cohortStudentCount,
      demandStudentCount: demand.demandStudentCount,
      unresolvedGpaStudentCount: demand.unresolvedGpaStudentCount,
      assignedStudentCount: preview.assignedStudentCount,
      noChoicesStudentCount: preview.noChoicesStudentCount,
      resourceUnknownStudentCount: preview.resourceUnknownStudentCount,
      capacityExhaustedStudentCount: preview.capacityExhaustedStudentCount,
      usedSections: preview.usedSections,
      utilityPolicy: preview.utilityPolicy,
      allocationPolicy: preview.allocationPolicy,
      recommendationPolicy: demand.recommendationPolicy,
      resources:
        resources && envelope && resourceRevision !== null
          ? {
              resourceRevision,
              ...resources,
              classroomTimeBlocks: policy.classroomTimeBlocks,
              sectionsPerProfessor: policy.sectionsPerProfessor,
              sharedSectionCeiling: envelope.sharedSectionCeiling,
              sharedSeatCeiling: envelope.sharedSeatCeiling,
            }
          : null,
      courses: preview.courses,
    },
  });
};

export const allocationHistory = (
  scope: ResourceScopeDTO = allocationScope,
  length = 1,
  hasMore = false,
) => {
  const runs = Array.from({ length }, (_, index) => ({
    ...allocationRun(scope),
    id: `dddddddd-dddd-4ddd-8ddd-${(length - index).toString(16).padStart(12, '0')}`,
    capturedAt: '2026-10-05T01:00:00.000Z',
    createdAt: new Date(Date.parse('2026-10-05T02:00:00.000Z') - index * 1000).toISOString(),
  }));
  return AllocationRunHistorySchema.parse({
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    scope,
    order: 'STORED_NEWEST_FIRST',
    pageSize: 20,
    runs,
    nextAfter: hasMore ? runs.at(-1)?.id : null,
  });
};
