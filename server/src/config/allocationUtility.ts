import {
  AllocationUtilityPolicySchema,
  type AllocationUtilityPolicyDTO,
} from '@iu-study-planner/shared';

/** Capture explicit utility policy at startup; invalid configuration fails closed. */
export function readAllocationUtilityPolicy(env: NodeJS.ProcessEnv): AllocationUtilityPolicyDTO {
  const weight = (name: string, fallback: string) => {
    const value = env[name] ?? fallback;
    const parsed = Number(value);
    if (
      value.trim() !== value ||
      !/^(0|[1-9]\d*)(?:\.\d+)?$/.test(value) ||
      !Number.isFinite(parsed) ||
      parsed < 0 ||
      parsed > 1
    )
      throw new Error(`${name} must be a decimal number from 0 to 1`);
    return parsed;
  };
  const result = AllocationUtilityPolicySchema.safeParse({
    difficultyFitWeight: weight('ALLOCATION_DIFFICULTY_FIT_WEIGHT', '0.70'),
    immediateUnlockWeight: weight('ALLOCATION_IMMEDIATE_UNLOCK_WEIGHT', '0.30'),
  });
  if (!result.success) throw new Error('Allocation utility weights must sum to one');
  return Object.freeze(result.data);
}
