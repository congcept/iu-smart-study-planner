import { Prisma } from '@prisma/client';
import {
  CreateSemesterAllocationRunSchema,
  SemesterAllocationResultV1Schema,
  type CreateSemesterAllocationRunDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import { SchoolResourceError } from './schoolResources';
import {
  verifyStoredSemesterAllocationRun,
  projectSemesterAllocationRun,
  projectOwnSemesterAllocationRun,
  type StoredRun,
} from './semesterStoredVerification';
export {
  verifyStoredSemesterAllocationRun,
  projectSemesterAllocationRun,
  projectOwnSemesterAllocationRun,
} from './semesterStoredVerification';

const participants = { take: 501, orderBy: { capturedStudentId: 'asc' as const } };
const uuid = CreateSemesterAllocationRunSchema.shape.expectedActorId;
const storedError = () => new Error('Stored semester simulation could not be verified');

async function authorizeAdmin(tx: Prisma.TransactionClient, actorId: string, holdLock = false) {
  const account = holdLock
    ? (
        await tx.$queryRaw<{ id: string; role: string }[]>(Prisma.sql`
        SELECT id, role FROM users WHERE id = ${actorId} FOR SHARE
      `)
      )[0]
    : await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (!account) throw new SchoolResourceError('Authentication required', 401);
  if (account.role !== 'ADMIN') throw new SchoolResourceError('Administrator access required', 403);
}

function recover(row: StoredRun, request: CreateSemesterAllocationRunDTO) {
  const run = verifyStoredSemesterAllocationRun(row);
  const scope = run.result.envelope.scope;
  if (
    scope.curriculumId !== request.curriculumId ||
    scope.semester !== request.semester ||
    scope.year !== request.year
  )
    throw new SchoolResourceError('This retry key belongs to another simulation scenario', 409);
  return { created: false, run: projectSemesterAllocationRun(run) };
}

/** Caller must use Serializable isolation; hold current authorization through commit. */
export async function recoverSemesterAllocationRunInTransaction(
  tx: Prisma.TransactionClient,
  actorId: string,
  input: CreateSemesterAllocationRunDTO,
  jobId?: string,
) {
  const request = CreateSemesterAllocationRunSchema.parse(input);
  const actor = uuid.parse(actorId);
  await authorizeAdmin(tx, actor, true);
  if (request.expectedActorId !== actor)
    throw new SchoolResourceError('Your admin session changed; sign in again before saving', 409);
  const existing = await tx.simulationSemesterRun.findUnique({
    where: { createdById_requestId: { createdById: actor, requestId: request.requestId } },
    include: { participants },
  });
  if (existing && existing.jobId !== (jobId === undefined ? null : uuid.parse(jobId)))
    throw storedError();
  return existing ? recover(existing, request) : null;
}

/**
 * Trusted server-produced input only. Caller must use a Serializable transaction.
 * Existing-key recovery precedes parsing today's producer result or checking its cohort.
 */
export async function storeSemesterAllocationRunInTransaction(
  tx: Prisma.TransactionClient,
  actorId: string,
  input: CreateSemesterAllocationRunDTO,
  rawResult: unknown,
  capturedAt: Date,
  jobId?: string,
) {
  const request = CreateSemesterAllocationRunSchema.parse(input);
  const actor = uuid.parse(actorId);
  const existing = await recoverSemesterAllocationRunInTransaction(tx, actor, request, jobId);
  if (existing) return existing;
  const key = { createdById: actor, requestId: request.requestId };
  const result = SemesterAllocationResultV1Schema.parse(rawResult);
  const scope = result.envelope.scope;
  if (
    scope.curriculumId !== request.curriculumId ||
    scope.semester !== request.semester ||
    scope.year !== request.year
  )
    throw new SchoolResourceError('Simulation inputs do not match this scenario', 409);
  if (!Number.isFinite(capturedAt.getTime()) || capturedAt.getTime() > Date.now())
    throw new SchoolResourceError('Simulation capture time could not be verified', 409);
  if (
    !(await tx.curriculum.findUnique({ where: { id: scope.curriculumId }, select: { id: true } }))
  )
    throw new SchoolResourceError('Curriculum not found', 404);
  const ids = result.students.map((student) => student.studentId);
  const cohort = ids.length
    ? await tx.$queryRaw<{ id: string; role: string; curriculumId: string | null }[]>(Prisma.sql`
        SELECT id, role, curriculum_id AS "curriculumId" FROM users
        WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE
      `)
    : [];
  if (
    cohort.length !== ids.length ||
    cohort.some(
      (student) => student.role !== 'STUDENT' || student.curriculumId !== scope.curriculumId,
    )
  )
    throw new SchoolResourceError('Simulation participants changed; capture a fresh scenario', 409);
  const row = await tx.simulationSemesterRun.create({
    data: {
      ...scope,
      ...key,
      jobId: jobId === undefined ? null : uuid.parse(jobId),
      formatVersion: 1,
      capturedAt,
      createdAt: new Date(Math.max(Date.now(), capturedAt.getTime())),
      result: result as unknown as Prisma.InputJsonValue,
    },
  });
  if (result.students.length)
    await tx.simulationSemesterParticipant.createMany({
      data: result.students.map((student) => ({
        runId: row.id,
        capturedStudentId: student.studentId,
        userId: student.studentId,
        result: student as unknown as Prisma.InputJsonValue,
      })),
    });
  const saved = await tx.simulationSemesterRun.findUnique({
    where: { id: row.id },
    include: { participants },
  });
  if (!saved) throw storedError();
  return {
    created: true,
    run: projectSemesterAllocationRun(verifyStoredSemesterAllocationRun(saved)),
  };
}

/** No transport fallback: uncertain writes retain their exact actor/scenario retry key. */
export async function storeSemesterAllocationRun(
  actorId: string,
  input: CreateSemesterAllocationRunDTO,
  result: unknown,
  capturedAt: Date,
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        (tx) => storeSemesterAllocationRunInTransaction(tx, actorId, input, result, capturedAt),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 3000,
          timeout: 15000,
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const serialization =
          error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code));
        if ((['P2034', 'P2002'].includes(error.code) || serialization) && attempt < 4) continue;
        if (['P2034', 'P2002', 'P2003'].includes(error.code) || serialization)
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

