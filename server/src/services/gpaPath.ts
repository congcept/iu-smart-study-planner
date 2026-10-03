import type { GpaPath } from '@iu-study-planner/shared';

type PlacedCourse = {
  code: string;
  academicYear: number | null;
  academicSemester: number | null;
};

/** Current CS placement is the earliest occurrence of a globally shared course. */
export function isCourseInGpaPath(course: PlacedCourse, path: GpaPath | null): boolean {
  if (path === null || course.academicYear !== 4 || course.academicSemester !== 2) return true;
  return path === 'THESIS' ? course.code === 'IT058IU' : course.code !== 'IT058IU';
}
