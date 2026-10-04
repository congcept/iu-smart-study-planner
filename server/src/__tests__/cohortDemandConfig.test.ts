import { readCohortDemandPolicy } from '../config/cohortDemand';

describe('cohort demand reference recommendation budgets', () => {
  it('uses the existing reference recommender defaults with a frozen applied policy', () => {
    const policy = readCohortDemandPolicy({});
    expect(policy).toEqual({ maxCredits: 18, maxDifficulty: 3.5 });
    expect(Object.isFrozen(policy)).toBe(true);
  });
  it.each([
    ['1', '1', 1, 1],
    ['30', '5', 30, 5],
    ['12', '3.25', 12, 3.25],
  ])(
    'retains configured budgets %s credits / %s difficulty',
    (credits, difficulty, expectedCredits, expectedDifficulty) => {
      expect(
        readCohortDemandPolicy({
          COHORT_DEMAND_MAX_CREDITS: String(credits),
          COHORT_DEMAND_MAX_DIFFICULTY: String(difficulty),
        }),
      ).toEqual({ maxCredits: expectedCredits, maxDifficulty: expectedDifficulty });
    },
  );
  it.each(['', ' ', '0', '-1', '31', '1.5', 'Infinity', 'NaN', '1e1', '0x10', '+1', '01'])(
    'rejects an invalid credit budget %j',
    (value) => {
      expect(() => readCohortDemandPolicy({ COHORT_DEMAND_MAX_CREDITS: value })).toThrow(
        'COHORT_DEMAND_MAX_CREDITS must be an integer from 1 to 30',
      );
    },
  );
  it.each(['', ' ', '0', '0.99', '-1', '5.01', 'Infinity', 'NaN', '1e0', '0x3', '+1', '01'])(
    'rejects an invalid difficulty budget %j',
    (value) => {
      expect(() => readCohortDemandPolicy({ COHORT_DEMAND_MAX_DIFFICULTY: value })).toThrow(
        'COHORT_DEMAND_MAX_DIFFICULTY must be a number from 1 to 5',
      );
    },
  );
});
