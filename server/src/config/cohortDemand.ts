import {
  EligibleCohortDemandPolicySchema,
  type EligibleCohortDemandPolicyDTO,
} from '@iu-study-planner/shared';

/** Reference recommendation budgets, applied consistently to every simulated cohort member. */
export function readCohortDemandPolicy(env: NodeJS.ProcessEnv): EligibleCohortDemandPolicyDTO {
  const creditValue = env.COHORT_DEMAND_MAX_CREDITS ?? '18';
  if (!/^(0|[1-9]\d*)$/.test(creditValue) || Number(creditValue) < 1 || Number(creditValue) > 30)
    throw new Error('COHORT_DEMAND_MAX_CREDITS must be an integer from 1 to 30');
  const difficultyValue = env.COHORT_DEMAND_MAX_DIFFICULTY ?? '3.5';
  if (
    !/^(0|[1-9]\d*)(?:\.\d+)?$/.test(difficultyValue) ||
    Number(difficultyValue) < 1 ||
    Number(difficultyValue) > 5
  )
    throw new Error('COHORT_DEMAND_MAX_DIFFICULTY must be a number from 1 to 5');
  return Object.freeze(
    EligibleCohortDemandPolicySchema.parse({
      maxCredits: Number(creditValue),
      maxDifficulty: Number(difficultyValue),
    }),
  );
}
