import { Prisma } from '@prisma/client';
import {
  ListOwnStudyPlanSemestersSchema,
  OwnStudyPlanMetadataSchema,
  OwnStudyPlanSemestersParamsSchema,
  OwnStudyPlanSemestersSchema,
  type ListOwnStudyPlanSemestersDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';

export class OwnStudyPlanSemestersError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 404 | 409,
  ) {
    super(message);
  }
}

/** Current account scope and owned historical metadata share one read-only snapshot. */
export function listOwnStudyPlanSemesters(
  actorId: string,
  selectedPlanId: string,
  input: ListOwnStudyPlanSemestersDTO = {},
) {
  const actor = OwnStudyPlanMetadataSchema.shape.id.parse(actorId);
  const { planId } = OwnStudyPlanSemestersParamsSchema.parse({ planId: selectedPlanId });
  const query = ListOwnStudyPlanSemestersSchema.parse(input);
  return prisma.$transaction(
    async (tx) => {
      const owner = await tx.user.findUnique({
        where: { id: actor },
        select: { id: true, curriculumId: true },
      });
      if (!owner) throw new OwnStudyPlanSemestersError('Authentication required', 401);
      const storedPlan = await tx.studyPlan.findFirst({
        where: { id: planId, userId: owner.id },
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
      if (!storedPlan) throw new OwnStudyPlanSemestersError('Saved study plan not found', 404);
      let boundary: Prisma.PlannedSemesterWhereInput = {};
      if (query.after) {
        const cursor = await tx.plannedSemester.findFirst({
          where: { id: query.after, studyPlanId: planId },
          select: { id: true, createdAt: true },
        });
        if (!cursor)
          throw new OwnStudyPlanSemestersError(
            'Saved semester continuation is unavailable; reload semesters',
            409,
          );
        boundary = {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        };
      }
      const rows = await tx.plannedSemester.findMany({
        where: { studyPlanId: planId, ...boundary },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 6,
        select: {
          id: true,
          semester: true,
          year: true,
          createdAt: true,
          updatedAt: true,
          totalCredits: true,
        },
      });
      const semesters = rows.slice(0, 5).map(({ totalCredits, ...semester }) => ({
        ...semester,
        createdAt: semester.createdAt.toISOString(),
        updatedAt: semester.updatedAt.toISOString(),
        storedTotalCredits: totalCredits,
      }));
      const { _count, ...metadata } = storedPlan;
      return OwnStudyPlanSemestersSchema.parse({
        visibility: 'CURRENT_ACCOUNT_ONLY',
        order: 'STORED_NEWEST_FIRST',
        scope: { userId: owner.id, curriculumId: owner.curriculumId, studyPlansValidated: false },
        plan: {
          ...metadata,
          createdAt: metadata.createdAt.toISOString(),
          updatedAt: metadata.updatedAt.toISOString(),
          semesterCount: _count.semesters,
        },
        pageSize: 5,
        after: query.after ?? null,
        semesters,
        nextAfter: rows.length > 5 ? semesters.at(-1)?.id : null,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
