import { z } from 'zod';

import { AllocationUtilityPolicySchema } from './allocationUtility';
import { EligibleCohortDemandPolicySchema } from './eligibleCohortDemand';
import { SemesterAllocationRunSummaryV1Schema } from './semesterAllocationRunV1';

/** A public read-only simulation aggregate; configured targets are reference budgets. */
export const SemesterAllocationPreviewSchema = z
  .object({
    kind: z.literal('SIMULATION'),
    usage: z.literal('REFERENCE_ONLY'),
    consistencyBasis: z.literal('SINGLE_DATABASE_SNAPSHOT'),
    targetCreditsBasis: z.literal('CONFIGURED_REFERENCE_MAX_CREDITS'),
    persisted: z.literal(false),
    recommendationPolicy: EligibleCohortDemandPolicySchema,
    utilityPolicy: AllocationUtilityPolicySchema,
    result: SemesterAllocationRunSummaryV1Schema,
  })
  .strict()
  .refine(
    (preview) =>
      preview.result.totalTargetCredits ===
      preview.result.studentCount * preview.recommendationPolicy.maxCredits,
    'Semester preview targets must use the captured reference credit budget',
  );

export type SemesterAllocationPreviewDTO = z.infer<typeof SemesterAllocationPreviewSchema>;
