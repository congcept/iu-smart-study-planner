import { z } from 'zod';
import { AllocationRunV1Schema } from './allocationRunV1';

const uuid = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());
const scopeSchema = z
  .object({
    curriculumId: uuid,
    semester: z.enum(['FALL', 'SPRING', 'SUMMER']),
    year: z.number().int().min(2000).max(2100),
  })
  .strict();
export const ListAllocationRunsSchema = scopeSchema.extend({ after: uuid.optional() });

export const AllocationRunHistorySchema = z
  .object({
    kind: z.literal('SIMULATION'),
    usage: z.literal('REFERENCE_ONLY'),
    scope: scopeSchema,
    order: z.literal('STORED_NEWEST_FIRST'),
    pageSize: z.literal(20),
    runs: z.array(AllocationRunV1Schema).max(20),
    nextAfter: uuid.nullable(),
  })
  .strict()
  .superRefine((page, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (new Set(page.runs.map((run) => run.id)).size !== page.runs.length)
      fail('History run IDs must be distinct');
    for (const [index, run] of page.runs.entries()) {
      const scope = run.result.scope;
      if (
        scope.curriculumId !== page.scope.curriculumId ||
        scope.semester !== page.scope.semester ||
        scope.year !== page.scope.year
      )
        fail('Every history run must match its scenario');
      const previous = page.runs[index - 1];
      if (previous) {
        const time = Date.parse(previous.createdAt) - Date.parse(run.createdAt);
        const left = /\.(\d+)Z$/.exec(previous.createdAt)?.[1] ?? '';
        const right = /\.(\d+)Z$/.exec(run.createdAt)?.[1] ?? '';
        const precision = Math.max(left.length, right.length);
        const fractions = left.padEnd(precision, '0').localeCompare(right.padEnd(precision, '0'));
        if (
          time < 0 ||
          (time === 0 && (fractions < 0 || (fractions === 0 && previous.id <= run.id)))
        )
          fail('History must be ordered by storage time and ID descending');
      }
    }
    if (
      page.nextAfter !== null &&
      (page.runs.length !== 20 || page.nextAfter !== page.runs.at(-1)?.id)
    )
      fail('History continuation must identify the last run of a full page');
  });

export type ListAllocationRunsDTO = z.infer<typeof ListAllocationRunsSchema>;
export type AllocationRunHistoryDTO = z.infer<typeof AllocationRunHistorySchema>;
