import { z } from 'zod';
import type { ResourceScopeSchema } from './index';

const uuid = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());
const count = z.number().int().nonnegative().safe();

/** Partial simulation evidence: selections are neither dated enrollment nor complete demand. */
export const createPlannedDemandSnapshotSchema = (scopeSchema: typeof ResourceScopeSchema) =>
  z
    .object({
      kind: z.literal('SIMULATION'),
      usage: z.literal('REFERENCE_ONLY'),
      scope: scopeSchema,
      curriculum: z
        .object({
          id: uuid,
          code: z.string().min(1),
          name: z.string().min(1),
          school: z.string().min(1),
        })
        .strict(),
      planningBasis: z.literal('CURRENT_PLANNED_SELECTIONS'),
      termBasis: z.literal('SCENARIO_ONLY'),
      recommendationDemandAvailable: z.literal(false),
      eligibilityValidated: z.literal(false),
      offeringValidationAvailable: z.literal(false),
      resourceRevision: z.number().int().min(1).max(2147483647).nullable(),
      cohortStudentCount: count,
      plannedStudentCount: count,
      plannedSelectionCount: count,
      ignoredNonmemberSelectionCount: count,
      courses: z.array(
        z
          .object({
            id: uuid,
            code: z.string().min(1),
            name: z.string().min(1),
            plannedStudentCount: count,
            supply: z.null(),
            utilization: z.null(),
          })
          .strict(),
      ),
    })
    .strict()
    .superRefine((snapshot, ctx) => {
      const invalid = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      if (snapshot.scope.curriculumId !== snapshot.curriculum.id)
        invalid('Planned selection curriculum does not match its scenario');
      if (
        new Set(snapshot.courses.map((course) => course.id)).size !== snapshot.courses.length ||
        new Set(snapshot.courses.map((course) => course.code)).size !== snapshot.courses.length
      )
        invalid('Duplicate planned selection course identifiers');
      const total = snapshot.courses.reduce((sum, course) => sum + course.plannedStudentCount, 0);
      if (!Number.isSafeInteger(total) || total !== snapshot.plannedSelectionCount)
        invalid('Planned selection total does not match course counts');
      if (
        snapshot.plannedStudentCount > snapshot.cohortStudentCount ||
        snapshot.plannedStudentCount > total ||
        (total === 0) !== (snapshot.plannedStudentCount === 0) ||
        snapshot.courses.some(
          (course) => course.plannedStudentCount > snapshot.plannedStudentCount,
        ) ||
        (snapshot.cohortStudentCount === 0 && snapshot.ignoredNonmemberSelectionCount !== 0)
      )
        invalid('Planned selection counts exceed their student cohort');
    });
