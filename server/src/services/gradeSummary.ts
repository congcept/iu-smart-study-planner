import { Prisma } from '@prisma/client';
import type { StudentGradesDTO } from '@iu-study-planner/shared';

export interface GradeCourse {
  id: string;
  code: string;
  credits: number;
}

export interface NumericGradeAttempt {
  courseId: string;
  score: number | null;
}

export type GradeSummary = StudentGradesDTO['summary'];

const Decimal = Prisma.Decimal.clone({ precision: 40 });
const EXCLUDED_CODES = new Set(['PT001IU', 'PT002IU']);

/** Numeric scores stay on their original 0–100 scale; no letter-grade conversion. */
export function calculateGradeSummary(
  courses: GradeCourse[],
  attempts: NumericGradeAttempt[],
): GradeSummary {
  const coursesById = new Map<string, GradeCourse>();
  for (const course of courses) {
    if (!Number.isFinite(course.credits) || course.credits < 0) {
      throw new Error('Course credits must be finite and non-negative');
    }
    const existing = coursesById.get(course.id);
    if (existing && (existing.code !== course.code || existing.credits !== course.credits)) {
      throw new Error('Conflicting metadata for the same course');
    }
    coursesById.set(course.id, course);
  }

  const highestScores = new Map<string, number>();
  for (const attempt of attempts) {
    const course = coursesById.get(attempt.courseId);
    if (!course) throw new Error('Grade attempt refers to an unknown course');
    if (attempt.score === null) continue;
    if (!Number.isFinite(attempt.score) || attempt.score < 0 || attempt.score > 100) {
      throw new Error('Grade scores must be finite and between 0 and 100');
    }
    if (EXCLUDED_CODES.has(course.code) || course.credits === 0) continue;
    const highest = highestScores.get(attempt.courseId);
    if (highest === undefined || attempt.score > highest) {
      highestScores.set(attempt.courseId, attempt.score);
    }
  }

  const courseScores = [...highestScores.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([courseId, score]) => ({ courseId, score, credits: coursesById.get(courseId)!.credits }));
  const gradedCredits = courseScores.reduce((sum, course) => sum + course.credits, 0);
  // Compare decimal scores exactly at 70; binary floating-point sums can put an
  // exact boundary such as (0.16 + 93.28 * 3) / 4 just above 70.
  const weightedScores = courseScores.reduce(
    (sum, course) => sum.plus(new Decimal(course.score.toString()).times(course.credits)),
    new Decimal(0),
  );
  const gpa100 = gradedCredits > 0 ? weightedScores.dividedBy(gradedCredits).toNumber() : null;
  return {
    gpa100,
    gpaPath:
      gpa100 === null
        ? null
        : weightedScores.greaterThan(new Decimal(70).times(gradedCredits))
          ? 'THESIS'
          : 'ALTERNATIVE',
    gradedCredits,
    gradedCourseCount: courseScores.length,
    courseScores,
  };
}
