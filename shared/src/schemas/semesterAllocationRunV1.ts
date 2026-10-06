import { z } from 'zod';

import {
  SemesterAllocationCourseLedgerV1Schema,
  SemesterAllocationCurriculumV1Schema,
  SemesterAllocationEnvelopeV1Schema,
  SemesterAllocationPolicyV1Schema,
  SemesterAllocationResultV1Schema,
  SemesterAllocationScopeV1Schema,
  SemesterAllocationStudentResultV1Schema,
} from './semesterAllocationResultV1';

// Pinned storage/read format: imports may only refer to other frozen V1 definitions.
const count = z.number().int().nonnegative().safe();
const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((id) => id.toLowerCase());

const runMetadata = {
  id: uuid,
  formatVersion: z.literal(1),
  capturedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  snapshotStored: z.literal(true),
  simulationAssignmentsStored: z.literal(true),
};

const capturePrecedesCreation = (run: { capturedAt: string; createdAt: string }) => {
  const captured = Date.parse(run.capturedAt);
  const created = Date.parse(run.createdAt);
  if (captured !== created) return captured < created;
  // Preserve ordering when stored timestamps retain finer precision than Date milliseconds.
  const capturedFraction = /\.(\d+)Z$/.exec(run.capturedAt)?.[1] ?? '';
  const createdFraction = /\.(\d+)Z$/.exec(run.createdAt)?.[1] ?? '';
  const precision = Math.max(capturedFraction.length, createdFraction.length);
  return capturedFraction.padEnd(precision, '0') <= createdFraction.padEnd(precision, '0');
};

/** Cookie actor/scenario preconditions only. HTTP callers never upload a roster or result. */
export const CreateSemesterAllocationRunSchema = SemesterAllocationScopeV1Schema.extend({
  requestId: uuid,
  expectedActorId: uuid,
}).strict();

/** Private immutable snapshot. Its computed result remains persisted:false by design. */
export const SemesterAllocationStorageV1Schema = z
  .object({ ...runMetadata, result: SemesterAllocationResultV1Schema })
  .strict()
  .refine(capturePrecedesCreation, 'Stored capture must not follow creation');

const stopReasonCounts = z
  .object({
    TARGET_REACHED: count.max(500),
    NO_REMAINING_CHOICES: count.max(500),
    CREDIT_LIMIT: count.max(500),
    RESOURCE_UNKNOWN: count.max(500),
    CAPACITY_EXHAUSTED: count.max(500),
  })
  .strict();

/** Public admin aggregate: no participants, supplied choices, retry keys or authors. */
export const SemesterAllocationRunSummaryV1Schema = z
  .object({
    kind: z.literal('SIMULATION'),
    usage: z.literal('REFERENCE_ONLY'),
    model: z.literal('SEMESTER_CREDIT_BUDGET_V1'),
    scope: SemesterAllocationScopeV1Schema,
    curriculum: SemesterAllocationCurriculumV1Schema,
    envelope: SemesterAllocationEnvelopeV1Schema,
    policy: SemesterAllocationPolicyV1Schema,
    studentCount: count.max(500),
    assignedStudentCount: count.max(500),
    assignedCourseCount: count.max(10000),
    totalTargetCredits: count.max(15000),
    totalAssignedCredits: count.max(15000),
    totalRemainingCredits: count.max(15000),
    stopReasonCounts,
    usedSections: count.max(10000),
    rounds: count.max(100),
    courses: z.array(SemesterAllocationCourseLedgerV1Schema).max(10000),
    eligibilityValidated: z.literal(false),
    allocationValidated: z.literal(false),
    timetableValidated: z.literal(false),
    academicPlansChanged: z.literal(false),
  })
  .strict()
  .superRefine((summary, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const { envelope, scope, curriculum, stopReasonCounts: reasons } = summary;
    if (
      scope.curriculumId !== curriculum.id ||
      scope.curriculumId !== envelope.scope.curriculumId ||
      scope.semester !== envelope.scope.semester ||
      scope.year !== envelope.scope.year ||
      JSON.stringify(curriculum) !== JSON.stringify(envelope.curriculum)
    )
      fail('Stored summary scope and curriculum must match its resource envelope');

    const reasonTotal = Object.values(reasons).reduce((sum, value) => sum + value, 0);
    const unfinishedStudents = summary.studentCount - reasons.TARGET_REACHED;
    if (
      reasonTotal !== summary.studentCount ||
      summary.totalTargetCredits !== summary.totalAssignedCredits + summary.totalRemainingCredits ||
      summary.totalTargetCredits > 30 * summary.studentCount ||
      summary.totalAssignedCredits > 30 * summary.assignedStudentCount ||
      summary.totalRemainingCredits < unfinishedStudents ||
      summary.totalRemainingCredits > 30 * unfinishedStudents
    )
      fail('Stored reasons and credit totals must partition the student targets');

    if (
      summary.assignedStudentCount > summary.studentCount ||
      summary.assignedStudentCount > summary.assignedCourseCount ||
      summary.assignedCourseCount > summary.assignedStudentCount * summary.rounds ||
      summary.assignedCourseCount < summary.rounds ||
      summary.rounds > summary.courses.length ||
      (summary.assignedStudentCount === 0) !== (summary.assignedCourseCount === 0) ||
      (summary.rounds === 0) !== (summary.assignedCourseCount === 0)
    )
      fail('Stored student, course and round counts must agree');

    const resources = envelope.resources;
    const sections = envelope.envelope?.sharedSectionCeiling ?? 0;
    const seats = resources?.maxStudentsPerSection ?? 0;
    if (resources === null) {
      if (
        summary.assignedCourseCount !== 0 ||
        summary.assignedStudentCount !== 0 ||
        summary.usedSections !== 0 ||
        summary.totalAssignedCredits !== 0 ||
        reasons.CAPACITY_EXHAUSTED !== 0
      )
        fail('Missing resources cannot yield stored assignments or exhausted-capacity outcomes');
    } else if (reasons.RESOURCE_UNKNOWN !== 0)
      fail('Configured resources cannot yield unknown-resource outcomes');
    if (reasons.CAPACITY_EXHAUSTED > 0 && summary.usedSections !== sections)
      fail('Exhausted-capacity outcomes require the shared section ceiling to be reached');

    if (new Set(summary.courses.map((course) => course.courseId)).size !== summary.courses.length)
      fail('Stored summary courses must be distinct');
    let assignedCourses = 0;
    let assignedCredits = 0;
    let openedSections = 0;
    let demandChoices = 0;
    for (const course of summary.courses) {
      assignedCourses += course.assignedStudentCount;
      assignedCredits += course.credits * course.assignedStudentCount;
      openedSections += course.openedSections;
      demandChoices += course.demandStudentCount;
      if (
        course.demandStudentCount > summary.studentCount ||
        course.assignedStudentCount > summary.assignedStudentCount ||
        course.assignedStudentCount > course.demandStudentCount ||
        course.assignedStudentCount > course.seatCapacity ||
        course.seatCapacity !== course.openedSections * seats ||
        (course.openedSections === 0) !== (course.assignedStudentCount === 0) ||
        (seats > 0 && course.openedSections !== Math.ceil(course.assignedStudentCount / seats))
      )
        fail('Stored course demand, assignments, packed sections and seats must agree');
    }
    if (
      !Number.isSafeInteger(assignedCourses) ||
      !Number.isSafeInteger(assignedCredits) ||
      !Number.isSafeInteger(openedSections) ||
      !Number.isSafeInteger(demandChoices) ||
      assignedCourses !== summary.assignedCourseCount ||
      assignedCredits !== summary.totalAssignedCredits ||
      openedSections !== summary.usedSections ||
      demandChoices > 10000 ||
      demandChoices > 100 * summary.studentCount ||
      summary.usedSections > sections ||
      summary.assignedCourseCount > (envelope.envelope?.sharedSeatCeiling ?? 0)
    )
      fail('Stored aggregate totals must match the course ledger and shared resource ceilings');
  });

