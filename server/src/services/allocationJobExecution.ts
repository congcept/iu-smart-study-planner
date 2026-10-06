import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type SimulationAllocationExecution,
  type SimulationAllocationJob,
  type SimulationAllocationRun,
} from '@prisma/client';
import {
  AllocationJobOutcomeSchema,
  AllocationJobSchema,
  CreateAllocationJobSchema,
  ExecuteAllocationJobSchema,
  AllocationJobExecutionSchema,
  type AllocationJobOutcomeDTO,
  type ExecuteAllocationJobDTO,
  type AllocationRunSummaryV1DTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import { readAllocationPreview } from './allocationPreview';
import { projectAllocationRunSummary } from './allocationRunProjection';
import { verifyStoredAllocationRun } from './allocationRuns';
import { SchoolResourceError } from './schoolResources';

type StoredExecution = SimulationAllocationExecution & { run: SimulationAllocationRun | null };

export function verifyStoredAllocationJobOutcome(
  job: SimulationAllocationJob,
  execution: StoredExecution | null,
): AllocationJobOutcomeDTO {
  const verified = AllocationJobSchema.safeParse({
    id: job.id,
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    scope: { curriculumId: job.curriculumId, semester: job.semester, year: job.year },
    status: 'QUEUED',
    queuedAt: job.createdAt.toISOString(),
    inputsCaptured: false,
  });
  if (!verified.success) throw new Error('Stored simulation request could not be verified');
  const receipt = verified.data;
  if (execution?.status === 'SUCCEEDED') {
    if (
      !execution.run ||
      execution.run.id !== execution.runId ||
      execution.run.jobId !== job.id ||
      execution.run.createdById !== job.createdById
    )
      throw new Error('Stored simulation outcome provenance could not be verified');
    const run = verifyStoredAllocationRun(execution.run);
    if (
      run.result.scope.curriculumId !== receipt.scope.curriculumId ||
      run.result.scope.semester !== receipt.scope.semester ||
      run.result.scope.year !== receipt.scope.year ||
      execution.run.capturedAt < job.createdAt ||
      execution.run.createdAt < job.createdAt ||
      execution.completedAt < execution.run.createdAt
    )
      throw new Error('Stored simulation outcome scope or chronology could not be verified');
  }
  const parsed = AllocationJobOutcomeSchema.safeParse({
    jobId: receipt.id,
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    scope: receipt.scope,
    queuedAt: receipt.queuedAt,
    executionModel: 'ATOMIC_SINGLE_JOB',
    status: execution?.status ?? 'PENDING',
    runId: execution?.runId ?? null,
    completedAt: execution?.completedAt.toISOString() ?? null,
    failureCode: execution?.failureCode ?? null,
  });
  if (!parsed.success) throw new Error('Stored simulation outcome could not be verified');
  return parsed.data;
}

export async function readAllocationJobOutcome(actorId: string, jobId: string) {
  const id = CreateAllocationJobSchema.shape.requestId.parse(jobId);
  return prisma.$transaction(
    async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: actorId.toLowerCase() },
        select: { role: true },
      });
      if (!actor) throw new SchoolResourceError('Authentication required', 401);
      if (actor.role !== 'ADMIN')
        throw new SchoolResourceError('Administrator access required', 403);
      const job = await tx.simulationAllocationJob.findUnique({
        where: { id },
        include: { execution: { include: { run: true } } },
      });
      if (!job) throw new SchoolResourceError('Simulation job not found', 404);
      return verifyStoredAllocationJobOutcome(job, job.execution);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

function retryable(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (['P2034', 'P2002'].includes(error.code)) return true;
  return error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code));
}

type ExecutionAuthorization = { actorId: string; request: ExecuteAllocationJobDTO };

