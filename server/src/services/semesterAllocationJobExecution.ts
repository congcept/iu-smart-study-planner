import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type SimulationSemesterAllocationExecution,
  type SimulationSemesterAllocationJob,
  type SimulationSemesterParticipant,
  type SimulationSemesterRun,
} from '@prisma/client';
import {
  SemesterAllocationJobSchema,
  SemesterAllocationJobOutcomeSchema,
  type SemesterAllocationJobOutcomeDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import { SchoolResourceError } from './schoolResources';
import { produceSemesterAllocationPreview } from './semesterAllocationPreview';
import {
  storeSemesterAllocationRunInTransaction,
  verifyStoredSemesterAllocationRun,
} from './semesterAllocationStorage';

type StoredRun = SimulationSemesterRun & { participants: SimulationSemesterParticipant[] };
type StoredExecution = SimulationSemesterAllocationExecution & { run: StoredRun | null };
const include = {
  execution: {
    include: {
      run: {
        include: { participants: { take: 501, orderBy: { capturedStudentId: 'asc' as const } } },
      },
    },
  },
};
const uuid = SemesterAllocationJobSchema.shape.id;
const storedError = () => new Error('Stored semester simulation outcome could not be verified');

/** Full private replay and exact job provenance precede the small public projection. */
export function verifyStoredSemesterAllocationJobOutcome(
  job: SimulationSemesterAllocationJob,
  execution: StoredExecution | null,
): SemesterAllocationJobOutcomeDTO {
  const receipt = SemesterAllocationJobSchema.safeParse({
    id: job.id,
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    model: job.model,
    scope: { curriculumId: job.curriculumId, semester: job.semester, year: job.year },
    status: 'QUEUED',
    queuedAt: job.createdAt.toISOString(),
    inputsCaptured: false,
  });
  if (
    !receipt.success ||
    !uuid.safeParse(job.requestId).success ||
    (job.createdById !== null && !uuid.safeParse(job.createdById).success) ||
    (execution !== null && execution.jobId !== receipt.data.id)
  )
    throw storedError();
  if (execution?.status === 'SUCCEEDED') {
    const row = execution.run;
    if (
      !row ||
      row.id !== execution.runId ||
      row.jobId !== receipt.data.id ||
      row.createdById !== job.createdById
    )
      throw storedError();
    const run = verifyStoredSemesterAllocationRun(row);
    if (
      run.result.model !== receipt.data.model ||
      JSON.stringify(run.result.envelope.scope) !== JSON.stringify(receipt.data.scope) ||
      row.capturedAt < job.createdAt ||
      row.createdAt < row.capturedAt ||
      execution.completedAt < row.createdAt
    )
      throw storedError();
  } else if (execution?.run !== null && execution?.run !== undefined) {
    throw storedError();
  }
  const outcome = SemesterAllocationJobOutcomeSchema.safeParse({
    jobId: receipt.data.id,
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    model: receipt.data.model,
    scope: receipt.data.scope,
    queuedAt: receipt.data.queuedAt,
    executionModel: 'ATOMIC_SINGLE_JOB',
    status: execution?.status ?? 'PENDING',
    runId: execution?.runId ?? null,
    completedAt: execution?.completedAt.toISOString() ?? null,
    failureCode: execution?.failureCode ?? null,
  });
  if (!outcome.success) throw storedError();
  return outcome.data;
}

function retryable(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (['P2034', 'P2002'].includes(error.code) ||
      (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code))))
  );
}

