import { randomUUID } from 'crypto';
import { Semester } from '@prisma/client';
import { prisma } from '../db';
import { appendGradeAttempt, readGradeAttempts } from '../services/gradeAttempts';

describe('numeric grade-attempt storage (PostgreSQL)', () => {
  const runId = randomUUID();
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const courseId = randomUUID();
  const otherCourseId = randomUUID();
  const prerequisiteId = randomUUID();
  const append = (score: number, requestId = randomUUID()) =>
    appendGradeAttempt(ownerId, { courseId, requestId, score });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [ownerId, otherId].map((id) => ({
        id,
        studentId: `grade-attempt-${id}`,
        name: 'Grade storage test',
        email: `${id}@example.test`,
      })),
    });
    await prisma.course.createMany({
      data: [courseId, otherCourseId, prerequisiteId].map((id) => ({
        id,
        code: `grade-attempt-${runId}-${id}`,
        name: 'Grade storage course',
        credits: 3,
        difficultyLevel: 2,
      })),
    });
    await prisma.prerequisite.create({
      data: { courseId, prerequisiteId, isStrict: false, isCorequisite: true },
    });
  });
  beforeEach(async () => {
    await prisma.gradeAttempt.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
    await prisma.studentRecord.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
    await prisma.course.deleteMany({
      where: { id: { in: [courseId, otherCourseId, prerequisiteId] } },
    });
    await prisma.$disconnect();
  });

  it('records a failed score independently of completion and unmet prerequisites', async () => {
    const attempt = await append(35);
    expect(attempt).toMatchObject({
      userId: ownerId,
      courseId,
      score: 35,
      semester: null,
      year: null,
    });
    expect(await prisma.studentRecord.count({ where: { userId: ownerId } })).toBe(0);
    expect(await readGradeAttempts(ownerId)).toEqual([attempt]);
  });

  it('retains every retake including lower and decimal scores with term metadata', async () => {
    const first = await appendGradeAttempt(ownerId, {
      courseId,
      requestId: randomUUID(),
      score: 54.5,
      semester: 'FALL',
      year: 2025,
    });
    const second = await appendGradeAttempt(ownerId, {
      courseId,
      requestId: randomUUID(),
      score: 89.25,
      semester: 'SPRING',
      year: 2026,
    });
    const third = await append(65);
    const attempts = await readGradeAttempts(ownerId);
    expect(attempts).toHaveLength(3);
    expect(attempts).toEqual(expect.arrayContaining([first, second, third]));
    expect(new Set(attempts.map((attempt) => attempt.id)).size).toBe(3);
  });

  it('returns the same immutable attempt on retry, normalizing absent term fields to null', async () => {
    const requestId = randomUUID();
    const first = await append(75, requestId);
    const retry = await appendGradeAttempt(ownerId, {
      courseId,
      requestId,
      score: 75,
      semester: null,
      year: null,
    });
    expect(retry).toEqual(first);
    expect(await prisma.gradeAttempt.count({ where: { userId: ownerId } })).toBe(1);
  });

  it.each([
    { score: 74 },
    { courseId: otherCourseId },
    { semester: Semester.FALL },
    { year: 2026 },
  ])(
    'rejects a reused request ID with changed payload %j without altering its original row',
    async (change) => {
      const requestId = randomUUID();
      const first = await append(75, requestId);
      await expect(
        appendGradeAttempt(ownerId, { courseId, requestId, score: 75, ...change }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await readGradeAttempts(ownerId)).toEqual([first]);
    },
  );

  it('scopes history and request IDs to the owner', async () => {
    const requestId = randomUUID();
    const owner = await append(75, requestId);
    const other = await appendGradeAttempt(otherId, { courseId, requestId, score: 20 });
    expect(await readGradeAttempts(ownerId)).toEqual([owner]);
    expect(await readGradeAttempts(otherId)).toEqual([other]);
    expect(await readGradeAttempts(randomUUID())).toEqual([]);
  });

  it('rejects an unknown course before creating history', async () => {
    await expect(
      appendGradeAttempt(ownerId, { courseId: randomUUID(), requestId: randomUUID(), score: 70 }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await readGradeAttempts(ownerId)).toEqual([]);
  });

  it('preserves every legacy record field while adding numeric attempts', async () => {
    const legacy = await prisma.studentRecord.create({
      data: {
        userId: ownerId,
        courseId,
        status: 'COMPLETED',
        grade: 'B+',
        gradePoints: 3.5,
        semester: 'Legacy Fall',
        year: 2024,
        electiveGroup: 'Elective Group 2',
      },
    });
    await append(42);
    await append(95);
    expect(await prisma.studentRecord.findUniqueOrThrow({ where: { id: legacy.id } })).toEqual(
      legacy,
    );
  });

  it('creates only one attempt for simultaneous identical retries', async () => {
    const requestId = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 }, () => append(77.5, requestId)));
    expect(new Set(results.map((attempt) => attempt.id)).size).toBe(1);
    expect(results.every((attempt) => attempt.score === 77.5)).toBe(true);
    expect(await readGradeAttempts(ownerId)).toHaveLength(1);
  });

  it('lets only one competing payload use a request ID', async () => {
    const requestId = randomUUID();
    const results = await Promise.allSettled([append(60, requestId), append(90, requestId)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason).toMatchObject({ status: 409 });
    expect(await readGradeAttempts(ownerId)).toHaveLength(1);
  });

  it.each([0, 100])('accepts score boundary %s', async (score) => {
    expect((await append(score)).score).toBe(score);
  });

  it.each(['-1', '101', 'NaN', 'Infinity', '-Infinity'])(
    'enforces finite 0–100 scores at the database boundary for %s',
    async (score) => {
      await expect(prisma.$executeRaw`
      INSERT INTO "grade_attempts" ("id", "user_id", "course_id", "request_id", "score")
      VALUES (${randomUUID()}, ${ownerId}, ${courseId}, ${randomUUID()}::UUID, ${score}::DOUBLE PRECISION)
    `).rejects.toMatchObject({ code: 'P2010', meta: { code: '23514' } });
      expect(await readGradeAttempts(ownerId)).toEqual([]);
    },
  );

  it.each([1999, 2101])('enforces year bounds at the database boundary for %s', async (year) => {
    await expect(prisma.$executeRaw`
      INSERT INTO "grade_attempts" ("id", "user_id", "course_id", "request_id", "score", "year")
      VALUES (${randomUUID()}, ${ownerId}, ${courseId}, ${randomUUID()}::UUID, 75, ${year})
    `).rejects.toMatchObject({ code: 'P2010', meta: { code: '23514' } });
    expect(await readGradeAttempts(ownerId)).toEqual([]);
  });

  it('cascades attempt history when its owner is removed', async () => {
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        studentId: `grade-delete-${userId}`,
        name: 'Temporary owner',
        email: `${userId}@example.test`,
      },
    });
    try {
      await appendGradeAttempt(userId, { courseId, requestId: randomUUID(), score: 70 });
      await prisma.user.delete({ where: { id: userId } });
      expect(await readGradeAttempts(userId)).toEqual([]);
    } finally {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });

  it('cascades attempt history when its course is removed', async () => {
    const id = randomUUID();
    await prisma.course.create({
      data: {
        id,
        code: `grade-delete-${id}`,
        name: 'Temporary course',
        credits: 3,
        difficultyLevel: 2,
      },
    });
    try {
      await appendGradeAttempt(ownerId, { courseId: id, requestId: randomUUID(), score: 70 });
      await prisma.course.delete({ where: { id } });
      expect(await readGradeAttempts(ownerId)).toEqual([]);
    } finally {
      await prisma.course.deleteMany({ where: { id } });
    }
  });
});
