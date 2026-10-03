import { estimateDifficulty } from '../services/bayesianDifficulty';

describe('Bayesian course difficulty', () => {
  it('uses the shared mean exactly at zero ratings', () => {
    expect(estimateDifficulty({ average: null, count: 0, priorMean: 3.2 })).toEqual({
      score: 3.2,
      ratingCount: 0,
    });
    expect(estimateDifficulty({ average: 5, count: 0, priorMean: 2.5 })).toEqual({
      score: 2.5,
      ratingCount: 0,
    });
  });
  it('shrinks one vote using five prior observations', () => {
    expect(estimateDifficulty({ average: 5, count: 1, priorMean: 3 }).score).toBeCloseTo(
      20 / 6,
      14,
    );
    expect(estimateDifficulty({ average: 1, count: 1, priorMean: 3 }).score).toBeCloseTo(
      16 / 6,
      14,
    );
  });
  it('matches the hand-computed fifty-vote result and surfaces confidence', () => {
    const result = estimateDifficulty({ average: 4.4, count: 50, priorMean: 2.8 });
    expect(result.score).toBeCloseTo(234 / 55, 14);
    expect(result.ratingCount).toBe(50);
  });
  it('stays within the prior and observed mean, including scale boundaries', () => {
    expect(estimateDifficulty({ average: 1, count: 50, priorMean: 5 }).score).toBeCloseTo(75 / 55);
    expect(estimateDifficulty({ average: 5, count: 50, priorMean: 1 }).score).toBeCloseTo(255 / 55);
    expect(estimateDifficulty({ average: 5, count: 1, priorMean: 5 }).score).toBe(5);
    expect(estimateDifficulty({ average: 1, count: 1, priorMean: 1 }).score).toBe(1);
  });
  it('moves toward the observed mean as evidence increases', () => {
    const scores = [0, 1, 5, 50].map(
      (count) => estimateDifficulty({ average: 4.5, count, priorMean: 2 }).score,
    );
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    expect(scores[3]).toBeLessThan(4.5);
  });
  it('retains precision rather than rounding the scoring input', () => {
    expect(estimateDifficulty({ average: 5, count: 1, priorMean: 3 }).score).not.toBe(3.33);
  });
  it('accepts a large safe count without overflowing', () => {
    const result = estimateDifficulty({ average: 4, count: Number.MAX_SAFE_INTEGER, priorMean: 3 });
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBeCloseTo(4);
  });
  it('does not mutate its input', () => {
    const evidence = Object.freeze({ average: 4, count: 1, priorMean: 3 });
    estimateDifficulty(evidence);
    expect(evidence).toEqual({ average: 4, count: 1, priorMean: 3 });
  });
  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid rating count %s',
    (count) => {
      expect(() => estimateDifficulty({ average: 3, count, priorMean: 3 })).toThrow('Rating count');
    },
  );
  it.each([0, 6, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects invalid prior mean %s',
    (priorMean) => {
      expect(() => estimateDifficulty({ average: null, count: 0, priorMean })).toThrow(
        'Prior mean',
      );
    },
  );
  it.each([0, 6, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects invalid observed mean %s',
    (average) => {
      expect(() => estimateDifficulty({ average, count: 1, priorMean: 3 })).toThrow(
        'Rating average',
      );
    },
  );
  it('rejects positive evidence with no average', () => {
    expect(() => estimateDifficulty({ average: null, count: 1, priorMean: 3 })).toThrow(
      'require an average',
    );
  });
});
