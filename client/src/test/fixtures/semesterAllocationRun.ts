import type { ResourceScopeDTO, SemesterAllocationRunV1DTO } from '@iu-study-planner/shared';
import { semesterAllocationPreview, semesterAllocationScope } from './semesterAllocationPreview';

/** The same hand-computed two-round reference, with immutable server receipt metadata. */
export function semesterAllocationRun(
  scope: ResourceScopeDTO = semesterAllocationScope,
): SemesterAllocationRunV1DTO {
  return {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    formatVersion: 1,
    capturedAt: '2026-10-07T02:00:00.000Z',
    createdAt: '2026-10-07T02:00:01.000Z',
    snapshotStored: true,
    simulationAssignmentsStored: true,
    result: semesterAllocationPreview(scope).result,
  };
}
