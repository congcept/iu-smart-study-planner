import { Prisma } from '@prisma/client';
import {
  ListOwnStudyPlansSchema,
  OwnStudyPlanMetadataSchema,
  OwnStudyPlansSchema,
  type ListOwnStudyPlansDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';

export class OwnStudyPlansError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 409,
  ) {
    super(message);
  }
}

/** Saved metadata is historical; today's account scope does not validate a plan's contents. */
export function listOwnStudyPlans(actorId: string, input: ListOwnStudyPlansDTO = {}) {
  const actor = OwnStudyPlanMetadataSchema.shape.id.parse(actorId);
  const query = ListOwnStudyPlansSchema.parse(input);
  return prisma.$transaction(
    async (tx) => {
      const owner = await tx.user.findUnique({
        where: { id: actor },
        select: { id: true, curriculumId: true },
      });
      if (!owner) throw new OwnStudyPlansError('Authentication required', 401);
      let boundary: Prisma.StudyPlanWhereInput = {};
      if (query.after) {
        const cursor = await tx.studyPlan.findFirst({
          where: { id: query.after, userId: owner.id },
          select: { id: true, createdAt: true },
        });
        if (!cursor)
          throw new OwnStudyPlansError('Saved plan continuation is unavailable; reload plans', 409);
        boundary = {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        };
      }
      const rows = await tx.studyPlan.findMany({
        where: { userId: owner.id, ...boundary },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 6,
        select: {
          id: true,
          name: true,
          description: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { semesters: true } },
        },
      });
      const plans = rows.slice(0, 5).map(({ _count, ...plan }) => ({
        ...plan,
        createdAt: plan.createdAt.toISOString(),
        updatedAt: plan.updatedAt.toISOString(),
        semesterCount: _count.semesters,
      }));
      return OwnStudyPlansSchema.parse({
        visibility: 'CURRENT_ACCOUNT_ONLY',
        order: 'STORED_NEWEST_FIRST',
        scope: { userId: owner.id, curriculumId: owner.curriculumId, studyPlansValidated: false },
        pageSize: 5,
        after: query.after ?? null,
        plans,
        nextAfter: rows.length > 5 ? plans.at(-1)?.id : null,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
