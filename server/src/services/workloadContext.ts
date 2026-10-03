import { Prisma } from '@prisma/client';
import type { WorkloadScopeDTO } from '@iu-study-planner/shared';
import { prisma } from '../db';
import { decorateCourseDifficulties } from './courseRatings';

export class WorkloadContextError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 404 | 409,
  ) {
    super(message);
  }
}

export function readAccountWorkload(userId: string | undefined, courseIds: readonly string[]) {
  return prisma.$transaction(
    async (tx) => {
      const user = userId
        ? await tx.user.findUnique({ where: { id: userId }, select: { curriculumId: true } })
        : null;
      if (userId && !user) throw new WorkloadContextError('Authentication required', 401);
      const curriculumId = user?.curriculumId ?? null;
      const uniqueIds = [...new Set(courseIds)];
      const rows = await tx.course.findMany({
        where: {
          id: { in: uniqueIds },
          ...(curriculumId && {
            curriculumCourses: { some: { curriculumId, placements: { some: {} } } },
          }),
        },
      });
      if (rows.length !== uniqueIds.length) {
        throw new WorkloadContextError(
          curriculumId
            ? 'One or more courses are not placed in the assigned curriculum'
            : 'One or more courses were not found',
          curriculumId ? 409 : 404,
        );
      }
      const courses = await decorateCourseDifficulties(tx, rows, curriculumId ?? undefined);
      const first = courses[0]; // The route schema requires at least one known course.
      const scope: WorkloadScopeDTO = {
        curriculumId,
        categoryBalanceAvailable: curriculumId === null,
        ratingPrior: { mean: first.ratingPriorMean, source: first.ratingPriorSource },
      };
      return { courses, scope };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
