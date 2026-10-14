import { z } from 'zod';

const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((id) => id.toLowerCase());

/** The cookie supplies the owner; query fields cannot select an account or curriculum. */
export const ListOwnStudyPlansSchema = z.object({ after: uuid.optional() }).strict();

export const OwnStudyPlanMetadataSchema = z
  .object({
    id: uuid,
    name: z.string(),
    description: z.string().nullable(),
    isActive: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    semesterCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

/** Current account scope does not assign a curriculum identity to these older saved plans. */
export const OwnStudyPlansSchema = z
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
    pageSize: z.literal(5),
    after: uuid.nullable(),
    plans: z.array(OwnStudyPlanMetadataSchema).max(5),
    nextAfter: uuid.nullable(),
  })
  .strict()
  .superRefine((page, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (new Set(page.plans.map((plan) => plan.id)).size !== page.plans.length)
      fail('Saved plan identities must be distinct');
    for (const [index, plan] of page.plans.entries()) {
      if (plan.id === page.after) fail('Saved plans must exclude their continuation boundary');
      const previous = page.plans[index - 1];
      if (!previous) continue;
      const time = Date.parse(previous.createdAt) - Date.parse(plan.createdAt);
      const left = /\.(\d+)Z$/.exec(previous.createdAt)?.[1] ?? '';
      const right = /\.(\d+)Z$/.exec(plan.createdAt)?.[1] ?? '';
      const precision = Math.max(left.length, right.length);
      const fractions = left.padEnd(precision, '0').localeCompare(right.padEnd(precision, '0'));
      if (
        time < 0 ||
        (time === 0 && (fractions < 0 || (fractions === 0 && previous.id <= plan.id)))
      )
        fail('Saved plans must be ordered by storage time and identifier descending');
    }
    if (
      page.nextAfter !== null &&
      (page.plans.length !== 5 || page.nextAfter !== page.plans.at(-1)?.id)
    )
      fail('Saved plan continuation must identify the last plan of a full page');
  });

export type ListOwnStudyPlansDTO = z.infer<typeof ListOwnStudyPlansSchema>;
export type OwnStudyPlanMetadataDTO = z.infer<typeof OwnStudyPlanMetadataSchema>;
export type OwnStudyPlansDTO = z.infer<typeof OwnStudyPlansSchema>;
