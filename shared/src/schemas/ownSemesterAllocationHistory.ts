import { z } from 'zod';
import { OwnSemesterAllocationRunV1Schema } from './semesterAllocationRunV1';

const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((id) => id.toLowerCase());

/** Account identity is supplied exclusively by the cookie session, never the query. */
export const ListOwnSemesterAllocationRunsSchema = z.object({ after: uuid.optional() }).strict();

export const OwnSemesterAllocationHistorySchema = z
  .object({
    kind: z.literal('SIMULATION'),
    usage: z.literal('REFERENCE_ONLY'),
    visibility: z.literal('CURRENT_ACCOUNT_ONLY'),
    order: z.literal('STORED_NEWEST_FIRST'),
    pageSize: z.literal(5),
    after: uuid.nullable(),
    runs: z.array(OwnSemesterAllocationRunV1Schema).max(5),
    nextAfter: uuid.nullable(),
  })
  .strict()
  .superRefine((page, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (new Set(page.runs.map((run) => run.id)).size !== page.runs.length)
      fail('Own history run identifiers must be distinct');
    for (const [index, run] of page.runs.entries()) {
      if (run.id === page.after) fail('Own history must exclude its continuation boundary');
      const previous = page.runs[index - 1];
      if (!previous) continue;
      const time = Date.parse(previous.createdAt) - Date.parse(run.createdAt);
      const left = /\.(\d+)Z$/.exec(previous.createdAt)?.[1] ?? '';
      const right = /\.(\d+)Z$/.exec(run.createdAt)?.[1] ?? '';
      const precision = Math.max(left.length, right.length);
      const fractions = left.padEnd(precision, '0').localeCompare(right.padEnd(precision, '0'));
      if (time < 0 || (time === 0 && (fractions < 0 || (fractions === 0 && previous.id <= run.id))))
        fail('Own history must be ordered by storage time and identifier descending');
    }
    if (
      page.nextAfter !== null &&
      (page.runs.length !== 5 || page.nextAfter !== page.runs.at(-1)?.id)
    )
      fail('Own history continuation must identify the last run of a full page');
  });

export type ListOwnSemesterAllocationRunsDTO = z.infer<typeof ListOwnSemesterAllocationRunsSchema>;
export type OwnSemesterAllocationHistoryDTO = z.infer<typeof OwnSemesterAllocationHistorySchema>;
