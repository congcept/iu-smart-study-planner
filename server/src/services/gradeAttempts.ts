import { GradeAttempt, Prisma, Semester } from '@prisma/client';
import { prisma } from '../db';

export interface AppendGradeAttemptInput {
  courseId: string;
  requestId: string;
  score: number;
  semester?: Semester | null;
  year?: number | null;
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
  // Check retries before course lookup so a reused key always reports the original attempt.
  let attempt = await prisma.gradeAttempt.findUnique({ where });
  if (!attempt) {
    const course = await prisma.course.findUnique({
      where: { id: input.courseId },
      select: { id: true },
    });
    if (!course) throw new GradeAttemptError('Course not found', 404);
    try {
      // Empty update keeps immutable history and allows native atomic upsert when supported.
      attempt = await prisma.gradeAttempt.upsert({ where, create: payload, update: {} });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Concurrent retries can race when Prisma performs a read then insert.
        attempt = await prisma.gradeAttempt.findUnique({ where });
        if (!attempt) throw error;
      } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new GradeAttemptError('Course not found', 404);
      } else {
        throw error;
      }
    }
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
}
