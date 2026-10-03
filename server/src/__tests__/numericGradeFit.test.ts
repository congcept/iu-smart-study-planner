import { CourseCategory } from '@prisma/client';
import {
  buildNumericGradeHistory,
  calculateNumericGradeFit,
  type NumericGradeFitCourse,
} from '../services/numericGradeFit';

const policy = { weight: 2, difficultyTolerance: 0.5 };
const candidate = { category: CourseCategory.CORE, ratingDifficulty: 2 };
const course = (
  id: string,
  credits = 3,
  category: CourseCategory = 'CORE',
  difficulty = 2,
): NumericGradeFitCourse => ({
  id,
  code: id,
  credits,
  category,
  ratingDifficulty: difficulty,
});

describe('numeric recommendation grade fit', () => {
  it('uses highest retakes once per course and weights actual course credits', () => {
    const catalog = [course('A'), course('B', 4)];
    const attempts = [
      { courseId: 'A', score: 90 },
      { courseId: 'A', score: 20 },
      { courseId: 'B', score: 60 },
    ];
    const history = buildNumericGradeHistory(catalog, attempts);
    expect(history).toHaveLength(2);
    expect(calculateNumericGradeFit(candidate, history, policy)).toBeCloseTo(1.457142857142857, 12);
    expect(
      calculateNumericGradeFit(
        candidate,
        buildNumericGradeHistory(catalog, attempts.reverse()),
        policy,
      ),
    ).toBeCloseTo(1.457142857142857, 12);
  });
  it('keeps a real zero in the credit-weighted mean', () => {
    const history = buildNumericGradeHistory(
      [course('A'), course('B', 4)],
      [
        { courseId: 'A', score: 90 },
        { courseId: 'B', score: 0 },
      ],
    );
    expect(history).toHaveLength(2);
    expect(calculateNumericGradeFit(candidate, history, policy)).toBeCloseTo(
      0.7714285714285715,
      12,
    );
  });
  it('excludes physical training, zero-credit and missing numeric grades', () => {
    const history = buildNumericGradeHistory(
      [course('PT001IU'), course('PT002IU'), course('ZERO', 0), course('MISSING')],
      [
        { courseId: 'PT001IU', score: 100 },
        { courseId: 'PT002IU', score: 100 },
        { courseId: 'ZERO', score: 100 },
        { courseId: 'MISSING', score: null },
      ],
    );
    expect(history).toEqual([]);
    expect(calculateNumericGradeFit(candidate, history, policy)).toBe(0);
  });
  it('matches the exact difficulty boundary and category, excluding other evidence', () => {
    const history = buildNumericGradeHistory(
      [
        course('EDGE', 3, 'CORE', 2.5),
        course('OUTSIDE', 4, 'CORE', 2.500001),
        course('OTHER', 4, 'ELECTIVE', 2),
      ],
      [
        { courseId: 'EDGE', score: 80 },
        { courseId: 'OUTSIDE', score: 0 },
        { courseId: 'OTHER', score: 0 },
      ],
    );
    expect(calculateNumericGradeFit(candidate, history, policy)).toBeCloseTo(1.6, 12);
  });
  it('includes a half-point decimal distance despite binary subtraction drift', () => {
    const history = buildNumericGradeHistory(
      [course('A', 3, 'CORE', 1.7)],
      [{ courseId: 'A', score: 90 }],
    );
    expect(
      calculateNumericGradeFit({ ...candidate, ratingDifficulty: 2.2 }, history, policy),
    ).toBeCloseTo(1.8, 12);
  });
  it('does not mutate input arrays or the underlying seed metadata', () => {
    const catalog = [course('A')];
    const attempts = [{ courseId: 'A', score: 90 }];
    const before = JSON.stringify({ catalog, attempts });
    const history = buildNumericGradeHistory(catalog, attempts);
    calculateNumericGradeFit(candidate, history, policy);
    expect(JSON.stringify({ catalog, attempts })).toBe(before);
  });
  it('allows policy weight zero and never exceeds the configured bonus', () => {
    const history = buildNumericGradeHistory([course('A')], [{ courseId: 'A', score: 100 }]);
    expect(calculateNumericGradeFit(candidate, history, { ...policy, weight: 0 })).toBe(0);
    expect(calculateNumericGradeFit(candidate, history, { ...policy, weight: 20 })).toBe(20);
  });
  it('requires an exact difficulty match when tolerance is zero', () => {
    const history = buildNumericGradeHistory(
      [course('A', 3, 'CORE', 2.000001)],
      [{ courseId: 'A', score: 100 }],
    );
    expect(
      calculateNumericGradeFit(candidate, history, { ...policy, difficultyTolerance: 0 }),
    ).toBe(0);
  });
  it.each([-1, 20.000001, NaN, Infinity])('rejects invalid weights %s', (weight) => {
    expect(() => calculateNumericGradeFit(candidate, [], { ...policy, weight })).toThrow();
  });
  it.each([-1, 4.000001, NaN, Infinity])(
    'rejects invalid difficulty tolerances %s',
    (difficultyTolerance) => {
      expect(() =>
        calculateNumericGradeFit(candidate, [], { ...policy, difficultyTolerance }),
      ).toThrow();
    },
  );
  it('rejects invalid numeric scores and dangling course history', () => {
    expect(() =>
      buildNumericGradeHistory([course('A')], [{ courseId: 'A', score: 101 }]),
    ).toThrow();
    expect(() =>
      buildNumericGradeHistory([course('A')], [{ courseId: 'UNKNOWN', score: 90 }]),
    ).toThrow();
  });
});

describe('numeric grade-fit deployment policy', () => {
  const keys = [
    'RECOMMENDATION_GRADE_FIT_WEIGHT',
    'RECOMMENDATION_GRADE_DIFFICULTY_TOLERANCE',
  ] as const;
  const original = keys.map((key) => process.env[key]);
  afterEach(() =>
    keys.forEach((key, index) => {
      if (original[index] === undefined) delete process.env[key];
      else process.env[key] = original[index];
    }),
  );
  function readConfig() {
    let result: (typeof import('../config'))['default'] | undefined;
    jest.isolateModules(() => {
      result = jest.requireActual<typeof import('../config')>('../config').default;
    });
    return result!;
  }
  it('defaults to a bounded two-point bonus and half-point difficulty band', () => {
    keys.forEach((key) => {
      process.env[key] = '';
    });
    expect(readConfig()).toMatchObject({
      recommendationGradeFitWeight: 2,
      recommendationGradeDifficultyTolerance: 0.5,
    });
  });
  it('accepts an explicit disabled weight and exact-only match', () => {
    keys.forEach((key) => {
      process.env[key] = '0';
    });
    expect(readConfig()).toMatchObject({
      recommendationGradeFitWeight: 0,
      recommendationGradeDifficultyTolerance: 0,
    });
  });
  it.each([
    ['RECOMMENDATION_GRADE_FIT_WEIGHT', '-1'],
    ['RECOMMENDATION_GRADE_FIT_WEIGHT', '20.000001'],
    ['RECOMMENDATION_GRADE_FIT_WEIGHT', 'NaN'],
    ['RECOMMENDATION_GRADE_DIFFICULTY_TOLERANCE', '-1'],
    ['RECOMMENDATION_GRADE_DIFFICULTY_TOLERANCE', '4.000001'],
    ['RECOMMENDATION_GRADE_DIFFICULTY_TOLERANCE', 'Infinity'],
  ])('rejects invalid %s=%s', (key, value) => {
    keys.forEach((key) => {
      process.env[key] = '0';
    });
    process.env[key] = value;
    expect(readConfig).toThrow(key);
  });
});
