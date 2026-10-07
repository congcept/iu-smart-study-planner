import {
  SemesterAllocationResultV1Schema,
  SemesterAllocationRunSummaryV1Schema,
  type SemesterAllocationRunSummaryV1DTO,
} from '@iu-study-planner/shared';

/** Public projection requires the private pinned result to verify before dropping identities. */
export function projectSemesterAllocationSummary(
  rawResult: unknown,
): SemesterAllocationRunSummaryV1DTO {
  const parsed = SemesterAllocationResultV1Schema.safeParse(rawResult);
  if (!parsed.success) throw new Error('Semester simulation result could not be verified');
  const result = parsed.data;
  const stopReasonCounts = {
    TARGET_REACHED: 0,
    NO_REMAINING_CHOICES: 0,
    CREDIT_LIMIT: 0,
    RESOURCE_UNKNOWN: 0,
    CAPACITY_EXHAUSTED: 0,
  };
  for (const student of result.students) stopReasonCounts[student.reason]++;
  const projected = SemesterAllocationRunSummaryV1Schema.safeParse({
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    model: result.model,
    scope: result.envelope.scope,
    curriculum: result.envelope.curriculum,
    envelope: result.envelope,
    policy: result.policy,
    studentCount: result.students.length,
    assignedStudentCount: result.assignedStudentCount,
    assignedCourseCount: result.assignedCourseCount,
    totalTargetCredits: result.students.reduce((sum, student) => sum + student.targetCredits, 0),
    totalAssignedCredits: result.students.reduce(
      (sum, student) => sum + student.assignedCredits,
      0,
    ),
    totalRemainingCredits: result.students.reduce(
      (sum, student) => sum + student.remainingCredits,
      0,
    ),
    stopReasonCounts,
    usedSections: result.usedSections,
    rounds: result.rounds,
    courses: result.courses,
    eligibilityValidated: false,
    allocationValidated: false,
    timetableValidated: false,
    academicPlansChanged: false,
  });
  if (!projected.success) throw new Error('Semester simulation summary could not be verified');
  return projected.data;
}
