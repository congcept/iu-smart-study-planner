import { z } from 'zod';
import { AllocationJobOutcomeSchema } from './allocationJobOutcome';

const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((id) => id.toLowerCase());
const scopeSchema = z
  .object({
    curriculumId: uuid,
    semester: z.enum(['FALL', 'SPRING', 'SUMMER']),
    year: z.number().int().min(2000).max(2100),
  })
  .strict();

export const ListAllocationJobsSchema = scopeSchema.extend({ after: uuid.optional() });

/** Outcomes describe this read's snapshot; ordering and continuation use immutable enqueue data. */
export const AllocationJobHistorySchema = z
  .object({
    kind: z.literal('SIMULATION'),
    usage: z.literal('REFERENCE_ONLY'),
    scope: scopeSchema,
    order: z.literal('QUEUED_NEWEST_FIRST'),
    pageSize: z.literal(20),
    jobs: z.array(AllocationJobOutcomeSchema).max(20),
    nextAfter: uuid.nullable(),
  })
  .strict()
  .superRefine((page, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (new Set(page.jobs.map((job) => job.jobId)).size !== page.jobs.length)
      fail('History job IDs must be distinct');
    for (const [index, job] of page.jobs.entries()) {
      if (
        job.scope.curriculumId !== page.scope.curriculumId ||
        job.scope.semester !== page.scope.semester ||
        job.scope.year !== page.scope.year
      )
        fail('Every history job must match its scenario');
      const previous = page.jobs[index - 1];
      if (previous) {
        const time = Date.parse(previous.queuedAt) - Date.parse(job.queuedAt);
        const left = /\.(\d+)Z$/.exec(previous.queuedAt)?.[1] ?? '';
        const right = /\.(\d+)Z$/.exec(job.queuedAt)?.[1] ?? '';
        const precision = Math.max(left.length, right.length);
        const fractions = left.padEnd(precision, '0').localeCompare(right.padEnd(precision, '0'));
        if (
          time < 0 ||
          (time === 0 && (fractions < 0 || (fractions === 0 && previous.jobId <= job.jobId)))
        )
          fail('History must be ordered by enqueue time and ID descending');
      }
    }
    if (
      page.nextAfter !== null &&
      (page.jobs.length !== 20 || page.nextAfter !== page.jobs.at(-1)?.jobId)
    )
      fail('History continuation must identify the last job of a full page');
  });

export type ListAllocationJobsDTO = z.infer<typeof ListAllocationJobsSchema>;
export type AllocationJobHistoryDTO = z.infer<typeof AllocationJobHistorySchema>;
