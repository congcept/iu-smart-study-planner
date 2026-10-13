import { Prisma } from '@prisma/client';
import {
  ListSemesterAllocationJobsSchema,
  SemesterAllocationJobHistorySchema,
  SemesterAllocationJobSchema,
  type ListSemesterAllocationJobsDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import { SchoolResourceError } from './schoolResources';
import {
  semesterAllocationJobOutcomeInclude,
  verifyStoredSemesterAllocationJobOutcome,
} from './semesterAllocationJobExecution';

const include = {
  ...semesterAllocationJobOutcomeInclude,
  run: { select: { id: true } },
};
type HistoryRow = Prisma.SimulationSemesterAllocationJobGetPayload<{ include: typeof include }>;

function verifiedRequest(row: HistoryRow) {
  const outcome = verifyStoredSemesterAllocationJobOutcome(row, row.execution);
  // Nonterminal/failed requests must not hide a linked orphan. A success links the exact run.
  if (
    (outcome.status === 'SUCCEEDED' && row.run?.id !== outcome.runId) ||
    (outcome.status !== 'SUCCEEDED' && row.run !== null)
  )
    throw new Error('Stored semester request history could not be verified');
  const job = SemesterAllocationJobSchema.parse({
    id: outcome.jobId,
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    model: outcome.model,
    scope: outcome.scope,
    status: 'QUEUED',
    queuedAt: outcome.queuedAt,
    inputsCaptured: false,
  });
  return { job, outcome };
}

function serializationFailure(error: Prisma.PrismaClientKnownRequestError) {
  return (
    error.code === 'P2034' ||
    (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code)))
  );
}

/** Bounded coherent discovery only. Never executes work or reinterprets historical inputs. */
export async function listSemesterAllocationJobs(
  actorId: string,
  input: ListSemesterAllocationJobsDTO,
) {
  const actor = SemesterAllocationJobSchema.shape.id.parse(actorId);
  const request = ListSemesterAllocationJobsSchema.parse(input);
  const scope = SemesterAllocationJobSchema.shape.scope.parse({
    curriculumId: request.curriculumId,
    semester: request.semester,
    year: request.year,
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const accounts = await tx.$queryRaw<{ role: string }[]>`
          SELECT role FROM users WHERE id = ${actor} FOR SHARE
        `;
          if (!accounts[0]) throw new SchoolResourceError('Authentication required', 401);
          if (accounts[0].role !== 'ADMIN')
            throw new SchoolResourceError('Administrator access required', 403);
          if (
            !(await tx.curriculum.findUnique({
              where: { id: scope.curriculumId },
              select: { id: true },
            }))
          )
            throw new SchoolResourceError('Curriculum not found', 404);
          let boundary: Prisma.SimulationSemesterAllocationJobWhereInput = {};
          if (request.after) {
            const cursor = await tx.simulationSemesterAllocationJob.findUnique({
              where: { id: request.after },
              include,
            });
            if (
              !cursor ||
              cursor.curriculumId !== scope.curriculumId ||
              cursor.semester !== scope.semester ||
              cursor.year !== scope.year
            )
              throw new SchoolResourceError(
                'Semester request continuation does not match this scenario; reload history',
                409,
              );
            verifiedRequest(cursor);
            boundary = {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            };
          }
          const rows = await tx.simulationSemesterAllocationJob.findMany({
            where: { ...scope, ...boundary },
            include,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 6,
          });
          // Verify the lookahead too; never truncate a corrupt result into a valid-looking page.
          const verified = rows.map(verifiedRequest);
          const requests = verified.slice(0, 5);
          return SemesterAllocationJobHistorySchema.parse({
            kind: 'SIMULATION',
            usage: 'REFERENCE_ONLY',
            model: 'SEMESTER_CREDIT_BUDGET_V1',
            scope,
            order: 'QUEUED_NEWEST_FIRST',
            pageSize: 5,
            after: request.after ?? null,
            requests,
            nextAfter: verified.length > 5 ? requests.at(-1)?.job.id : null,
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          maxWait: 3000,
          timeout: 30000,
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const retryable = serializationFailure(error);
        if (retryable && attempt < 4) continue;
        if (retryable || error.code === 'P2028')
          throw new SchoolResourceError(
            'Could not confirm semester request history; retry the same page',
            409,
          );
      }
      throw error;
    }
  }
  throw new SchoolResourceError(
    'Could not confirm semester request history; retry the same page',
    409,
  );
}
