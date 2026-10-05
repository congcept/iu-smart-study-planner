import { Prisma, type SimulationAllocationRun } from '@prisma/client';
import {
  AllocationRunV1Schema,
  AllocationRunHistorySchema,
  CreateAllocationRunSchema,
  ListAllocationRunsSchema,
  ResourceScopeSchema,
  type CreateAllocationRunDTO,
  type ListAllocationRunsDTO,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import { readAllocationPreview } from './allocationPreview';
import { projectAllocationRunSummary } from './allocationRunProjection';
import { SchoolResourceError } from './schoolResources';

async function authorize(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (!actor) throw new SchoolResourceError('Authentication required', 401);
  if (actor.role !== 'ADMIN') throw new SchoolResourceError('Administrator access required', 403);
}

/** Historical reads use the pinned storage validator, never today's live preview or policy. */
function storedRun(row: SimulationAllocationRun) {
  const parsed = AllocationRunV1Schema.safeParse({
    id: row.id,
    formatVersion: row.formatVersion,
    capturedAt: row.capturedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    snapshotStored: true,
    result: row.result,
  });
  if (!parsed.success) throw new Error('Stored allocation run could not be verified');
  const scope = parsed.data.result.scope;
  if (
    scope.curriculumId !== row.curriculumId.toLowerCase() ||
    scope.semester !== row.semester ||
    scope.year !== row.year
  )
    throw new Error('Stored allocation run scope could not be verified');
  return parsed.data;
}

function replay(row: SimulationAllocationRun, scope: ResourceScopeDTO) {
  const run = storedRun(row);
  if (
    run.result.scope.curriculumId !== scope.curriculumId ||
    run.result.scope.semester !== scope.semester ||
    run.result.scope.year !== scope.year
  )
    throw new SchoolResourceError('This retry key belongs to another simulation scenario', 409);
  return { run, created: false };
}

export async function readAllocationRun(actorId: string, runId: string) {
  return prisma.$transaction(
    async (tx) => {
      await authorize(tx, actorId);
      const row = await tx.simulationAllocationRun.findUnique({
        where: { id: runId.toLowerCase() },
      });
      if (!row) throw new SchoolResourceError('Simulation run not found', 404);
      return storedRun(row);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

/** Bounded historical reads use immutable cursor metadata and never recompute results. */
export async function listAllocationRuns(actorId: string, input: ListAllocationRunsDTO) {
  const request = ListAllocationRunsSchema.parse(input);
  const scope = ResourceScopeSchema.parse({
    curriculumId: request.curriculumId,
    semester: request.semester,
    year: request.year,
  });
  return prisma.$transaction(
    async (tx) => {
      await authorize(tx, actorId.toLowerCase());
      if (
        !(await tx.curriculum.findUnique({
          where: { id: scope.curriculumId },
          select: { id: true },
        }))
      )
        throw new SchoolResourceError('Curriculum not found', 404);
      let boundary: Prisma.SimulationAllocationRunWhereInput = {};
      if (request.after) {
        const cursor = await tx.simulationAllocationRun.findUnique({
          where: { id: request.after },
        });
        if (
          !cursor ||
          cursor.curriculumId !== scope.curriculumId ||
          cursor.semester !== scope.semester ||
          cursor.year !== scope.year
        )
          throw new SchoolResourceError(
            'History continuation does not match this scenario; reload history',
            409,
          );
        storedRun(cursor);
        boundary = {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        };
      }
      const rows = await tx.simulationAllocationRun.findMany({
        where: { ...scope, ...boundary },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
      });
      const verified = rows.map(storedRun);
      const runs = verified.slice(0, 20);
      return AllocationRunHistorySchema.parse({
        kind: 'SIMULATION',
        usage: 'REFERENCE_ONLY',
        scope,
        order: 'STORED_NEWEST_FIRST',
        pageSize: 20,
        runs,
        nextAfter: verified.length > 20 ? runs.at(-1)?.id : null,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function createAllocationRun(actorId: string, input: CreateAllocationRunDTO) {
  const request = CreateAllocationRunSchema.parse(input);
  const scope = ResourceScopeSchema.parse({
    curriculumId: request.curriculumId,
    semester: request.semester,
    year: request.year,
  });
  const key = { createdById: actorId.toLowerCase(), requestId: request.requestId };
  const existing = await prisma.$transaction(
    async (tx) => {
      await authorize(tx, key.createdById);
      if (request.expectedActorId && request.expectedActorId !== key.createdById)
        throw new SchoolResourceError(
          'Your admin session changed; sign in again before saving',
          409,
        );
      return tx.simulationAllocationRun.findUnique({ where: { createdById_requestId: key } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  // Safe retries are history recovery, even when today's config or cohort cannot be previewed.
  if (existing) return replay(existing, scope);

  const result = projectAllocationRunSummary(await readAllocationPreview(key.createdById, scope));
  const capturedAt = new Date(); // Capture-completion time; storage can occur later.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Role may change while the coherent preview is being calculated.
          await authorize(tx, key.createdById);
          const winner = await tx.simulationAllocationRun.findUnique({
            where: { createdById_requestId: key },
          });
          if (winner) return replay(winner, scope);
          const row = await tx.simulationAllocationRun.create({
            data: {
              ...scope,
              ...key,
              formatVersion: 1,
              capturedAt,
              createdAt: new Date(Math.max(Date.now(), capturedAt.getTime())),
              result,
            },
          });
          return { run: storedRun(row), created: true };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (['P2034', 'P2002'].includes(error.code) && attempt < 4) continue;
        if (['P2034', 'P2002', 'P2003'].includes(error.code))
          throw new SchoolResourceError(
            'Could not confirm the simulation save; retry with the same request key',
            409,
          );
      }
      throw error;
    }
  }
  throw new SchoolResourceError(
    'Could not confirm the simulation save; retry with the same request key',
    409,
  );
}
