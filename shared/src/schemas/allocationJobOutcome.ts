import { z } from 'zod';

const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((id) => id.toLowerCase());
const datetime = z
  .string()
  .datetime()
  .refine((value) => value === value.trim(), 'Outcome timestamps must not contain whitespace');
const scopeSchema = z
  .object({
    curriculumId: uuid,
    semester: z.enum(['FALL', 'SPRING', 'SUMMER']),
    year: z.number().int().min(2000).max(2100),
  })
  .strict();

/** PENDING means no terminal outcome has committed, including during an active transaction. */
export const AllocationJobOutcomeSchema = z
  .object({
    jobId: uuid,
    kind: z.literal('SIMULATION'),
    usage: z.literal('REFERENCE_ONLY'),
    executionModel: z.literal('ATOMIC_SINGLE_JOB'),
    scope: scopeSchema,
    queuedAt: datetime,
    status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']),
    runId: uuid.nullable(),
    completedAt: datetime.nullable(),
    failureCode: z.enum(['AUTHOR_UNAVAILABLE', 'PREVIEW_UNAVAILABLE']).nullable(),
  })
  .strict()
  .superRefine((outcome, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (outcome.status === 'PENDING') {
      if (outcome.runId !== null || outcome.completedAt !== null || outcome.failureCode !== null)
        fail('Pending outcomes cannot report a terminal result');
    } else {
      if (outcome.completedAt === null) fail('Terminal outcomes require completion time');
      if (outcome.status === 'SUCCEEDED') {
        if (outcome.runId === null || outcome.failureCode !== null)
          fail('Successful outcomes require a run and no failure code');
      } else if (outcome.runId !== null || outcome.failureCode === null) {
        fail('Failed outcomes require a failure code and no run');
      }
    }
    if (outcome.completedAt !== null) {
      const queued = Date.parse(outcome.queuedAt);
      const completed = Date.parse(outcome.completedAt);
      const queuedFraction = /\.(\d+)Z$/.exec(outcome.queuedAt)?.[1] ?? '';
      const completedFraction = /\.(\d+)Z$/.exec(outcome.completedAt)?.[1] ?? '';
      const precision = Math.max(queuedFraction.length, completedFraction.length);
      if (
        completed < queued ||
        (completed === queued &&
          completedFraction.padEnd(precision, '0') < queuedFraction.padEnd(precision, '0'))
      )
        fail('Completion time cannot precede the queued request');
    }
  });

export type AllocationJobOutcomeDTO = z.infer<typeof AllocationJobOutcomeSchema>;
