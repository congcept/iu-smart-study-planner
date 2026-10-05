import { z } from 'zod';

const weight = z.number().finite().min(0).max(1);

export const AllocationUtilityPolicySchema = z
  .object({
    difficultyFitWeight: weight,
    immediateUnlockWeight: weight,
  })
  .strict()
  .refine(
    (policy) => Math.abs(policy.difficultyFitWeight + policy.immediateUnlockWeight - 1) <= 1e-10,
    'Allocation utility weights must sum to one',
  );

export type AllocationUtilityPolicyDTO = z.infer<typeof AllocationUtilityPolicySchema>;
