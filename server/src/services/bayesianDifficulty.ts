export interface DifficultyEvidence {
  average: number | null;
  count: number;
  priorMean: number;
}

export interface DifficultyEstimate {
  score: number;
  ratingCount: number;
}

const PRIOR_STRENGTH = 5;

function validateMean(value: number, label: string) {
  if (!Number.isFinite(value) || value < 1 || value > 5) {
    throw new Error(`${label} must be finite and between 1 and 5`);
  }
}

/** Caller resolves the curriculum/global mean; a raw course seed is not a fallback. */
export function estimateDifficulty({
  average,
  count,
  priorMean,
}: DifficultyEvidence): DifficultyEstimate {
  validateMean(priorMean, 'Prior mean');
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Rating count must be a non-negative safe integer');
  }
  if (average !== null) validateMean(average, 'Rating average');
  if (count > 0 && average === null) {
    throw new Error('Rated courses require an average');
  }
  if (count === 0) return { score: priorMean, ratingCount: 0 };
  // This equivalent weighted form avoids multiplying large counts by the mean.
  const evidenceWeight = count / (count + PRIOR_STRENGTH);
  return {
    score: priorMean + (average! - priorMean) * evidenceWeight,
    ratingCount: count,
  };
}
