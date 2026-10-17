import { z } from 'zod';
import { OwnStudyPlanCoursesSchema } from './ownStudyPlanCourses';

const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((id) => id.toLowerCase());
const revision = z.number().int().min(0).max(2147483647);
const academicYear = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const academicSemester = z.number().int().min(1).max(3);
const courseIds = z
  .array(uuid)
  .max(100)
  .superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Course IDs must be distinct' });
  });
export const ReferenceSaveMetadataSchema = z
  .object({
    policy: z.literal('CURRENT_COMPLETIONS_ONLY_V1'),
    curriculumId: uuid,
    academicYear,
    academicSemester,
    checkedAt: z.string().datetime(),
    revision: revision.refine((value) => value > 0),
  })
  .strict();
export const OwnStudyPlanReferenceSelectionBodySchema = z
  .object({
    requestId: uuid,
    expectedScope: z.object({ userId: uuid, curriculumId: uuid }).strict(),
    expectedRevision: revision,
    academicYear,
    academicSemester,
    courseIds,
  })
  .strict();
export const OwnStudyPlanReferenceSelectionStateSchema = z
  .object({
    snapshot: OwnStudyPlanCoursesSchema,
    revision,
    lastReferenceSave: ReferenceSaveMetadataSchema.nullable(),
    editing: z.discriminatedUnion('status', [
      z
        .object({
          status: z.literal('AVAILABLE'),
          courses: z
            .array(z.object({ id: uuid, code: z.string(), name: z.string() }).strict())
            .max(1000),
        })
        .strict(),
      z
        .object({
          status: z.literal('UNAVAILABLE'),
          reason: z.enum(['NO_ASSIGNED_CURRICULUM', 'COURSE_REFERENCES_UNAVAILABLE']),
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (value.lastReferenceSave && value.lastReferenceSave.revision !== value.revision)
      fail('Saved metadata must match revision');
    const expected =
      value.snapshot.scope.curriculumId === null
        ? 'NO_ASSIGNED_CURRICULUM'
        : value.snapshot.courseReferences.status !== 'RECOGNIZED'
          ? 'COURSE_REFERENCES_UNAVAILABLE'
          : null;
    if (value.editing.status === 'UNAVAILABLE') {
      if (expected !== value.editing.reason) fail('Unavailable reason must match snapshot');
    } else {
      if (expected !== null) fail('Editing requires assigned scope and recognized references');
      if (new Set(value.editing.courses.map(({ id }) => id)).size !== value.editing.courses.length)
        fail('Option identities must be distinct');
    }
  });
export const OwnStudyPlanReferenceSelectionReceiptSchema = z
  .object({
    requestId: uuid,
    userId: uuid,
    curriculumId: uuid,
    planId: uuid,
    semesterId: uuid,
    previousRevision: revision,
    savedRevision: revision,
    referenceSlot: z.object({ academicYear, academicSemester }).strict(),
    courseIds,
    storedTotalCredits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    storedDifficultyScore: z.number().finite().min(0).max(5),
    savedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.savedRevision !== value.previousRevision + 1)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Receipt must advance exactly one revision',
      });
    if (
      value.courseIds.length === 0 &&
      (value.storedTotalCredits !== 0 || value.storedDifficultyScore !== 0)
    )
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'An empty selection has zero totals' });
    if (value.courseIds.length > 0 && value.storedDifficultyScore < 1)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Selected courses require a difficulty estimate',
      });
  });
export const OwnStudyPlanReferenceSelectionResultSchema = z
  .object({
    receipt: OwnStudyPlanReferenceSelectionReceiptSchema,
    replayed: z.boolean(),
  })
  .strict();
export type OwnStudyPlanReferenceSelectionBodyDTO = z.infer<
  typeof OwnStudyPlanReferenceSelectionBodySchema
>;
export type OwnStudyPlanReferenceSelectionStateDTO = z.infer<
  typeof OwnStudyPlanReferenceSelectionStateSchema
>;
export type OwnStudyPlanReferenceSelectionResultDTO = z.infer<
  typeof OwnStudyPlanReferenceSelectionResultSchema
>;
export type OwnStudyPlanReferenceSelectionReceiptDTO = z.infer<
  typeof OwnStudyPlanReferenceSelectionReceiptSchema
>;
