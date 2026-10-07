import type { OwnSemesterAllocationRunV1DTO } from '@iu-study-planner/shared';
import { semesterAllocationScope } from './semesterAllocationPreview';

export function ownSemesterAllocationRun(index = 1): OwnSemesterAllocationRunV1DTO {
  const courseId = 'aaaaaaaa-0000-4000-8000-000000000099';
  return {
    id: `dddddddd-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    formatVersion: 1,
    capturedAt: '2026-10-07T02:00:00.000Z',
    createdAt: '2026-10-07T02:00:01.000Z',
    snapshotStored: true,
    simulationAssignmentsStored: true,
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    model: 'SEMESTER_CREDIT_BUDGET_V1',
    scope: semesterAllocationScope,
    eligibilityValidated: false,
    allocationValidated: false,
    timetableValidated: false,
    academicPlansChanged: false,
    result: {
      targetCredits: 6,
      courseIds: [courseId],
      assignedCredits: 6,
      remainingCredits: 0,
      reason: 'TARGET_REACHED',
    },
    courses: [{ courseId, credits: 6 }],
  };
}
