import { z } from 'zod';

// Pinned storage format: do not import evolving preview schemas into V1.
const count = z.number().int().nonnegative().safe();
const unit = z.number().finite().min(0).max(1);
const uuid = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());
const resourceCount = z.number().int().min(0).max(100000);

const utilityPolicy = z
  .object({
    difficultyFitWeight: unit,
    immediateUnlockWeight: unit,
  })
  .strict()
  .refine(
    (policy) => Math.abs(policy.difficultyFitWeight + policy.immediateUnlockWeight - 1) <= 1e-10,
    'Allocation utility weights must sum to one',
  );
const allocationPolicy = z
  .object({
    studentUtilityWeight: unit,
    resourceFitWeight: unit,
    fairnessWeight: unit,
    congestionThreshold: unit,
  })
  .strict()
  .refine(
    (policy) =>
      Math.abs(
        policy.studentUtilityWeight + policy.resourceFitWeight + policy.fairnessWeight - 1,
      ) <= 1e-10,
    'Allocation weights must sum to one',
  );

export const AllocationRunSummaryV1Schema = z
  .object({
    kind: z.literal('SIMULATION'),
    usage: z.literal('REFERENCE_ONLY'),
    model: z.literal('ONE_COURSE_PER_STUDENT_ROUND_V1'),
    utilityBasis: z.literal('BAYESIAN_DIFFICULTY_AND_IMMEDIATE_UNLOCKS_V1'),
    assignmentsPersisted: z.literal(false),
    eligibilityValidated: z.literal(false),
    timetableValidated: z.literal(false),
    allocationValidated: z.literal(false),
    categoryPersonalizationAvailable: z.literal(false),
    gradePersonalizationAvailable: z.literal(false),
    timelinePersonalizationAvailable: z.literal(false),
    scope: z
      .object({
        curriculumId: uuid,
        semester: z.enum(['FALL', 'SPRING', 'SUMMER']),
        year: z.number().int().min(2000).max(2100),
      })
      .strict(),
    curriculum: z
      .object({
        id: uuid,
        code: z.string().min(1),
        name: z.string().min(1),
        school: z.string().min(1),
      })
      .strict(),
    cohortStudentCount: count,
    demandStudentCount: count,
    unresolvedGpaStudentCount: count,
    assignedStudentCount: count,
    noChoicesStudentCount: count,
    resourceUnknownStudentCount: count,
    capacityExhaustedStudentCount: count,
    usedSections: count,
    utilityPolicy,
    allocationPolicy,
    recommendationPolicy: z
      .object({
        maxCredits: z.number().int().min(1).max(30),
        maxDifficulty: z.number().finite().min(1).max(5),
      })
      .strict(),
    resources: z
      .object({
        resourceRevision: z.number().int().min(1).max(2147483647),
        professors: resourceCount,
        classrooms: resourceCount,
        labRooms: resourceCount,
        maxStudentsPerSection: z.number().int().min(1).max(100000),
        classroomTimeBlocks: z.number().int().min(0).max(100),
        sectionsPerProfessor: z.number().int().min(0).max(100),
        sharedSectionCeiling: count,
        sharedSeatCeiling: count,
      })
      .strict()
      .nullable(),
    courses: z.array(
      z
        .object({
          id: uuid,
          code: z.string().min(1),
          name: z.string().min(1),
          demandStudentCount: count,
          assignedStudentCount: count,
          openedSections: count,
          seatCapacity: count,
          seatUtilization: unit.nullable(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((summary, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (summary.scope.curriculumId !== summary.curriculum.id)
      issue('Stored run scope must match its curriculum');
    if (
      summary.demandStudentCount > summary.cohortStudentCount ||
      summary.unresolvedGpaStudentCount > summary.cohortStudentCount ||
      summary.assignedStudentCount +
        summary.noChoicesStudentCount +
        summary.resourceUnknownStudentCount +
        summary.capacityExhaustedStudentCount !==
        summary.cohortStudentCount ||
      summary.noChoicesStudentCount !== summary.cohortStudentCount - summary.demandStudentCount ||
      summary.assignedStudentCount > summary.demandStudentCount
    )
      issue('Stored run outcomes must partition the cohort and its eligible choices');

    const resources = summary.resources;
    if (resources === null) {
      if (
        summary.assignedStudentCount !== 0 ||
        summary.usedSections !== 0 ||
        summary.capacityExhaustedStudentCount !== 0 ||
        summary.resourceUnknownStudentCount !== summary.demandStudentCount
      )
        issue('Missing-resource run must leave every eligible student unresolved');
    } else {
      if (summary.resourceUnknownStudentCount !== 0)
        issue('Configured run resources cannot be reported as unknown');
      const sharedSections = Math.min(
        resources.classrooms * resources.classroomTimeBlocks,
        resources.professors *
          Math.min(resources.classroomTimeBlocks, resources.sectionsPerProfessor),
      );
      if (
        resources.sharedSectionCeiling !== sharedSections ||
        resources.sharedSeatCeiling !== sharedSections * resources.maxStudentsPerSection
      )
        issue('Stored resource ceilings must match the captured resources and policy');
    }

    if (
      new Set(summary.courses.map(({ id }) => id)).size !== summary.courses.length ||
      new Set(summary.courses.map(({ code }) => code)).size !== summary.courses.length
    )
      issue('Stored run course identifiers must be distinct');
    const seats = resources?.maxStudentsPerSection ?? 0;
    for (const course of summary.courses) {
      if (
        course.demandStudentCount > summary.demandStudentCount ||
        course.assignedStudentCount > course.demandStudentCount ||
        course.assignedStudentCount > course.seatCapacity ||
        course.seatCapacity !== course.openedSections * seats ||
        (course.openedSections === 0) !== (course.assignedStudentCount === 0) ||
        (seats > 0 && course.openedSections !== Math.ceil(course.assignedStudentCount / seats)) ||
        (course.seatCapacity === 0
          ? course.seatUtilization !== null
          : course.seatUtilization !== course.assignedStudentCount / course.seatCapacity)
      )
        issue('Stored course demand, sections, seats and utilization must agree');
    }
    const assigned = summary.courses.reduce(
      (total, course) => total + course.assignedStudentCount,
      0,
    );
    const sections = summary.courses.reduce((total, course) => total + course.openedSections, 0);
    const demandSelections = summary.courses.reduce(
      (total, course) => total + course.demandStudentCount,
      0,
    );
    if (
      !Number.isSafeInteger(assigned) ||
      !Number.isSafeInteger(sections) ||
      !Number.isSafeInteger(demandSelections) ||
      assigned !== summary.assignedStudentCount ||
      sections !== summary.usedSections ||
      demandSelections < summary.demandStudentCount ||
      (demandSelections === 0) !== (summary.demandStudentCount === 0) ||
      summary.usedSections > (resources?.sharedSectionCeiling ?? 0) ||
      summary.assignedStudentCount > (resources?.sharedSeatCeiling ?? 0)
    )
      issue('Stored run totals must match course rows within the captured envelope');
  });

export const AllocationRunV1Schema = z
  .object({
    id: uuid,
    formatVersion: z.literal(1),
    capturedAt: z.string().datetime(),
    createdAt: z.string().datetime(),
    snapshotStored: z.literal(true),
    result: AllocationRunSummaryV1Schema,
  })
  .strict()
  .refine((run) => {
    const captured = Date.parse(run.capturedAt);
    const created = Date.parse(run.createdAt);
    if (captured !== created) return captured < created;
    // Datetime strings can retain finer precision than JavaScript's millisecond Date.
    const capturedFraction = /\.(\d+)Z$/.exec(run.capturedAt)?.[1] ?? '';
    const createdFraction = /\.(\d+)Z$/.exec(run.createdAt)?.[1] ?? '';
    const precision = Math.max(capturedFraction.length, createdFraction.length);
    return capturedFraction.padEnd(precision, '0') <= createdFraction.padEnd(precision, '0');
  }, 'Stored run capture must not follow its creation');

export type AllocationRunSummaryV1DTO = z.infer<typeof AllocationRunSummaryV1Schema>;
export type AllocationRunV1DTO = z.infer<typeof AllocationRunV1Schema>;
