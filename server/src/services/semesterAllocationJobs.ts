import { Prisma, type SimulationSemesterAllocationJob } from '@prisma/client';
import {
  CreateSemesterAllocationJobSchema,
  SemesterAllocationJobSchema,
  type CreateSemesterAllocationJobDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import { SchoolResourceError } from './schoolResources';

function serializationFailure(error: Prisma.PrismaClientKnownRequestError) {
  return (
    error.code === 'P2034' ||
    (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code)))
  );
}

async function authorize(tx: Prisma.TransactionClient, actorId: string) {
  // Hold current role/account evidence through enqueue/read commit.
  const rows = await tx.$queryRaw<{ role: string }[]>`
    SELECT "role" FROM "users" WHERE "id" = ${actorId} FOR SHARE
  `;
  if (!rows[0]) throw new SchoolResourceError('Authentication required', 401);
  if (rows[0].role !== 'ADMIN') throw new SchoolResourceError('Administrator access required', 403);
}

function storedJob(row: SimulationSemesterAllocationJob) {
  const result = SemesterAllocationJobSchema.safeParse({
    id: row.id,
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    model: row.model,
    scope: { curriculumId: row.curriculumId, semester: row.semester, year: row.year },
    status: 'QUEUED',
    queuedAt: row.createdAt.toISOString(),
    inputsCaptured: false,
  });
  if (!result.success) throw new Error('Stored semester simulation request could not be verified');
  return result.data;
}

/** Scenario-only intent. Live cohort, budgets, policies and resources are captured by a later executor. */
export async function enqueueSemesterAllocationJob(
  actorId: string,
  input: CreateSemesterAllocationJobDTO,
) {
  const request = CreateSemesterAllocationJobSchema.parse(input);
  const actor = actorId.toLowerCase();
  const key = { createdById: actor, requestId: request.requestId };
  const scope = {
    curriculumId: request.curriculumId,
    semester: request.semester,
    year: request.year,
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await authorize(tx, actor);
          if (request.expectedActorId !== actor)
            throw new SchoolResourceError(
              'Your admin session changed; sign in again before queueing',
              409,
            );
          const existing = await tx.simulationSemesterAllocationJob.findUnique({
            where: { createdById_requestId: key },
          });
          if (existing) {
            const job = storedJob(existing);
            if (JSON.stringify(job.scope) !== JSON.stringify(scope))
              throw new SchoolResourceError(
                'This retry key belongs to another semester simulation scenario',
                409,
              );
            return { job, created: false };
          }
          if (
            !(await tx.curriculum.findUnique({
              where: { id: scope.curriculumId },
              select: { id: true },
            }))
          )
            throw new SchoolResourceError('Curriculum not found', 404);
          const row = await tx.simulationSemesterAllocationJob.create({
            data: { ...scope, ...key },
          });
          return { job: storedJob(row), created: true };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 3000,
          timeout: 10000,
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const retryable = serializationFailure(error) || error.code === 'P2002';
        if (retryable && attempt < 4) continue;
        if (retryable || ['P2003', 'P2028'].includes(error.code))
          throw new SchoolResourceError(
            'Could not confirm the queued semester simulation; retry with the same request key',
            409,
          );
      }
      throw error;
    }
  }
  throw new SchoolResourceError(
    'Could not confirm the queued semester simulation; retry with the same request key',
    409,
  );
}

export async function readSemesterAllocationJob(actorId: string, jobId: string) {
  const uncertainRead = 'Could not confirm the semester simulation request; retry the same read';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await authorize(tx, actorId.toLowerCase());
          const row = await tx.simulationSemesterAllocationJob.findUnique({
            where: { id: jobId.toLowerCase() },
          });
          if (!row) throw new SchoolResourceError('Semester simulation request not found', 404);
          return storedJob(row);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          maxWait: 3000,
          timeout: 10000,
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (serializationFailure(error) && attempt < 4) continue;
        if (serializationFailure(error) || error.code === 'P2028')
          throw new SchoolResourceError(uncertainRead, 409);
      }
      throw error;
    }
  }
  throw new SchoolResourceError(uncertainRead, 409);
}
