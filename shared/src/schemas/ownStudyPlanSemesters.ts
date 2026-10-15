import { z } from 'zod';
import { OwnStudyPlanMetadataSchema } from './ownStudyPlans';

const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((id) => id.toLowerCase());

export const OwnStudyPlanSemestersParamsSchema = z.object({ planId: uuid }).strict();
export const ListOwnStudyPlanSemestersSchema = z.object({ after: uuid.optional() }).strict();

/** Stored year and credits are historical integers, not validated calendar or degree values. */
export const OwnStudyPlanSemesterMetadataSchema = z
  .object({
    id: uuid,
    semester: z.enum(['FALL', 'SPRING', 'SUMMER']),
    year: z.number().int().min(-2147483648).max(2147483647),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    storedTotalCredits: z.number().int().min(-2147483648).max(2147483647),
  })
  .strict();

export const OwnStudyPlanSemestersSchema = z
  .object({
    visibility: z.literal('CURRENT_ACCOUNT_ONLY'),
    order: z.literal('STORED_NEWEST_FIRST'),
    scope: z
      .object({
        userId: uuid,
        curriculumId: uuid.nullable(),
        studyPlansValidated: z.literal(false),
      })
      .strict(),
    plan: OwnStudyPlanMetadataSchema,
    pageSize: z.literal(5),
    after: uuid.nullable(),
    semesters: z.array(OwnStudyPlanSemesterMetadataSchema).max(5),
    nextAfter: uuid.nullable(),
  })
  .strict()
  .superRefine((page, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (new Set(page.semesters.map(({ id }) => id)).size !== page.semesters.length)
      fail('Saved semester identities must be distinct');
    if (page.plan.semesterCount < page.semesters.length)
      fail('Saved semester count cannot be smaller than the returned page');
    for (const [index, semester] of page.semesters.entries()) {
      if (semester.id === page.after)
        fail('Saved semesters must exclude their continuation boundary');
      const previous = page.semesters[index - 1];
      if (!previous) continue;
      const time = Date.parse(previous.createdAt) - Date.parse(semester.createdAt);
      const left = /\.(\d+)Z$/.exec(previous.createdAt)?.[1] ?? '';
      const right = /\.(\d+)Z$/.exec(semester.createdAt)?.[1] ?? '';
      const precision = Math.max(left.length, right.length);
      const fractions = left.padEnd(precision, '0').localeCompare(right.padEnd(precision, '0'));
      if (
        time < 0 ||
        (time === 0 && (fractions < 0 || (fractions === 0 && previous.id <= semester.id)))
      )
        fail('Saved semesters must be ordered by storage time and identifier descending');
    }
    if (
      page.nextAfter !== null &&
      (page.semesters.length !== 5 || page.nextAfter !== page.semesters.at(-1)?.id)
    )
      fail('Saved semester continuation must identify the last semester of a full page');
  });

export type ListOwnStudyPlanSemestersDTO = z.infer<typeof ListOwnStudyPlanSemestersSchema>;
export type OwnStudyPlanSemesterMetadataDTO = z.infer<typeof OwnStudyPlanSemesterMetadataSchema>;
export type OwnStudyPlanSemestersDTO = z.infer<typeof OwnStudyPlanSemestersSchema>;
