import { z } from 'zod';
import { OwnStudyPlanMetadataSchema } from './ownStudyPlans';
import { OwnStudyPlanSemesterMetadataSchema } from './ownStudyPlanSemesters';

const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((id) => id.toLowerCase());
const signedInteger = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);

export const OwnStudyPlanCoursesParamsSchema = z
  .object({ planId: uuid, semesterId: uuid })
  .strict();

/** Labels describe today's catalog; they do not validate the historical saved selection. */
export const OwnStudyPlanCourseReferencesSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('RECOGNIZED'),
      order: z.literal('STORED_ARRAY_ORDER'),
      entries: z
        .array(
          z
            .object({
              courseId: uuid,
              storedPosition: signedInteger,
              catalog: z.object({ code: z.string(), name: z.string() }).strict().nullable(),
            })
            .strict(),
        )
        .max(100)
        .superRefine((entries, ctx) => {
          if (new Set(entries.map(({ courseId }) => courseId)).size !== entries.length)
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Course references must be distinct',
            });
        }),
    })
    .strict(),
  z
    .object({
      status: z.literal('UNAVAILABLE'),
      reason: z.enum(['UNSUPPORTED_FORMAT', 'READER_LIMIT']),
    })
    .strict(),
]);

export const OwnStudyPlanCoursesSchema = z
  .object({
    visibility: z.literal('CURRENT_ACCOUNT_ONLY'),
    scope: z
      .object({
        userId: uuid,
        curriculumId: uuid.nullable(),
        studyPlansValidated: z.literal(false),
      })
      .strict(),
    plan: OwnStudyPlanMetadataSchema,
    semester: OwnStudyPlanSemesterMetadataSchema,
    courseReferences: OwnStudyPlanCourseReferencesSchema,
  })
  .strict();

export type OwnStudyPlanCoursesDTO = z.infer<typeof OwnStudyPlanCoursesSchema>;
