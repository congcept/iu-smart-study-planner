import { z } from 'zod';
import type { CohortResourceSnapshotSchema, SimulationAllocationPolicySchema } from './index';

const count = z.number().int().nonnegative().safe();
const uuid = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());

export const createAllocationPreviewSchema = (
  snapshotSchema: typeof CohortResourceSnapshotSchema,
  policySchema: typeof SimulationAllocationPolicySchema,
) =>
  z
    .object({
      kind: z.literal('SIMULATION'),
      usage: z.literal('REFERENCE_ONLY'),
      consistencyBasis: z.literal('SINGLE_DATABASE_SNAPSHOT'),
      model: z.literal('ONE_COURSE_PER_STUDENT_ROUND_V1'),
      utilityBasis: z.literal('BAYESIAN_DIFFICULTY_FIT_ONLY_V1'),
      eligibilityValidated: z.literal(false),
      allocationValidated: z.literal(false),
      timetableValidated: z.literal(false),
      persisted: z.literal(false),
      categoryPersonalizationAvailable: z.literal(false),
      gradePersonalizationAvailable: z.literal(false),
      timelinePersonalizationAvailable: z.literal(false),
      snapshot: snapshotSchema,
      allocationPolicy: policySchema,
      assignedStudentCount: count,
      noChoicesStudentCount: count,
      resourceUnknownStudentCount: count,
      capacityExhaustedStudentCount: count,
      usedSections: count,
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
            seatUtilization: z.number().finite().min(0).max(1).nullable(),
          })
          .strict(),
      ),
    })
    .strict()
    .superRefine((preview, ctx) => {
      const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      const { demand, resourceEnvelope } = preview.snapshot;
      if (
        preview.assignedStudentCount +
          preview.noChoicesStudentCount +
          preview.resourceUnknownStudentCount +
          preview.capacityExhaustedStudentCount !==
          demand.cohortStudentCount ||
        preview.noChoicesStudentCount !== demand.cohortStudentCount - demand.demandStudentCount ||
        preview.assignedStudentCount > demand.demandStudentCount
      )
        issue('Preview outcomes must partition the entire cohort and its eligible choices');
      if (resourceEnvelope.resources === null) {
        if (
          preview.assignedStudentCount !== 0 ||
          preview.usedSections !== 0 ||
          preview.capacityExhaustedStudentCount !== 0 ||
          preview.resourceUnknownStudentCount !== demand.demandStudentCount
        )
          issue('Missing-resource preview must leave every eligible student unresolved');
      } else if (preview.resourceUnknownStudentCount !== 0)
        issue('Configured resources cannot be reported as unknown');
      const courses = new Map(demand.courses.map((course) => [course.id, course]));
      if (
        preview.courses.length !== courses.size ||
        new Set(preview.courses.map(({ id }) => id)).size !== preview.courses.length
      )
        issue('Preview must contain every member course exactly once');
      const seats = resourceEnvelope.resources?.maxStudentsPerSection ?? 0;
      for (const course of preview.courses) {
        const reference = courses.get(course.id);
        if (
          !reference ||
          course.code !== reference.code ||
          course.name !== reference.name ||
          course.demandStudentCount !== reference.demandStudentCount
        )
          issue('Preview course identity and demand must match its snapshot');
        if (
          course.assignedStudentCount > course.demandStudentCount ||
          course.assignedStudentCount > course.seatCapacity ||
          course.seatCapacity !== course.openedSections * seats ||
          (course.openedSections === 0) !== (course.assignedStudentCount === 0) ||
          (seats > 0 && course.openedSections !== Math.ceil(course.assignedStudentCount / seats)) ||
          (course.seatCapacity === 0
            ? course.seatUtilization !== null
            : course.seatUtilization !== course.assignedStudentCount / course.seatCapacity)
        )
          issue('Preview sections, assigned seats and utilization must agree');
      }
      if (
        preview.assignedStudentCount !==
          preview.courses.reduce((total, course) => total + course.assignedStudentCount, 0) ||
        preview.usedSections !==
          preview.courses.reduce((total, course) => total + course.openedSections, 0) ||
        preview.usedSections > (resourceEnvelope.envelope?.sharedSectionCeiling ?? 0) ||
        preview.assignedStudentCount > (resourceEnvelope.envelope?.sharedSeatCeiling ?? 0)
      )
        issue('Preview totals must match course rows within the shared envelope');
    });
