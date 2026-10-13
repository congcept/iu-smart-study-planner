import { z } from 'zod';
import { SemesterAllocationJobSchema } from './semesterAllocationJob';
import { SemesterAllocationJobOutcomeSchema } from './semesterAllocationJobOutcome';

const uuid = SemesterAllocationJobSchema.shape.id;
const scope = SemesterAllocationJobSchema.shape.scope;

export const ListSemesterAllocationJobsSchema = scope.extend({ after: uuid.optional() });

/** The queued receipt is immutable; the outcome belongs to this coherent read snapshot. */
export const SemesterAllocationJobHistorySchema = z
  .object({
    kind: z.literal('SIMULATION'),
    usage: z.literal('REFERENCE_ONLY'),
    model: z.literal('SEMESTER_CREDIT_BUDGET_V1'),
    scope,
    order: z.literal('QUEUED_NEWEST_FIRST'),
    pageSize: z.literal(5),
    after: uuid.nullable(),
    requests: z
      .array(
        z
          .object({ job: SemesterAllocationJobSchema, outcome: SemesterAllocationJobOutcomeSchema })
          .strict(),
      )
      .max(5),
    nextAfter: uuid.nullable(),
  })
  .strict()
  .superRefine((page, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const ids = page.requests.map(({ job }) => job.id);
    if (new Set(ids).size !== ids.length || (page.after !== null && ids.includes(page.after)))
      fail('History request IDs must be distinct and exclude the continuation');
    for (const [index, { job, outcome }] of page.requests.entries()) {
      if (
        JSON.stringify(job.scope) !== JSON.stringify(page.scope) ||
        JSON.stringify(outcome.scope) !== JSON.stringify(job.scope) ||
        outcome.jobId !== job.id ||
        outcome.queuedAt !== job.queuedAt ||
        outcome.model !== job.model ||
        job.model !== page.model
      )
        fail('Every receipt and outcome must match its request and scenario');
      const previous = page.requests[index - 1]?.job;
      if (previous) {
        const time = Date.parse(previous.queuedAt) - Date.parse(job.queuedAt);
        const left = /\.(\d+)Z$/.exec(previous.queuedAt)?.[1] ?? '';
        const right = /\.(\d+)Z$/.exec(job.queuedAt)?.[1] ?? '';
        const precision = Math.max(left.length, right.length);
        const fractions = left.padEnd(precision, '0').localeCompare(right.padEnd(precision, '0'));
        if (
          time < 0 ||
          (time === 0 && (fractions < 0 || (fractions === 0 && previous.id <= job.id)))
        )
          fail('History must be ordered by queue time and ID descending');
      }
    }
    if (page.nextAfter !== null && (page.requests.length !== 5 || page.nextAfter !== ids.at(-1)))
      fail('History continuation must identify the last request of a full page');
  });

export type ListSemesterAllocationJobsDTO = z.infer<typeof ListSemesterAllocationJobsSchema>;
export type SemesterAllocationJobHistoryDTO = z.infer<typeof SemesterAllocationJobHistorySchema>;
