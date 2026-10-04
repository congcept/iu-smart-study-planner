import { Prisma } from '@prisma/client';
import type { RatingCourseChoicesDTO } from '@iu-study-planner/shared';
import { prisma } from '../db';
import { decorateCourseDifficulties } from './courseRatings';
import { StudentRecordError } from './studentRecordError';

/** Completion eligibility, membership, personal votes and estimates in one snapshot.
 * Supplied transactions must provide RepeatableRead or Serializable consistency.
 */
export function readRatingCourseChoices(
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<RatingCourseChoicesDTO> {
  const read = async (db: Prisma.TransactionClient): Promise<RatingCourseChoicesDTO> => {
    const owner = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, curriculumId: true },
    });
    if (!owner) throw new StudentRecordError('Student not found', 404);
    const rows = await db.course.findMany({
      where: { studentRecords: { some: { userId: owner.id, status: 'COMPLETED' } } },
      select: {
        id: true,
        code: true,
        name: true,
        avgRating: true,
        ratingCount: true,
        curriculumCourses: {
          where: { curriculumId: owner.curriculumId ?? undefined },
          select: { curriculumId: true },
        },
        ratings: { where: { userId: owner.id }, select: { rating: true } },
      },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
    });
    const choices = rows.map(({ curriculumCourses, ratings, ...course }) => ({
      ...course,
      yourRating: ratings[0]?.rating ?? null,
      membership:
        owner.curriculumId === null
          ? ('UNASSIGNED' as const)
          : curriculumCourses.some(({ curriculumId }) => curriculumId === owner.curriculumId)
            ? ('CURRENT_CURRICULUM' as const)
            : ('OTHER_HISTORY' as const),
    }));
    const members = choices.filter(({ membership }) => membership === 'CURRENT_CURRICULUM');
    const global = choices.filter(({ membership }) => membership !== 'CURRENT_CURRICULUM');
    const estimates = [
      ...(await decorateCourseDifficulties(db, members, owner.curriculumId ?? undefined)),
      ...(await decorateCourseDifficulties(db, global)),
    ];
    const byId = new Map(estimates.map((course) => [course.id, course]));
    return {
      scope: { userId: owner.id, curriculumId: owner.curriculumId },
      courses: choices.map(({ id }) => byId.get(id)!),
    };
  };
  return tx
    ? read(tx)
    : prisma.$transaction(read, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
}
