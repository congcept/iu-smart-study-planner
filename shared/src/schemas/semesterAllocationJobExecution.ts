import { z } from 'zod';
import { CreateSemesterAllocationJobSchema } from './semesterAllocationJob';
import { SemesterAllocationJobOutcomeSchema } from './semesterAllocationJobOutcome';

/** The selected path ID is the execution retry identity; no replacement input or key. */
export const ExecuteSemesterAllocationJobSchema = CreateSemesterAllocationJobSchema.omit({
  requestId: true,
});

export const SemesterAllocationJobExecutionSchema = z
  .object({ processed: z.boolean(), outcome: SemesterAllocationJobOutcomeSchema })
  .strict()
  .refine((result) => !result.processed || result.outcome.status !== 'PENDING', {
    message: 'A processed job requires a committed terminal outcome',
  });

export type ExecuteSemesterAllocationJobDTO = z.infer<typeof ExecuteSemesterAllocationJobSchema>;
export type SemesterAllocationJobExecutionDTO = z.infer<
  typeof SemesterAllocationJobExecutionSchema
>;
