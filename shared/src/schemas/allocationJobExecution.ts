import { z } from 'zod';
import { CreateAllocationJobSchema } from './allocationJob';
import { AllocationJobOutcomeSchema } from './allocationJobOutcome';

/** The selected job ID is the retry key; execution accepts no replacement inputs. */
export const ExecuteAllocationJobSchema = CreateAllocationJobSchema.omit({ requestId: true });

export const AllocationJobExecutionSchema = z
  .object({
    processed: z.boolean(),
    outcome: AllocationJobOutcomeSchema,
  })
  .strict()
  .refine((result) => !result.processed || result.outcome.status !== 'PENDING', {
    message: 'A processed job requires a committed terminal outcome',
  });

export type ExecuteAllocationJobDTO = z.infer<typeof ExecuteAllocationJobSchema>;
export type AllocationJobExecutionDTO = z.infer<typeof AllocationJobExecutionSchema>;
