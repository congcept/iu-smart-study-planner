import type { Prisma } from '@prisma/client';
import type { StudentProgressDTO } from '@iu-study-planner/shared';
import { prisma } from '../db';

export async function readStudentProgress(
  userId: string,
  db: Pick<Prisma.TransactionClient, 'studentRecord'> = prisma,
): Promise<StudentProgressDTO> {
  const records = await db.studentRecord.findMany({
    where: { userId, status: { in: ['COMPLETED', 'PLANNED'] } },
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
