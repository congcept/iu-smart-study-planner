import {
  SimulationAllocationPolicySchema,
  type SimulationAllocationPolicyDTO,
} from '@iu-study-planner/shared';

/** Capture explicit simulation policy at startup; invalid configuration fails closed. */
export function readSimulationAllocationPolicy(
  env: NodeJS.ProcessEnv,
): SimulationAllocationPolicyDTO {
  const number = (name: string, fallback: string) => {
    const value = env[name] ?? fallback;
    if (!/^(0|[1-9]\d*)(?:\.\d+)?$/.test(value) || Number(value) < 0 || Number(value) > 1)
      throw new Error(`${name} must be a decimal number from 0 to 1`);
    return Number(value);
  };
  const result = SimulationAllocationPolicySchema.safeParse({
    studentUtilityWeight: number('ALLOCATION_STUDENT_UTILITY_WEIGHT', '0.60'),
    resourceFitWeight: number('ALLOCATION_RESOURCE_FIT_WEIGHT', '0.25'),
    fairnessWeight: number('ALLOCATION_FAIRNESS_WEIGHT', '0.15'),
    congestionThreshold: number('ALLOCATION_CONGESTION_THRESHOLD', '0.85'),
  });
  if (!result.success) throw new Error('Simulation allocation weights must sum to one');
  return Object.freeze(result.data);
}
