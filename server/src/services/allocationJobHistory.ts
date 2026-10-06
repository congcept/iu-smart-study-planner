import { Prisma } from '@prisma/client';
import {
  AllocationJobHistorySchema,
  ListAllocationJobsSchema,
  CreateAllocationJobSchema,
  type ListAllocationJobsDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import { verifyStoredAllocationJobOutcome } from './allocationJobExecution';
import { SchoolResourceError } from './schoolResources';

/** Queue chronology is immutable; each page's current outcomes share one read snapshot. */
export async function listAllocationJobs(actorId: string, input: ListAllocationJobsDTO) {
  const request = ListAllocationJobsSchema.parse(input);
  const actor = CreateAllocationJobSchema.shape.expectedActorId.parse(actorId);
  const scope = CreateAllocationJobSchema.pick({
    curriculumId: true,
    semester: true,
    year: true,
  }).parse({ curriculumId: request.curriculumId, semester: request.semester, year: request.year });
  return prisma.$transaction(
    async (tx) => {
      const account = await tx.user.findUnique({ where: { id: actor }, select: { role: true } });
      if (!account) throw new SchoolResourceError('Authentication required', 401);
      if (account.role !== 'ADMIN')
        throw new SchoolResourceError('Administrator access required', 403);
      if (
        !(await tx.curriculum.findUnique({
          where: { id: scope.curriculumId },
          select: { id: true },
        }))
      )
        throw new SchoolResourceError('Curriculum not found', 404);
      let boundary: Prisma.SimulationAllocationJobWhereInput = {};
      if (request.after) {
        const cursor = await tx.simulationAllocationJob.findUnique({
          where: { id: request.after },
          include: { execution: { include: { run: true } } },
        });
        if (
          !cursor ||
          cursor.curriculumId !== scope.curriculumId ||
          cursor.semester !== scope.semester ||
          cursor.year !== scope.year
        )
          throw new SchoolResourceError(
            'Request continuation does not match this scenario; reload history',
            409,
          );
        verifyStoredAllocationJobOutcome(cursor, cursor.execution);
        boundary = {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        };
      }
      const rows = await tx.simulationAllocationJob.findMany({
        where: { ...scope, ...boundary },
        include: { execution: { include: { run: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
      });
      // Verify the look-ahead as well; never silently truncate past corrupt stored history.
      const verified = rows.map((row) => verifyStoredAllocationJobOutcome(row, row.execution));
      const jobs = verified.slice(0, 20);
      return AllocationJobHistorySchema.parse({
        kind: 'SIMULATION',
        usage: 'REFERENCE_ONLY',
        scope,
        order: 'QUEUED_NEWEST_FIRST',
        pageSize: 20,
        jobs,
        nextAfter: verified.length > 20 ? jobs.at(-1)?.jobId : null,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
