import { Prisma } from '@prisma/client';
import type { StudentGradeCoursesDTO, StudentGradesDTO } from '@iu-study-planner/shared';
import { prisma } from '../db';
import { GradeAttemptError } from './gradeAttempts';
import { calculateGradeSummary } from './gradeSummary';

/** Full immutable history is retained; summary and coverage follow current membership. */
export async function readStudentGradeSnapshot(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<StudentGradesDTO> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { curriculumId: true, curriculum: { select: { isGpaPath: true } } },
  });
  if (!user) throw new GradeAttemptError('User not found', 404);
  const attempts = await tx.gradeAttempt.findMany({
    where: { userId },
    include: { course: { select: { id: true, code: true, name: true, credits: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  const memberIds = user.curriculumId
    ? new Set(
        (
          await tx.curriculumCourse.findMany({
            where: { curriculumId: user.curriculumId },
            select: { courseId: true },
          })
        ).map(({ courseId }) => courseId),
      )
    : null;
  const eligibleAttempts = memberIds
    ? attempts.filter(({ courseId }) => memberIds.has(courseId))
    : attempts;
  const completed = await tx.studentRecord.findMany({
    where: {
      userId,
      status: 'COMPLETED',
      ...(memberIds ? { courseId: { in: [...memberIds] } } : {}),
    },
    select: { courseId: true, course: { select: { code: true, credits: true } } },
    orderBy: { courseId: 'asc' },
  });
  const gradedIds = new Set(eligibleAttempts.map(({ courseId }) => courseId));
  const summary = calculateGradeSummary(
    eligibleAttempts.map(({ course }) => course),
    eligibleAttempts,
  );
  // A high score cannot create a thesis/alternative eligibility rule in a nonfork curriculum.
  if (user.curriculum && !user.curriculum.isGpaPath) summary.gpaPath = null;
  return {
    scope: {
      userId,
      curriculumId: user.curriculumId,
      isGpaPath: user.curriculum?.isGpaPath ?? true,
    },
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      requestId: attempt.requestId,
      courseId: attempt.courseId,
      score: attempt.score,
      semester: attempt.semester,
      year: attempt.year,
      createdAt: attempt.createdAt.toISOString(),
      course: attempt.course,
    })),
    summary,
    completedCoursesWithoutNumericGrades: completed
      .filter(
        ({ courseId, course }) =>
          course.credits > 0 &&
          !['PT001IU', 'PT002IU'].includes(course.code) &&
          !gradedIds.has(courseId),
      )
      .map(({ courseId }) => courseId),
  };
}

export function readStudentGrades(userId: string): Promise<StudentGradesDTO> {
  return prisma.$transaction((tx) => readStudentGradeSnapshot(tx, userId), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

/** Match the membership/placement gate for new numeric attempts; no completion mutation. */
export function readStudentGradeCourses(userId: string): Promise<StudentGradeCoursesDTO> {
  return prisma.$transaction(
    async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { curriculumId: true, curriculum: { select: { isGpaPath: true } } },
      });
      if (!user) throw new GradeAttemptError('User not found', 404);
      const courses = await tx.course.findMany({
        where: user.curriculumId
          ? {
              curriculumCourses: {
                some: { curriculumId: user.curriculumId, placements: { some: {} } },
              },
            }
          : {},
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      });
      return {
        scope: {
          userId,
          curriculumId: user.curriculumId,
          isGpaPath: user.curriculum?.isGpaPath ?? true,
        },
        courses,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
