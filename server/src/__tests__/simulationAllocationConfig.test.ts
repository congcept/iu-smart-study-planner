import { SimulationAllocationPolicySchema } from '@iu-study-planner/shared';
import { readSimulationAllocationPolicy } from '../config/simulationAllocation';

describe('simulation allocation deployment policy', () => {
  it('uses roadmap defaults and freezes the captured policy', () => {
    const policy = readSimulationAllocationPolicy({});
    expect(policy).toEqual({
      studentUtilityWeight: 0.6,
      resourceFitWeight: 0.25,
      fairnessWeight: 0.15,
      congestionThreshold: 0.85,
    });
    expect(Object.isFrozen(policy)).toBe(true);
  });
  it.each([
    ['1', '0', '0', '0'],
    ['0', '1', '0', '1'],
    ['0.5', '0.25', '0.25', '0.9'],
  ])(
    'retains configured normalized weights and threshold %#',
    (utility, resource, fairness, threshold) => {
      expect(
        readSimulationAllocationPolicy({
          ALLOCATION_STUDENT_UTILITY_WEIGHT: utility,
          ALLOCATION_RESOURCE_FIT_WEIGHT: resource,
          ALLOCATION_FAIRNESS_WEIGHT: fairness,
          ALLOCATION_CONGESTION_THRESHOLD: threshold,
        }),
      ).toEqual({
        studentUtilityWeight: Number(utility),
        resourceFitWeight: Number(resource),
        fairnessWeight: Number(fairness),
        congestionThreshold: Number(threshold),
      });
    },
  );
  it.each(['', ' ', '-1', '1.1', 'NaN', 'Infinity', '1e-1', '0x1', '+1', '01', '.6'])(
    'rejects noncanonical or out-of-range deployment numbers %j',
    (value) => {
      expect(() =>
        readSimulationAllocationPolicy({ ALLOCATION_CONGESTION_THRESHOLD: value }),
      ).toThrow();
    },
  );
  it.each([
    'ALLOCATION_STUDENT_UTILITY_WEIGHT',
    'ALLOCATION_RESOURCE_FIT_WEIGHT',
    'ALLOCATION_FAIRNESS_WEIGHT',
  ])('validates each configured weight %s', (key) => {
    expect(() => readSimulationAllocationPolicy({ [key]: '-0.1' })).toThrow();
  });
  it.each([
    {
      ALLOCATION_STUDENT_UTILITY_WEIGHT: '0',
      ALLOCATION_RESOURCE_FIT_WEIGHT: '0',
      ALLOCATION_FAIRNESS_WEIGHT: '0',
    },
    {
      ALLOCATION_STUDENT_UTILITY_WEIGHT: '1',
      ALLOCATION_RESOURCE_FIT_WEIGHT: '1',
      ALLOCATION_FAIRNESS_WEIGHT: '0',
    },
  ])('rejects non-normalized weight sums %#', (env) => {
    expect(() => readSimulationAllocationPolicy(env)).toThrow();
  });
  it.each([
    { studentUtilityWeight: NaN },
    { resourceFitWeight: Infinity },
    { fairnessWeight: -0.1 },
    { congestionThreshold: 1.1 },
    { priorityByClick: true },
  ])('rejects malformed or overriding policy fields %#', (fields) => {
    expect(
      SimulationAllocationPolicySchema.safeParse({
        ...readSimulationAllocationPolicy({}),
        ...fields,
      }).success,
    ).toBe(false);
  });
});
