import type { CourseStatus } from '@prisma/client';
import type {
  CurriculumDetailDTO,
  CurriculumRecommendationsDTO,
  Semester,
} from '@iu-study-planner/shared';
import { calculateGradeSummary, type NumericGradeAttempt } from './gradeSummary';
import { isCourseInGpaPath } from './gpaPath';
import WorkloadBalancer from './workloadBalancer';

export class RecommendationContextError extends Error {
  readonly status = 404;
}

/** Context placements, edges and grades are supplied from a single database snapshot. */
export function recommendCurriculumCourses(
  context: CurriculumDetailDTO,
  records: readonly { courseId: string; status: CourseStatus }[],
  attempts: readonly NumericGradeAttempt[],
  constraints: { semester?: Semester; maxCredits: number; maxDifficulty: number },
): CurriculumRecommendationsDTO {
  const memberIds = new Set(context.courses.map(({ id }) => id));
  const gpaPath = context.isGpaPath
    ? calculateGradeSummary(
        context.courses,
        attempts.filter(({ courseId }) => memberIds.has(courseId)),
      ).gpaPath
    : null;
  const completedIds = new Set(
    records
      .filter(({ courseId, status }) => memberIds.has(courseId) && status === 'COMPLETED')
      .map(({ courseId }) => courseId),
  );
  const takenIds = new Set(
    records
      .filter(({ status }) => status === 'COMPLETED' || status === 'IN_PROGRESS')
      .map(({ courseId }) => courseId),
  );
  const placed = context.courses
    .map((course) => ({
      ...course,
      placements: course.placements.filter((placement) =>
        isCourseInGpaPath({ code: course.code, ...placement }, gpaPath),
      ),
    }))
    .filter(({ placements }) => placements.length > 0);
  const eligibleIds = new Set(placed.map(({ id }) => id));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const edge of context.prerequisites) {
    parents.set(edge.courseId, [...(parents.get(edge.courseId) ?? []), edge.prerequisiteId]);
    if (eligibleIds.has(edge.courseId)) {
      children.set(edge.prerequisiteId, [
        ...(children.get(edge.prerequisiteId) ?? []),
        edge.courseId,
      ]);
    }
  }
  const available = placed
    .map((course) => ({
      ...course,
      isPrerequisiteFor: children.get(course.id) ?? [],
    }))
    .filter(
      (course) =>
        !takenIds.has(course.id) &&
        (parents.get(course.id) ?? []).every((parent) => completedIds.has(parent)),
    );
  const filtered = constraints.semester
    ? available.filter(({ semesterOffered }) => semesterOffered.includes(constraints.semester!))
    : available;
  const selected = new WorkloadBalancer().calculateRecommendations({
    availableCourses: filtered,
    maxCredits: constraints.maxCredits,
    maxDifficulty: constraints.maxDifficulty,
    // Requirement categories are not yet verified per curriculum; no legacy grade fit is inferred.
    numericHistory: [],
  });
  const courses = selected.map(({ isPrerequisiteFor: _children, ...course }) => course);
  return {
    courses,
    stats: {
      gpaPath,
      totalAvailable: available.length,
      filteredCount: filtered.length,
      recommendedCount: courses.length,
      totalRecommendedCredits: courses.reduce((sum, course) => sum + course.credits, 0),
      averageDifficulty:
        courses.length === 0
          ? 0
          : courses.reduce((sum, course) => sum + course.ratingDifficulty, 0) / courses.length,
    },
    scope: {
      curriculumId: context.id,
      usage: context.usage,
      categoryPersonalizationAvailable: false,
      ratingPrior: context.ratingPrior,
    },
  };
}