export async function readSemesterAllocationRun(actorId: string, runId: string) {
  const actor = uuid.parse(actorId);
  const id = uuid.parse(runId);
  return prisma.$transaction(
    async (tx) => {
      await authorizeAdmin(tx, actor);
      const row = await tx.simulationSemesterRun.findUnique({
        where: { id },
        include: { participants },
      });
      if (!row) throw new SchoolResourceError('Semester simulation not found', 404);
      return projectSemesterAllocationRun(verifyStoredSemesterAllocationRun(row));
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function readOwnSemesterAllocationRun(actorId: string, runId: string) {
  const actor = uuid.parse(actorId);
  const id = uuid.parse(runId);
  return prisma.$transaction(
    async (tx) => {
      if (!(await tx.user.findUnique({ where: { id: actor }, select: { id: true } })))
        throw new SchoolResourceError('Authentication required', 401);
      const participant = await tx.simulationSemesterParticipant.findUnique({
        where: { runId_userId: { runId: id, userId: actor } },
      });
      // Authorization uses only the live access FK, never the retained captured identifier.
      if (!participant) throw new SchoolResourceError('Semester simulation not found', 404);
      const row = await tx.simulationSemesterRun.findUnique({
        where: { id },
        include: { participants },
      });
      if (!row) throw storedError();
      const run = verifyStoredSemesterAllocationRun(row);
      return projectOwnSemesterAllocationRun(run, participant.capturedStudentId);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
