import { AllocationUtilityPolicySchema } from '@iu-study-planner/shared';
import { readAllocationUtilityPolicy } from '../config/allocationUtility';

describe('allocation utility deployment policy', () => {
  it('uses explicit defaults and freezes the captured policy', () => {
    const policy = readAllocationUtilityPolicy({});
    expect(policy).toEqual({ difficultyFitWeight: 0.7, immediateUnlockWeight: 0.3 });
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it.each([
    ['1', '0'],
    ['0', '1'],
    ['0.5', '0.5'],
    ['0.123456789', '0.876543211'],
  ])('retains configured normalized weights %#', (difficulty, unlock) => {
    expect(
      readAllocationUtilityPolicy({
        ALLOCATION_DIFFICULTY_FIT_WEIGHT: difficulty,
        ALLOCATION_IMMEDIATE_UNLOCK_WEIGHT: unlock,
      }),
    ).toEqual({ difficultyFitWeight: Number(difficulty), immediateUnlockWeight: Number(unlock) });
  });

  it.each(['ALLOCATION_DIFFICULTY_FIT_WEIGHT', 'ALLOCATION_IMMEDIATE_UNLOCK_WEIGHT'])(
    'rejects invalid decimal syntax and range in %s',
    (name) => {
      for (const value of [
        '',
        ' ',
        ' 0.7',
        '0.7 ',
        '0.7\n',
        '-0',
        '-0.1',
        '1.1',
        'NaN',
        'Infinity',
        '1e-1',
        '0x1',
        '+1',
        '01',
        '.7',
        '0.',
        '9'.repeat(400),
      ]) {
        expect(() => readAllocationUtilityPolicy({ [name]: value })).toThrow(
          `${name} must be a decimal number from 0 to 1`,
        );
      }
    },
  );

  it.each([
    ['0', '0'],
    ['1', '1'],
    ['0.7', '0.2'],
    ['0.7', '0.300000001'],
  ])('rejects non-normalized sums %#', (difficulty, unlock) => {
    expect(() =>
      readAllocationUtilityPolicy({
        ALLOCATION_DIFFICULTY_FIT_WEIGHT: difficulty,
        ALLOCATION_IMMEDIATE_UNLOCK_WEIGHT: unlock,
      }),
    ).toThrow('Allocation utility weights must sum to one');
  });

  it('permits floating-point sum tolerance without changing supplied weights', () => {
    expect(
      readAllocationUtilityPolicy({
        ALLOCATION_DIFFICULTY_FIT_WEIGHT: '0.7',
        ALLOCATION_IMMEDIATE_UNLOCK_WEIGHT: '0.30000000005',
      }),
    ).toEqual({ difficultyFitWeight: 0.7, immediateUnlockWeight: 0.30000000005 });
  });

  it('uses defaults only for absent weights and validates partial overrides', () => {
    expect(readAllocationUtilityPolicy({ ALLOCATION_DIFFICULTY_FIT_WEIGHT: '0.70' })).toEqual({
      difficultyFitWeight: 0.7,
      immediateUnlockWeight: 0.3,
    });
    expect(() =>
      readAllocationUtilityPolicy({ ALLOCATION_IMMEDIATE_UNLOCK_WEIGHT: '0.5' }),
    ).toThrow('Allocation utility weights must sum to one');
  });

  it.each([
    { difficultyFitWeight: NaN },
    { difficultyFitWeight: Infinity },
    { difficultyFitWeight: -0.1 },
    { difficultyFitWeight: 1.1 },
    { immediateUnlockWeight: NaN },
    { immediateUnlockWeight: Infinity },
    { immediateUnlockWeight: -0.1 },
    { immediateUnlockWeight: 1.1 },
    { immediateUnlockWeight: '0.3' },
    { categoryWeight: 0.5 },
  ])('rejects malformed or overriding shared policy fields %#', (fields) => {
    expect(
      AllocationUtilityPolicySchema.safeParse({
        difficultyFitWeight: 0.7,
        immediateUnlockWeight: 0.3,
        ...fields,
      }).success,
    ).toBe(false);
  });

  it('requires both declared shared policy weights', () => {
    expect(AllocationUtilityPolicySchema.safeParse({ difficultyFitWeight: 1 }).success).toBe(false);
    expect(AllocationUtilityPolicySchema.safeParse({ immediateUnlockWeight: 1 }).success).toBe(
      false,
    );
  });
});
