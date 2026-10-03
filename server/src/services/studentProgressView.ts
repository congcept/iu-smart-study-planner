import { Prisma } from '@prisma/client';
import type { ContextStudentProgressDTO, ContextStudentRecordDTO } from '@iu-study-planner/shared';
import { prisma } from '../db';
import { readCurriculumSnapshot } from './curriculumContexts';
import { resolveCurriculumAvailability } from './curriculumRecommendations';
import { StudentRecordError } from './studentRecordError';

const degreeCredits = (course: { code: string; credits: number }) =>
  ['PT001IU', 'PT002IU'].includes(course.code) ? 0 : course.credits;

/** Resolve identifier, active scope, history and availability from a single snapshot. */
export function readStudentProgressView(identifier: string) {
  return prisma.$transaction(
    async (tx) => {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        identifier,
      );
      const user = await tx.user.findUnique({
        where: isUuid ? { id: identifier.toLowerCase() } : { studentId: identifier },
        select: { id: true, curriculumId: true },
      });
      if (!user) throw new StudentRecordError('User not found', 404);
      const records = await tx.studentRecord.findMany({
        where: { userId: user.id },
        include: {
          course: { include: { prerequisites: { include: { prerequisite: true } } } },
        },
        orderBy: { courseId: 'asc' },
      });

      if (user.curriculumId) {
        const context = await readCurriculumSnapshot(tx, user.curriculumId);
        if (!context) throw new StudentRecordError('Curriculum not found', 404);
        const byId = new Map(context.courses.map((course) => [course.id, course]));
        const attempts = await tx.gradeAttempt.findMany({
          where: { userId: user.id },
          select: { courseId: true, score: true },
        });
        const { available, gpaPath } = resolveCurriculumAvailability(context, records, attempts);
        const currentRecords: ContextStudentRecordDTO[] = records.flatMap(
          ({ course, ...record }) => {
            const member = byId.get(course.id);
            return member
              ? [
                  {
                    ...record,
                    createdAt: record.createdAt.toISOString(),
                    updatedAt: record.updatedAt.toISOString(),
                    course: member,
                  },
                ]
              : [];
          },
        );
        const completed = currentRecords.filter(({ status }) => status === 'COMPLETED');
        const data: ContextStudentProgressDTO = {
          completed,
          inProgress: currentRecords.filter(({ status }) => status === 'IN_PROGRESS'),
          planned: currentRecords.filter(({ status }) => status === 'PLANNED'),
          historicalRecords: records
            .filter(({ courseId }) => !byId.has(courseId))
            .map(({ course, ...record }) => ({
              ...record,
              createdAt: record.createdAt.toISOString(),
              updatedAt: record.updatedAt.toISOString(),
              course: {
                id: course.id,
                code: course.code,
                name: course.name,
                credits: course.credits,
              },
            })),
          available: available.map(({ isPrerequisiteFor: _children, ...course }) => course),
          progress: {
            totalCourses: context.courses.length,
            completedCourses: completed.length,
            totalCredits: context.totalCredits,
            completedCredits: completed.reduce(
              (sum, record) => sum + degreeCredits(record.course),
              0,
            ),
            // Option catalogs/free electives do not define a verified graduation denominator.
            percentage: null,
          },
          scope: {
            userId: user.id,
            curriculumId: context.id,
            usage: context.usage,
            degreeProgressAvailable: false,
            gpaPath,
            ratingPrior: context.ratingPrior,
          },
        };
        return data;
      }

      // Preserve the legacy catalog response for accounts with no assigned context.
      const allCourses = await tx.course.findMany({ include: { prerequisites: true } });
      const completedIds = new Set(
        records.filter(({ status }) => status === 'COMPLETED').map(({ courseId }) => courseId),
      );
      const inProgressIds = new Set(
        records.filter(({ status }) => status === 'IN_PROGRESS').map(({ courseId }) => courseId),
      );
      const available = allCourses.filter(
        (course) =>
          !completedIds.has(course.id) &&
          !inProgressIds.has(course.id) &&
          course.prerequisites.every((parent) => completedIds.has(parent.prerequisiteId)),
      );
      const totalCredits = allCourses.reduce((sum, course) => sum + degreeCredits(course), 0);
      const completedCredits = records
        .filter(({ status }) => status === 'COMPLETED')
        .reduce((sum, record) => sum + degreeCredits(record.course), 0);
      return {
        completed: records.filter(({ status }) => status === 'COMPLETED'),
        inProgress: records.filter(({ status }) => status === 'IN_PROGRESS'),
        planned: records.filter(({ status }) => status === 'PLANNED'),
        available,
        progress: {
          totalCourses: allCourses.length,
          completedCourses: completedIds.size,
          totalCredits,
          completedCredits,
          percentage: totalCredits > 0 ? Math.round((completedCredits / totalCredits) * 100) : 0,
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
