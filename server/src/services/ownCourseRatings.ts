import { Prisma } from '@prisma/client';
import type { ScopedOwnCourseRatingsDTO } from '@iu-study-planner/shared';
import { prisma } from '../db';
import { StudentRecordError } from './studentRecordError';

/** Current owner/context and all global personal votes from one consistent snapshot.
 * Supplied transactions must provide a consistent snapshot (RepeatableRead or Serializable).
 */
export function readScopedOwnRatings(
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<ScopedOwnCourseRatingsDTO> {
  const read = async (db: Prisma.TransactionClient): Promise<ScopedOwnCourseRatingsDTO> => {
    const owner = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, curriculumId: true },
    });
    if (!owner) throw new StudentRecordError('Student not found', 404);
    const ratings = await db.courseRating.findMany({
      where: { userId: owner.id },
      select: { courseId: true, rating: true },
      orderBy: { courseId: 'asc' },
    });
    return { scope: { userId: owner.id, curriculumId: owner.curriculumId }, ratings };
  };
  return tx
    ? read(tx)
    : prisma.$transaction(read, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
}
