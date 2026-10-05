import { Prisma, type SimulationAllocationJob } from '@prisma/client';
import {
  AllocationJobSchema,
  CreateAllocationJobSchema,
  ResourceScopeSchema,
  type CreateAllocationJobDTO,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import { SchoolResourceError } from './schoolResources';

async function authorize(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (!actor) throw new SchoolResourceError('Authentication required', 401);
  if (actor.role !== 'ADMIN') throw new SchoolResourceError('Administrator access required', 403);
}

/** Queue manifests contain a scenario only; enqueueing never captures live inputs. */
function storedJob(row: SimulationAllocationJob) {
  const parsed = AllocationJobSchema.safeParse({
    id: row.id,
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    scope: { curriculumId: row.curriculumId, semester: row.semester, year: row.year },
    status: 'QUEUED',
    queuedAt: row.createdAt.toISOString(),
    inputsCaptured: false,
  });
  if (!parsed.success) throw new Error('Stored simulation job could not be verified');
  return parsed.data;
}

function replay(row: SimulationAllocationJob, scope: ResourceScopeDTO) {
  const job = storedJob(row);
  if (
    job.scope.curriculumId !== scope.curriculumId ||
    job.scope.semester !== scope.semester ||
    job.scope.year !== scope.year
  )
    throw new SchoolResourceError('This retry key belongs to another simulation scenario', 409);
  return { job, created: false };
}

export async function enqueueAllocationJob(actorId: string, input: CreateAllocationJobDTO) {
  const request = CreateAllocationJobSchema.parse(input);
  const scope = ResourceScopeSchema.parse({
    curriculumId: request.curriculumId,
    semester: request.semester,
    year: request.year,
  });
  const key = { createdById: actorId.toLowerCase(), requestId: request.requestId };
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await authorize(tx, key.createdById);
          if (request.expectedActorId !== key.createdById)
            throw new SchoolResourceError(
              'Your admin session changed; sign in again before queueing',
              409,
            );
          const existing = await tx.simulationAllocationJob.findUnique({
            where: { createdById_requestId: key },
          });
          if (existing) return replay(existing, scope);
          if (
            !(await tx.curriculum.findUnique({
              where: { id: scope.curriculumId },
              select: { id: true },
            }))
          )
            throw new SchoolResourceError('Curriculum not found', 404);
          const row = await tx.simulationAllocationJob.create({ data: { ...scope, ...key } });
          return { job: storedJob(row), created: true };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (['P2034', 'P2002'].includes(error.code) && attempt < 4) continue;
        if (['P2034', 'P2002', 'P2003'].includes(error.code))
          throw new SchoolResourceError(
            'Could not confirm the queued simulation; retry with the same request key',
            409,
          );
      }
      throw error;
    }
  }
  throw new SchoolResourceError(
    'Could not confirm the queued simulation; retry with the same request key',
    409,
  );
}

export async function readAllocationJob(actorId: string, jobId: string) {
  return prisma.$transaction(
    async (tx) => {
      await authorize(tx, actorId.toLowerCase());
      const row = await tx.simulationAllocationJob.findUnique({
        where: { id: jobId.toLowerCase() },
      });
      if (!row) throw new SchoolResourceError('Simulation job not found', 404);
      return storedJob(row);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
