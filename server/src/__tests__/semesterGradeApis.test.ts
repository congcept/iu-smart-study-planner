import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { prisma } from '../db';
import { checkRequestOrigin } from '../middleware/auth';
import gradesRouter from '../routes/grades';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(checkRequestOrigin);
app.use('/api/users/me/grades', gradesRouter);

describe('recorded semester GPA API (PostgreSQL)', () => {
  const prefix = `semester-grades-${randomUUID()}`;
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const contextId = randomUUID();
  const memberA = randomUUID();
  const memberB = randomUUID();
  const outsideId = randomUUID();
  const zeroId = randomUUID();
  const createdCourseIds: string[] = [memberA, memberB, outsideId, zeroId];
  let physicalId: string;
  const path = '/api/users/me/grades';
  const cookie = (id: string) => `${AUTH_COOKIE_NAME}=${issueToken(id)}`;
  const read = (id = ownerId) => request(app).get(path).set('Cookie', cookie(id));
  const append = (body: Record<string, unknown>, id = ownerId) =>
    request(app).post(path).set('Cookie', cookie(id)).send(body);
  const history = () =>
    prisma.gradeAttempt.findMany({
      where: { userId: { in: [ownerId, otherId] } },
      orderBy: [{ userId: 'asc' }, { id: 'asc' }],
    });
  const records = () =>
    prisma.studentRecord.findMany({
      where: { userId: { in: [ownerId, otherId] } },
      orderBy: [{ userId: 'asc' }, { courseId: 'asc' }],
    });

  beforeAll(async () => {
    await prisma.course.createMany({
      data: [
        { id: memberA, code: `${prefix}-A`, name: 'Member course A', credits: 3 },
        { id: memberB, code: `${prefix}-B`, name: 'Member course B', credits: 4 },
        { id: outsideId, code: `${prefix}-OUTSIDE`, name: 'Other curriculum', credits: 3 },
        { id: zeroId, code: `${prefix}-ZERO`, name: 'Zero credits', credits: 0 },
      ].map((course) => ({ ...course, difficultyLevel: 2 })),
    });
    const physical = await prisma.course.findUnique({ where: { code: 'PT001IU' } });
    if (physical) physicalId = physical.id;
    else {
      physicalId = randomUUID();
      createdCourseIds.push(physicalId);
      await prisma.course.create({
        data: {
          id: physicalId,
          code: 'PT001IU',
          name: 'Physical training',
          credits: 2,
          difficultyLevel: 1,
        },
      });
    }
    await prisma.curriculum.create({
      data: {
        id: contextId,
        code: `${prefix}-CTX`,
        name: 'Semester GPA reference curriculum',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
        isGpaPath: true,
      },
    });
    const membership = [memberA, memberB, zeroId].map((courseId, index) => ({
      id: randomUUID(),
      curriculumId: contextId,
      courseId,
      sourceOrder: index,
    }));
    await prisma.curriculumCourse.createMany({
      data: membership.map(({ id, curriculumId, courseId }) => ({ id, curriculumId, courseId })),
    });
    await prisma.curriculumPlacement.createMany({
      data: membership.map(({ id, sourceOrder }) => ({
        curriculumCourseId: id,
        academicYear: 1,
        academicSemester: sourceOrder + 1,
        sourceOrder: 1,
      })),
    });
    await prisma.user.createMany({
      data: [ownerId, otherId].map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        email: `${prefix}-${index}@example.test`,
        name: 'Semester GPA test',
        curriculumId: contextId,
      })),
    });
    await prisma.studentRecord.createMany({
      data: [memberA, memberB, outsideId, zeroId, physicalId].map((courseId) => ({
        userId: ownerId,
        courseId,
        status: 'COMPLETED' as const,
        grade: 'B+',
        gradePoints: 3.5,
        electiveGroup: 'Preserve claim',
        semester: 'Legacy term',
        year: 2024,
      })),
    });
    const seeded: Array<{
      userId: string;
      courseId: string;
      score: number;
      semester: 'FALL' | 'SPRING' | 'SUMMER' | null;
      year: number | null;
    }> = [
      { userId: ownerId, courseId: memberA, score: 55, semester: 'FALL', year: 2025 },
      { userId: ownerId, courseId: memberA, score: 88, semester: 'FALL', year: 2025 },
      { userId: ownerId, courseId: memberA, score: 95, semester: 'SPRING', year: 2026 },
      { userId: ownerId, courseId: memberA, score: 50, semester: null, year: 2026 },
      { userId: ownerId, courseId: memberB, score: 91, semester: 'FALL', year: 2025 },
      { userId: ownerId, courseId: memberB, score: 60, semester: null, year: null },
      { userId: ownerId, courseId: outsideId, score: 99, semester: 'SUMMER', year: 2024 },
      { userId: ownerId, courseId: zeroId, score: 98, semester: 'SUMMER', year: 2024 },
      { userId: ownerId, courseId: physicalId, score: 100, semester: 'SUMMER', year: 2024 },
      { userId: otherId, courseId: memberA, score: 50, semester: 'FALL', year: 2025 },
    ];
    await prisma.gradeAttempt.createMany({
      data: seeded.map((attempt) => ({ ...attempt, requestId: randomUUID() })),
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
    await prisma.curriculum.deleteMany({ where: { id: contextId } });
    await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
    await prisma.$disconnect();
  });

  it('returns ordered per-term GPA beside the unchanged cumulative summary', async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.body.data.scope).toEqual({
      userId: ownerId,
      curriculumId: contextId,
      isGpaPath: true,
    });
    expect(response.body.data.semesterGrades).toEqual({
      terms: [
        {
          year: 2025,
          semester: 'FALL',
          gpa100: expect.closeTo((88 * 3 + 91 * 4) / 7, 10),
          gradedCredits: 7,
          gradedCourseCount: 2,
        },
        {
          year: 2026,
          semester: 'SPRING',
          gpa100: 95,
          gradedCredits: 3,
          gradedCourseCount: 1,
        },
      ],
      undatedAttemptCount: 2,
    });
    expect(response.body.data.summary.gpa100).toBeCloseTo((95 * 3 + 91 * 4) / 7, 10);
    expect(response.body.data.summary).toMatchObject({
      gpaPath: 'THESIS',
      gradedCredits: 7,
      gradedCourseCount: 2,
    });
  });

  it('keeps nonmember, physical-training and zero-credit attempts in history only', async () => {
    const data = (await read()).body.data;
    expect(data.attempts).toHaveLength(9);
    expect(data.semesterGrades.terms.map((term: { year: number }) => term.year)).toEqual([
      2025, 2026,
    ]);
    expect(data.semesterGrades.undatedAttemptCount).toBe(2);
    expect(data.summary.courseScores.map(({ courseId }: { courseId: string }) => courseId)).toEqual(
      [memberA, memberB].sort((left, right) => left.localeCompare(right)),
    );
    expect(data.completedCoursesWithoutNumericGrades).toEqual([]);
  });

  it('reconciles an append with the same term grouping as a fresh read', async () => {
    const body = {
      courseId: memberB,
      requestId: randomUUID(),
      score: 70,
      semester: 'FALL',
      year: 2026,
    };
    const saved = await append(body);
    expect(saved.status).toBe(200);
    expect(saved.body.data.semesterGrades.terms).toEqual([
      expect.objectContaining({ year: 2025, semester: 'FALL' }),
      expect.objectContaining({ year: 2026, semester: 'FALL', gpa100: 70 }),
      expect.objectContaining({ year: 2026, semester: 'SPRING', gpa100: 95 }),
    ]);
    expect(saved.body.data.summary.gpa100).toBeCloseTo((95 * 3 + 91 * 4) / 7, 10);
    expect(saved.body.data.semesterGrades.undatedAttemptCount).toBe(2);
    expect((await read()).body.data).toEqual(saved.body.data);
  });

  it('isolates term evidence to the cookie account', async () => {
    expect((await read(otherId)).body.data.semesterGrades).toEqual({
      terms: [
        {
          year: 2025,
          semester: 'FALL',
          gpa100: 50,
          gradedCredits: 3,
          gradedCourseCount: 1,
        },
      ],
      undatedAttemptCount: 0,
    });
    expect((await read(otherId)).body.data.scope.userId).toBe(otherId);
  });

  it('reads term evidence without mutating attempts, records or legacy claims', async () => {
    const attemptsBefore = await history();
    const recordsBefore = await records();
    await read();
    const created = await append({ courseId: memberA, requestId: randomUUID(), score: 77 });
    expect(created.status).toBe(200);
    const after = await history();
    const previousIds = new Set(attemptsBefore.map(({ id }) => id));
    expect(after.filter(({ id }) => previousIds.has(id))).toEqual(attemptsBefore);
    expect(after.filter(({ id }) => !previousIds.has(id))).toEqual([
      expect.objectContaining({
        userId: ownerId,
        courseId: memberA,
        score: 77,
        semester: null,
        year: null,
      }),
    ]);
    expect(await records()).toEqual(recordsBefore);
  });
});