export const SemesterAllocationRunV1Schema = z
  .object({ ...runMetadata, result: SemesterAllocationRunSummaryV1Schema })
  .strict()
  .refine(capturePrecedesCreation, 'Stored capture must not follow creation');

const ownResult = SemesterAllocationStudentResultV1Schema.innerType()
  .omit({ studentId: true })
  .strict();

/** Only the current owner's captured result and assigned course credits may be returned. */
export const OwnSemesterAllocationRunV1Schema = z
  .object({
    ...runMetadata,
    kind: z.literal('SIMULATION'),
    usage: z.literal('REFERENCE_ONLY'),
    model: z.literal('SEMESTER_CREDIT_BUDGET_V1'),
    scope: SemesterAllocationScopeV1Schema,
    eligibilityValidated: z.literal(false),
    allocationValidated: z.literal(false),
    timetableValidated: z.literal(false),
    academicPlansChanged: z.literal(false),
    result: ownResult,
    courses: z.array(z.object({ courseId: uuid, credits: count.max(10) }).strict()).max(100),
  })
  .strict()
  .refine(capturePrecedesCreation, 'Stored capture must not follow creation')
  .superRefine((run, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const { result, courses } = run;
    if (
      new Set(result.courseIds).size !== result.courseIds.length ||
      JSON.stringify(result.courseIds) !== JSON.stringify(courses.map((course) => course.courseId))
    )
      fail('Own stored course metadata must match the distinct assigned course IDs');
    if (
      result.assignedCredits !== courses.reduce((sum, course) => sum + course.credits, 0) ||
      result.assignedCredits + result.remainingCredits !== result.targetCredits ||
      (result.reason === 'TARGET_REACHED') !== (result.remainingCredits === 0) ||
      (result.targetCredits === 0 && courses.length !== 0) ||
      (result.reason === 'RESOURCE_UNKNOWN' && courses.length !== 0)
    )
      fail('Own stored course credits and terminal reason must match the captured target');
  });

export type CreateSemesterAllocationRunDTO = z.infer<typeof CreateSemesterAllocationRunSchema>;
export type SemesterAllocationStorageV1DTO = z.infer<typeof SemesterAllocationStorageV1Schema>;
export type SemesterAllocationRunSummaryV1DTO = z.infer<
  typeof SemesterAllocationRunSummaryV1Schema
>;
export type SemesterAllocationRunV1DTO = z.infer<typeof SemesterAllocationRunV1Schema>;
export type OwnSemesterAllocationRunV1DTO = z.infer<typeof OwnSemesterAllocationRunV1Schema>;
