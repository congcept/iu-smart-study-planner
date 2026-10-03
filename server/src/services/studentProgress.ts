import { Prisma } from '@prisma/client';
import type { StudentProgressDTO } from '@iu-study-planner/shared';
import { prisma } from '../db';

async function readProgressSnapshot(
  userId: string,
  db: Prisma.TransactionClient,
): Promise<StudentProgressDTO> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { curriculumId: true } });
  const records = await db.studentRecord.findMany({
    where: {
      userId,
      status: { in: ['COMPLETED', 'PLANNED'] },
      ...(user?.curriculumId
        ? { course: { curriculumCourses: { some: { curriculumId: user.curriculumId } } } }
        : {}),
    },
    select: { courseId: true, status: true, electiveGroup: true },
    orderBy: { courseId: 'asc' },
  });
  return {
    completedIds: Object.fromEntries(
      records
        .filter((record) => record.status === 'COMPLETED')
        .map((record) => [record.courseId, record.electiveGroup]),
    ),
    plannedIds: records
      .filter((record) => record.status === 'PLANNED')
      .map((record) => record.courseId),
  };
}

/** Hide nonmember history from active progress without deleting or remapping it. */
export function readStudentProgress(
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<StudentProgressDTO> {
  if (tx) return readProgressSnapshot(userId, tx);
  return prisma.$transaction((snapshot) => readProgressSnapshot(userId, snapshot), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}
