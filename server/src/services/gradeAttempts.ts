import { GradeAttempt, Prisma, Semester } from '@prisma/client';
import { prisma } from '../db';

export interface AppendGradeAttemptInput {
  courseId: string;
  requestId: string;
  score: number;
  semester?: Semester | null;
  year?: number | null;
  expectedScope?: { userId: string; curriculumId: string | null };
}

export class GradeAttemptError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'GradeAttemptError';
  }
}

export async function readGradeAttempts(userId: string): Promise<GradeAttempt[]> {
  return prisma.gradeAttempt.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
}

export async function appendGradeAttempt(
  userId: string,
  input: AppendGradeAttemptInput,
): Promise<GradeAttempt> {
  if (input.expectedScope && input.expectedScope.userId.toLowerCase() !== userId.toLowerCase())
    throw new GradeAttemptError(
      'The signed-in account changed. Reload your session before saving a score',
      409,
    );
  if (!Number.isFinite(input.score) || input.score < 0 || input.score > 100) {
    throw new GradeAttemptError('Score must be a finite number between 0 and 100', 400);
  }
  if (
    input.year != null &&
    (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100)
  ) {
    throw new GradeAttemptError('Year must be between 2000 and 2100', 400);
  }
  const payload = {
    userId,
    courseId: input.courseId,
    requestId: input.requestId,
    score: input.score,
    semester: input.semester ?? null,
    year: input.year ?? null,
  };
  const where = { userId_requestId: { userId, requestId: input.requestId } };
  for (let retry = 0; retry < 5; retry++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Recover immutable retries before checking current membership. A context
          // change must not turn an already committed attempt into a new write.
          let attempt = await tx.gradeAttempt.findUnique({ where });
          if (!attempt) {
            const user = await tx.user.findUnique({
              where: { id: userId },
              select: { curriculumId: true },
            });
            if (!user) throw new GradeAttemptError('User not found', 404);
            if (
              input.expectedScope &&
              input.expectedScope.curriculumId?.toLowerCase() !== user.curriculumId?.toLowerCase()
            )
              throw new GradeAttemptError(
                'Your curriculum changed. Reload grade-entry courses before saving a score',
                409,
              );
            const course = await tx.course.findUnique({
              where: { id: input.courseId },
              select: { id: true },
            });
            if (!course) throw new GradeAttemptError('Course not found', 404);
            if (user.curriculumId) {
              const member = await tx.curriculumCourse.findUnique({
                where: {
                  curriculumId_courseId: {
                    curriculumId: user.curriculumId,
                    courseId: input.courseId,
                  },
                },
                select: { placements: { take: 1, select: { id: true } } },
              });
              if (!member || member.placements.length === 0)
                throw new GradeAttemptError('Course is not placed in the assigned curriculum', 409);
            }
            attempt = await tx.gradeAttempt.upsert({ where, create: payload, update: {} });
          }
          if (
            attempt.courseId !== payload.courseId ||
            attempt.score !== payload.score ||
            attempt.semester !== payload.semester ||
            attempt.year !== payload.year
          ) {
            throw new GradeAttemptError(
              'This request ID was already used for a different grade attempt',
              409,
            );
          }
          return attempt;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (['P2034', 'P2002'].includes(error.code)) continue;
        if (error.code === 'P2003') throw new GradeAttemptError('Course or owner not found', 404);
      }
      throw error;
    }
  }
  throw new GradeAttemptError('Grade history changed concurrently; retry this request', 409);
}
