import { Prisma } from '@prisma/client';
import type {
  Semester,
  StudentGradesDTO,
  StudentSemesterGradesDTO,
} from '@iu-study-planner/shared';

export interface GradeCourse {
  id: string;
  code: string;
  credits: number;
}

export interface NumericGradeAttempt {
  courseId: string;
  score: number | null;
}

export interface DatedNumericGradeAttempt extends NumericGradeAttempt {
  semester: Semester | null;
  year: number | null;
}

export type GradeSummary = StudentGradesDTO['summary'];
export type SemesterGradeSummary = StudentSemesterGradesDTO;

const Decimal = Prisma.Decimal.clone({ precision: 400 });
const EXCLUDED_CODES = new Set(['PT001IU', 'PT002IU']);
/** Declaration order of the shared/prisma Semester enum; not an academic-calendar order. */
const SEMESTERS: readonly Semester[] = ['FALL', 'SPRING', 'SUMMER'];

function isGpaEligible(course: GradeCourse): boolean {
  return course.credits > 0 && !EXCLUDED_CODES.has(course.code);
}

/** Null means ungraded; anything else must be a finite 0–100 numeric score. */
function gpaScore(score: number | null): number | null {
  if (score === null) return null;
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('Grade scores must be finite and between 0 and 100');
  }
  return score;
}

/** Rejects inconsistent course metadata and returns one entry per course identity. */
function readCoursesById(courses: GradeCourse[]): Map<string, GradeCourse> {
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
  return coursesById;
}

/** Numeric scores stay on their original 0–100 scale; no letter-grade conversion. */
export function calculateGradeSummary(
  courses: GradeCourse[],
  attempts: NumericGradeAttempt[],
): GradeSummary {
  const coursesById = readCoursesById(courses);

  const highestScores = new Map<string, number>();
  for (const attempt of attempts) {
    const course = coursesById.get(attempt.courseId);
    if (!course) throw new Error('Grade attempt refers to an unknown course');
    const score = gpaScore(attempt.score);
    if (score === null || !isGpaEligible(course)) continue;
    const highest = highestScores.get(attempt.courseId);
    if (highest === undefined || score > highest) highestScores.set(attempt.courseId, score);
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

/**
 * Per-term GPA over explicitly recorded attempt year/semester metadata only. Each term
 * keeps its own highest score per course, so one course can count once in every term it
 * was attempted in, while the lifetime summary stays unchanged. Attempts missing either
 * metadata are counted, never guessed from creation time or curriculum placement.
 */
export function calculateSemesterGrades(
  courses: GradeCourse[],
  attempts: DatedNumericGradeAttempt[],
): SemesterGradeSummary {
  const coursesById = readCoursesById(courses);
  const byYear = new Map<number, Map<Semester, DatedNumericGradeAttempt[]>>();
  let undatedAttemptCount = 0;

  for (const attempt of attempts) {
    const course = coursesById.get(attempt.courseId);
    if (!course) throw new Error('Grade attempt refers to an unknown course');
    const score = gpaScore(attempt.score);
    if (score === null || !isGpaEligible(course)) continue;
    if (attempt.year === null || attempt.semester === null) {
      undatedAttemptCount += 1;
      continue;
    }
    const bySemester = byYear.get(attempt.year) ?? new Map<Semester, DatedNumericGradeAttempt[]>();
    const termAttempts = bySemester.get(attempt.semester) ?? [];
    termAttempts.push(attempt);
    bySemester.set(attempt.semester, termAttempts);
    byYear.set(attempt.year, bySemester);
  }

  const terms: SemesterGradeSummary['terms'] = [];
  for (const year of [...byYear.keys()].sort((left, right) => left - right)) {
    const bySemester = byYear.get(year)!;
    for (const semester of SEMESTERS) {
      const termAttempts = bySemester.get(semester);
      if (!termAttempts) continue;
      const summary = calculateGradeSummary(courses, termAttempts);
      if (summary.gpa100 === null) continue;
      terms.push({
        year,
        semester,
        gpa100: summary.gpa100,
        gradedCredits: summary.gradedCredits,
        gradedCourseCount: summary.gradedCourseCount,
      });
    }
  }
  return { terms, undatedAttemptCount };
}
