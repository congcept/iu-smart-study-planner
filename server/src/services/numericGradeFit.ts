import { Prisma, type CourseCategory } from '@prisma/client';
import { calculateGradeSummary, type GradeCourse, type NumericGradeAttempt } from './gradeSummary';

export type NumericGradeFitCourse = GradeCourse & {
  category: CourseCategory;
  ratingDifficulty: number;
};

export interface NumericGradeHistoryEntry {
  courseId: string;
  score: number;
  credits: number;
  category: CourseCategory;
  ratingDifficulty: number;
}

export interface NumericGradeFitPolicy {
  weight: number;
  difficultyTolerance: number;
}

const Decimal = Prisma.Decimal.clone({ precision: 40 });

function validateDifficulty(difficulty: number) {
  if (!Number.isFinite(difficulty) || difficulty < 1 || difficulty > 5)
    throw new Error('Grade-fit difficulty must be between 1 and 5');
}

/** Highest numeric scores remain evidence even when their completion flag is removed. */
export function buildNumericGradeHistory(
  catalog: readonly NumericGradeFitCourse[],
  attempts: readonly NumericGradeAttempt[],
): NumericGradeHistoryEntry[] {
  const summary = calculateGradeSummary([...catalog], [...attempts]);
  const coursesById = new Map<string, NumericGradeFitCourse>();
  for (const course of catalog) {
    validateDifficulty(course.ratingDifficulty);
    const existing = coursesById.get(course.id);
    if (
      existing &&
      (existing.category !== course.category ||
        existing.ratingDifficulty !== course.ratingDifficulty)
    )
      throw new Error('Conflicting grade-fit metadata for the same course');
    coursesById.set(course.id, course);
  }
  return summary.courseScores.map(({ courseId, score, credits }) => {
    const course = coursesById.get(courseId)!;
    return {
      courseId,
      score,
      credits,
      category: course.category,
      ratingDifficulty: course.ratingDifficulty,
    };
  });
}

/** Bounded preference from recorded scores, not a grade conversion or pass/fail rule. */
export function calculateNumericGradeFit(
  candidate: Pick<NumericGradeFitCourse, 'category' | 'ratingDifficulty'>,
  history: readonly NumericGradeHistoryEntry[],
  policy: NumericGradeFitPolicy,
): number {
  if (!Number.isFinite(policy.weight) || policy.weight < 0 || policy.weight > 20)
    throw new Error('Grade-fit weight must be between 0 and 20');
  if (
    !Number.isFinite(policy.difficultyTolerance) ||
    policy.difficultyTolerance < 0 ||
    policy.difficultyTolerance > 4
  )
    throw new Error('Grade-fit difficulty tolerance must be between 0 and 4');
  validateDifficulty(candidate.ratingDifficulty);
  let weightedScores = 0;
  let credits = 0;
  for (const entry of history) {
    validateDifficulty(entry.ratingDifficulty);
    if (!Number.isFinite(entry.score) || entry.score < 0 || entry.score > 100)
      throw new Error('Grade-fit scores must be between 0 and 100');
    if (!Number.isFinite(entry.credits) || entry.credits <= 0)
      throw new Error('Grade-fit credits must be positive');
    // Compare the reported decimal estimates without binary subtraction drift
    // excluding a value exactly at the configured similarity boundary.
    const distance = new Decimal(candidate.ratingDifficulty.toString())
      .minus(entry.ratingDifficulty.toString())
      .abs();
    if (entry.category !== candidate.category || distance.greaterThan(policy.difficultyTolerance))
      continue;
    weightedScores += entry.score * entry.credits;
    credits += entry.credits;
  }
  if (credits === 0) return 0;
  return Math.min(policy.weight, Math.max(0, policy.weight * (weightedScores / credits / 100)));
}