/** Trusted local explicit worker. No timer, startup hook or automatic queue draining. */
export async function runOneSemesterAllocationJob(jobId: string) {
  const id = uuid.parse(jobId);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const selected = await tx.simulationSemesterAllocationJob.findUnique({
            where: { id },
            include,
          });
          if (!selected)
            throw new SchoolResourceError('Semester simulation request not found', 404);
          const pending = verifyStoredSemesterAllocationJobOutcome(selected, selected.execution);
          const linked = await tx.simulationSemesterRun.findUnique({
            where: { jobId: id },
            select: { id: true },
          });
          if (pending.status !== 'SUCCEEDED' && linked) throw storedError();
          // Immutable recovery never consults today's author, inputs or deployment policies.
          if (selected.execution) return { processed: false, outcome: pending };
          const claimed = await tx.$queryRaw<{ id: string }[]>`
            SELECT j.id FROM simulation_semester_allocation_jobs j
            WHERE j.id = ${id}
              AND NOT EXISTS (SELECT 1 FROM simulation_semester_allocation_executions e WHERE e.job_id = j.id)
            FOR UPDATE OF j SKIP LOCKED
          `;
          if (claimed.length === 0) return { processed: false, outcome: pending };
          const authors = selected.createdById
            ? await tx.$queryRaw<{ role: string }[]>`
                SELECT role FROM users WHERE id = ${selected.createdById} FOR SHARE
              `
            : [];
          let failureCode: 'AUTHOR_UNAVAILABLE' | 'PREVIEW_UNAVAILABLE' | null =
            authors[0]?.role === 'ADMIN' ? null : 'AUTHOR_UNAVAILABLE';
          let run: StoredRun | null = null;
          if (failureCode === null && selected.createdById) {
            let produced: Awaited<ReturnType<typeof produceSemesterAllocationPreview>> | undefined;
            try {
              produced = await produceSemesterAllocationPreview(
                selected.createdById,
                pending.scope,
                tx,
              );
            } catch (error) {
              // Only confirmed domain rejection is terminal. Corruption/config/SQL errors roll back.
              if (!(error instanceof SchoolResourceError)) throw error;
              failureCode =
                error.status === 401 || error.status === 403
                  ? 'AUTHOR_UNAVAILABLE'
                  : 'PREVIEW_UNAVAILABLE';
            }
            if (produced) {
              const captured = await storeSemesterAllocationRunInTransaction(
                tx,
                selected.createdById,
                {
                  ...pending.scope,
                  expectedActorId: selected.createdById,
                  requestId: randomUUID(),
                },
                produced.result,
                new Date(Math.max(Date.now(), selected.createdAt.getTime())),
                id,
              );
              run = await tx.simulationSemesterRun.findUnique({
                where: { id: captured.run.id },
                include: { participants: { take: 501, orderBy: { capturedStudentId: 'asc' } } },
              });
              if (!run || run.jobId !== id || !captured.created) throw storedError();
            }
          }
          if (!run && failureCode === null) throw storedError();
          const execution = await tx.simulationSemesterAllocationExecution.create({
            data: {
              jobId: id,
              status: run ? 'SUCCEEDED' : 'FAILED',
              runId: run?.id ?? null,
              failureCode,
              completedAt: new Date(
                Math.max(Date.now(), selected.createdAt.getTime(), run?.createdAt.getTime() ?? 0),
              ),
            },
          });
          return {
            processed: true,
            outcome: verifyStoredSemesterAllocationJobOutcome(selected, { ...execution, run }),
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 3000,
          timeout: 30000,
        },
      );
    } catch (error) {
      if (retryable(error) && attempt < 4) continue;
      if (
        retryable(error) ||
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028')
      )
        throw new SchoolResourceError(
          'Could not confirm semester execution; inspect its outcome before retrying the same job',
          409,
        );
      throw error;
    }
  }
  throw storedError();
}

export async function readSemesterAllocationJobOutcome(actorId: string, jobId: string) {
  const actor = uuid.parse(actorId);
  const id = uuid.parse(jobId);
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
          const job = await tx.simulationSemesterAllocationJob.findUnique({
            where: { id },
            include,
          });
          if (!job) throw new SchoolResourceError('Semester simulation request not found', 404);
          const outcome = verifyStoredSemesterAllocationJobOutcome(job, job.execution);
          if (
            outcome.status !== 'SUCCEEDED' &&
            (await tx.simulationSemesterRun.findUnique({
              where: { jobId: id },
              select: { id: true },
            }))
          )
            throw storedError();
          return outcome;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          maxWait: 3000,
          timeout: 30000,
        },
      );
    } catch (error) {
      if (retryable(error) && attempt < 4) continue;
      if (
        retryable(error) ||
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028')
      )
        throw new SchoolResourceError(
          'Could not confirm the semester outcome; retry the same read',
          409,
        );
      throw error;
    }
  }
  throw storedError();
}
