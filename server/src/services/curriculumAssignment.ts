import { Prisma } from '@prisma/client';
import {
  AdminStudentsPageSchema,
  AssignReferenceCurriculumSchema,
  ListAdminStudentsSchema,
  ReferenceAssignmentSchema,
  type AdminStudentsPageDTO,
  type AdminStudentSummaryDTO,
  type AssignReferenceCurriculumDTO,
  type ListAdminStudentsDTO,
  type ReferenceAssignmentDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';

const PAGE_SIZE = 50;
const MAX_ATTEMPTS = 5;

export class CurriculumAssignmentError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

const retryable = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  (error.code === 'P2034' ||
    (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code))));

/**
 * The acting administrator is read FOR SHARE so a demotion cannot commit while the
 * assignment below is still deciding.
 */
async function lockActor(tx: Prisma.TransactionClient, actorId: string) {
  const rows = await tx.$queryRaw<{ id: string; role: string }[]>(Prisma.sql`
    SELECT id, role FROM users WHERE id = ${actorId} FOR SHARE
  `);
  const actor = rows[0];
  if (!actor) throw new CurriculumAssignmentError('Authentication required', 401);
  if (actor.role !== 'ADMIN')
    throw new CurriculumAssignmentError('Administrator access required', 403);
}

function page(after: string | null, rows: AdminStudentSummaryDTO[]): AdminStudentsPageDTO {
  const parsed = AdminStudentsPageSchema.safeParse({
    usage: 'REFERENCE_ONLY',
    pageSize: PAGE_SIZE,
    after,
    students: rows.slice(0, PAGE_SIZE),
    nextAfter: rows.length > PAGE_SIZE ? rows[PAGE_SIZE - 1].studentId : null,
  });
  if (!parsed.success)
    throw new Error(
      `Student accounts could not be verified: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'page'}: ${issue.message}`)
        .join('; ')}`,
    );
  return parsed.data;
}

export async function listAdminStudents(
  actorId: string,
  input: ListAdminStudentsDTO,
): Promise<AdminStudentsPageDTO> {
  const query = ListAdminStudentsSchema.parse(input);
  return prisma.$transaction(
    async (tx) => {
      await lockActor(tx, actorId);
      if (query.after !== undefined) {
        const continuation = await tx.user.findUnique({
          where: { studentId: query.after },
          select: { role: true },
        });
        if (!continuation || continuation.role !== 'STUDENT')
          throw new CurriculumAssignmentError(
            'This student list changed; reload before continuing',
            409,
          );
      }
      const rows = await tx.user.findMany({
        where: { role: 'STUDENT' },
        orderBy: { studentId: 'asc' },
        take: PAGE_SIZE + 1,
        ...(query.after === undefined ? {} : { cursor: { studentId: query.after }, skip: 1 }),
        select: {
          id: true,
          studentId: true,
          name: true,
          email: true,
          curriculumId: true,
          curriculum: { select: { id: true, code: true, name: true } },
        },
      });
      return page(query.after ?? null, rows);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

/**
 * Attaches or clears one reference curriculum. Only `users.curriculum_id` is written:
 * no record, attempt, rating, plan or receipt is created, changed or deleted.
 */
export async function assignReferenceCurriculum(
  actorId: string,
  userId: string,
  input: AssignReferenceCurriculumDTO,
): Promise<ReferenceAssignmentDTO> {
  const { curriculumId, expectedCurriculumId } = AssignReferenceCurriculumSchema.parse(input);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await lockActor(tx, actorId);
          const rows = await tx.$queryRaw<
            { id: string; role: string; curriculumId: string | null }[]
          >(Prisma.sql`
            SELECT id, role, curriculum_id AS "curriculumId" FROM users
            WHERE id = ${userId} FOR UPDATE
          `);
          const target = rows[0];
          if (!target) throw new CurriculumAssignmentError('Student account not found', 404);
          if (target.role !== 'STUDENT')
            throw new CurriculumAssignmentError(
              'Only student accounts can hold a reference curriculum',
              403,
            );
          if (target.curriculumId === curriculumId) return reply(target.id, curriculumId, false);
          if (curriculumId !== null) {
            const found = await tx.curriculum.findUnique({
              where: { id: curriculumId },
              select: { id: true },
            });
            if (!found) throw new CurriculumAssignmentError('Curriculum not found', 404);
          }
          if (target.curriculumId !== expectedCurriculumId)
            throw new CurriculumAssignmentError(
              'This account changed since it was loaded; reload before assigning',
              409,
            );
          await tx.user.update({ where: { id: target.id }, data: { curriculumId } });
          return reply(target.id, curriculumId, true);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (retryable(error)) {
        if (attempt < MAX_ATTEMPTS - 1) continue;
        throw new CurriculumAssignmentError(
          'This account changed while assigning; reload and retry',
          409,
        );
      }
      throw error;
    }
  }
  throw new CurriculumAssignmentError(
    'This account changed while assigning; reload and retry',
    409,
  );
}

function reply(userId: string, curriculumId: string | null, changed: boolean) {
  const parsed = ReferenceAssignmentSchema.safeParse({
    userId,
    curriculumId,
    usage: 'REFERENCE_ONLY',
    changed,
  });
  if (!parsed.success) throw new Error('Reference assignment could not be verified');
  return parsed.data;
}
