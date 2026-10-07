import { Prisma } from '@prisma/client';
import {
  CreateSemesterAllocationRunSchema,
  ListOwnSemesterAllocationRunsSchema,
  OwnSemesterAllocationHistorySchema,
  type ListOwnSemesterAllocationRunsDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import {
  projectOwnSemesterAllocationRun,
  verifyStoredSemesterAllocationRun,
} from './semesterAllocationStorage';
import { SchoolResourceError } from './schoolResources';

const participants = { take: 501, orderBy: { capturedStudentId: 'asc' as const } };
const continuationError = () =>
  new SchoolResourceError('Own simulation continuation is unavailable; reload history', 409);

/** Historical access follows only the live participant FK, irrespective of today's role/major. */
export async function listOwnSemesterAllocationRuns(
  actorId: string,
  input: ListOwnSemesterAllocationRunsDTO = {},
) {
  const actor = CreateSemesterAllocationRunSchema.shape.expectedActorId.parse(actorId);
  const request = ListOwnSemesterAllocationRunsSchema.parse(input);
  return prisma.$transaction(
    async (tx) => {
      if (!(await tx.user.findUnique({ where: { id: actor }, select: { id: true } })))
        throw new SchoolResourceError('Authentication required', 401);
      const access = { participants: { some: { userId: actor } } };
      let boundary: Prisma.SimulationSemesterRunWhereInput = {};
      if (request.after) {
        const cursor = await tx.simulationSemesterRun.findFirst({
          where: { id: request.after, ...access },
          include: { participants },
        });
        // Missing, deleted and nonowned cursors have one response; never consult captured UUIDs.
        if (!cursor) throw continuationError();
        verifyStoredSemesterAllocationRun(cursor);
        boundary = {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        };
      }
      const rows = await tx.simulationSemesterRun.findMany({
        where: { ...access, ...boundary },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 6,
        include: { participants },
      });
      // Verify even the bounded lookahead before publishing a continuation, fail closed on damage.
      const verified = rows.map((row) => {
        const run = verifyStoredSemesterAllocationRun(row);
        const participant = row.participants.find((entry) => entry.userId === actor);
        if (!participant) throw new Error('Stored own simulation access could not be verified');
        return projectOwnSemesterAllocationRun(run, participant.capturedStudentId);
      });
      const runs = verified.slice(0, 5);
      return OwnSemesterAllocationHistorySchema.parse({
        kind: 'SIMULATION',
        usage: 'REFERENCE_ONLY',
        visibility: 'CURRENT_ACCOUNT_ONLY',
        order: 'STORED_NEWEST_FIRST',
        pageSize: 5,
        after: request.after ?? null,
        runs,
        nextAfter: verified.length > 5 ? runs.at(-1)?.id : null,
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 3000,
      timeout: 30000,
    },
  );
}
