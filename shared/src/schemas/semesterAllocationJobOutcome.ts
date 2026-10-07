import { z } from 'zod';
import { SemesterAllocationJobSchema } from './semesterAllocationJob';

/** PENDING means no terminal outcome committed in this read snapshot. */
export const SemesterAllocationJobOutcomeSchema = z
  .object({
    jobId: SemesterAllocationJobSchema.shape.id,
    kind: z.literal('SIMULATION'),
    usage: z.literal('REFERENCE_ONLY'),
    model: z.literal('SEMESTER_CREDIT_BUDGET_V1'),
    scope: SemesterAllocationJobSchema.shape.scope,
    queuedAt: z.string().datetime(),
    executionModel: z.literal('ATOMIC_SINGLE_JOB'),
    status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']),
    runId: SemesterAllocationJobSchema.shape.id.nullable(),
    completedAt: z.string().datetime().nullable(),
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
          fail('Successful outcomes require a saved result and no failure');
      } else if (outcome.runId !== null || outcome.failureCode === null) {
        fail('Failed outcomes require a failure code and no saved result');
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

export type SemesterAllocationJobOutcomeDTO = z.infer<typeof SemesterAllocationJobOutcomeSchema>;
