import type { Course, YearSemesterGroup } from '@/types';

/** Missing legacy metadata stays unknown, rather than reverting to an individual seed. */
function difficultyOrder(course: Course): number {
  const score = course.ratingDifficulty;
  return score !== undefined && Number.isFinite(score) && score >= 1 && score <= 5
    ? score
    : Number.POSITIVE_INFINITY;
}

export function recommendCurriculumCourses(
  groups: readonly YearSemesterGroup[],
  completedIds: ReadonlySet<string>,
  maxCredits: number,
  thesisMode: boolean,
): string[] {
  if (!Number.isFinite(maxCredits) || maxCredits <= 0) return [];
  // A global course can have several elective placements; consider its earliest placement once.
  const placements = new Map<string, { course: Course; year: number; semester: number }>();
  for (const group of [...groups].sort((a, b) => a.year - b.year || a.semester - b.semester)) {
    for (const course of group.courses) {
      if (!placements.has(course.id))
        placements.set(course.id, { course, year: group.year, semester: group.semester });
    }
  }
  const candidates = [...placements.values()]
    .filter(({ course, year, semester }) => {
      if (completedIds.has(course.id)) return false;
      if (!course.prerequisites.every(({ prerequisiteId }) => completedIds.has(prerequisiteId)))
        return false;
      return year !== 4 || semester !== 2 || thesisMode === (course.code === 'IT058IU');
    })
    .sort((a, b) => {
      const placement = a.year - b.year || a.semester - b.semester;
      if (placement) return placement;
      const difficulty = difficultyOrder(a.course) - difficultyOrder(b.course);
      // Two unknown estimates produce NaN; both retain the stable code/ID ordering.
      if (!Number.isNaN(difficulty) && difficulty !== 0) return difficulty;
      return a.course.code.localeCompare(b.course.code) || a.course.id.localeCompare(b.course.id);
    });

  let credits = 0;
  const ids: string[] = [];
  for (const { course } of candidates) {
    if (credits + course.credits > maxCredits) continue;
    ids.push(course.id);
    credits += course.credits;
    if (credits >= maxCredits) break;
  }
  return ids;
}