async function executeOne(jobId: string, authorization?: ExecutionAuthorization) {
  const id = CreateAllocationJobSchema.shape.requestId.parse(jobId);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          let selected: (SimulationAllocationJob & { execution: StoredExecution | null }) | null =
            null;
          if (authorization) {
            // The acting role is locked through capture/terminal commit, including replay.
            const actors = await tx.$queryRaw<{ role: string }[]>`
              SELECT role FROM users WHERE id = ${authorization.actorId} FOR SHARE
            `;
            if (!actors[0]) throw new SchoolResourceError('Authentication required', 401);
            if (actors[0].role !== 'ADMIN')
              throw new SchoolResourceError('Administrator access required', 403);
            if (authorization.actorId !== authorization.request.expectedActorId)
              throw new SchoolResourceError(
                'The signed-in account changed; refresh and retry',
                409,
              );
            selected = await tx.simulationAllocationJob.findUnique({
              where: { id },
              include: { execution: { include: { run: true } } },
            });
            if (!selected) throw new SchoolResourceError('Simulation job not found', 404);
            const expected = authorization.request;
            if (
              selected.curriculumId !== expected.curriculumId ||
              selected.semester !== expected.semester ||
              selected.year !== expected.year
            )
              throw new SchoolResourceError(
                'The simulation scenario changed; refresh and retry',
                409,
              );
          }
          const claimed = await tx.$queryRaw<{ id: string }[]>`
          SELECT j.id FROM simulation_allocation_jobs j
          WHERE j.id = ${id}
            AND NOT EXISTS (SELECT 1 FROM simulation_allocation_executions e WHERE e.job_id = j.id)
          FOR UPDATE OF j SKIP LOCKED
        `;
          if (claimed.length === 0)
            return selected
              ? {
                  processed: false as const,
                  outcome: verifyStoredAllocationJobOutcome(selected, selected.execution),
                }
              : { processed: false as const };
          const job = await tx.simulationAllocationJob.findUniqueOrThrow({ where: { id } });
          const pending = verifyStoredAllocationJobOutcome(job, null);
          const authors = job.createdById
            ? await tx.$queryRaw<
                { role: string }[]
              >`SELECT role FROM users WHERE id = ${job.createdById} FOR SHARE`
            : [];
          let failureCode: 'AUTHOR_UNAVAILABLE' | 'PREVIEW_UNAVAILABLE' | null =
            authors[0]?.role === 'ADMIN' ? null : 'AUTHOR_UNAVAILABLE';
          let run: SimulationAllocationRun | null = null;
          if (failureCode === null && job.createdById) {
            let result: AllocationRunSummaryV1DTO | undefined;
            try {
              // The existing output cap is checked before loading the full cohort/history too.
              const students = await tx.user.count({
                where: { role: 'STUDENT', curriculumId: job.curriculumId },
              });
              if (students > 500)
                throw new SchoolResourceError('Simulation cohort exceeds the supported limit', 409);
              result = projectAllocationRunSummary(
                await readAllocationPreview(job.createdById, pending.scope, tx),
              );
            } catch (error) {
              // Only confirmed domain rejection is terminal. SQL/transport/corrupt-state/config
              // exceptions escape, rolling back both capture and execution for a later retry.
              if (!(error instanceof SchoolResourceError)) throw error;
              failureCode =
                error.status === 401 || error.status === 403
                  ? 'AUTHOR_UNAVAILABLE'
                  : 'PREVIEW_UNAVAILABLE';
            }
            if (result) {
              const capturedAt = new Date(Math.max(Date.now(), job.createdAt.getTime()));
              run = await tx.simulationAllocationRun.create({
                data: {
                  ...pending.scope,
                  jobId: job.id,
                  createdById: job.createdById,
                  requestId: randomUUID(),
                  formatVersion: 1,
                  capturedAt,
                  createdAt: capturedAt,
                  result,
                },
              });
              verifyStoredAllocationRun(run);
            }
          }
          if (!run && failureCode === null)
            throw new Error('Simulation execution produced no verified outcome');
          const execution = await tx.simulationAllocationExecution.create({
            data: {
              jobId: job.id,
              status: run ? 'SUCCEEDED' : 'FAILED',
              runId: run?.id ?? null,
              failureCode,
              completedAt: new Date(
                Math.max(Date.now(), job.createdAt.getTime(), run?.createdAt.getTime() ?? 0),
              ),
            },
          });
          return {
            processed: true as const,
            outcome: verifyStoredAllocationJobOutcome(job, { ...execution, run }),
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15_000,
          maxWait: 3_000,
        },
      );
    } catch (error) {
      if (retryable(error) && attempt < 4) continue;
      throw error;
    }
  }
  throw new Error('Could not confirm simulation execution');
}

/** Explicit bounded CLI worker: one selected request, no timer or automatic queue draining. */
export async function runOneAllocationJob(jobId: string) {
  return executeOne(jobId);
}

/** Browser action: authorize the current actor and scenario inside the same atomic worker. */
export async function executeAllocationJob(
  actorId: string,
  jobId: string,
  input: ExecuteAllocationJobDTO,
) {
  const request = ExecuteAllocationJobSchema.parse(input);
  const actor = CreateAllocationJobSchema.shape.expectedActorId.parse(actorId);
  return AllocationJobExecutionSchema.parse(await executeOne(jobId, { actorId: actor, request }));
}
