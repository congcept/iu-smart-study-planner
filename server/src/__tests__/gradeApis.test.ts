import { randomUUID } from 'crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { AppendGradeAttemptSchema } from '@iu-study-planner/shared';
import { prisma } from '../db';
import config from '../config';
import { checkRequestOrigin } from '../middleware/auth';
import gradesRouter from '../routes/grades';
import { AUTH_COOKIE_NAME, AUTH_TOKEN_OPTIONS, issueToken } from '../services/authService';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(checkRequestOrigin);
app.use('/api/users/me/grades', gradesRouter);

describe('numeric grade APIs (PostgreSQL)', () => {
  const prefix = `grade-api-${randomUUID()}`;
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const adminId = randomUUID();
  const courseA = randomUUID();
  const courseB = randomUUID();
  const zeroId = randomUUID();
  const createdCourseIds: string[] = [courseA, courseB, zeroId];
  let physicalId: string;
  const path = '/api/users/me/grades';
  const cookie = (id: string) => `${AUTH_COOKIE_NAME}=${issueToken(id)}`;
  const read = (id = ownerId) => request(app).get(path).set('Cookie', cookie(id));
  const input = (overrides: Record<string, unknown> = {}) => ({
    courseId: courseA,
    requestId: randomUUID(),
    score: 80,
    ...overrides,
  });
  const append = (body: Record<string, unknown>, id = ownerId) =>
    request(app).post(path).set('Cookie', cookie(id)).send(body);
  const records = () =>
    prisma.studentRecord.findMany({ where: { userId: ownerId }, orderBy: { courseId: 'asc' } });
  const history = () =>
    prisma.gradeAttempt.findMany({ where: { userId: ownerId }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [ownerId, otherId, adminId].map((id) => ({
        id,
        studentId: `${prefix}-${id}`,
        name: 'Grade API test',
        email: `${prefix}-${id}@example.test`,
        role: id === adminId ? 'ADMIN' : 'STUDENT',
      })),
    });
    await prisma.course.createMany({
      data: [
        { id: courseA, code: `${prefix}-A`, name: 'Three credits', credits: 3, difficultyLevel: 2 },
        { id: courseB, code: `${prefix}-B`, name: 'Four credits', credits: 4, difficultyLevel: 3 },
        {
          id: zeroId,
          code: `${prefix}-ZERO`,
          name: 'Zero credits',
          credits: 0,
          difficultyLevel: 1,
        },
      ],
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
  });

  beforeEach(async () => {
    await prisma.gradeAttempt.deleteMany({
      where: { userId: { in: [ownerId, otherId, adminId] } },
    });
    await prisma.studentRecord.deleteMany({ where: { userId: ownerId } });
    await prisma.studentRecord.createMany({
      data: [
        {
          userId: ownerId,
          courseId: courseA,
          status: 'COMPLETED',
          grade: 'A',
          gradePoints: 4,
          electiveGroup: 'Keep original claim',
          semester: 'Legacy term',
          year: 2025,
        },
        { userId: ownerId, courseId: courseB, status: 'COMPLETED' },
        { userId: ownerId, courseId: physicalId, status: 'COMPLETED' },
        { userId: ownerId, courseId: zeroId, status: 'COMPLETED' },
      ],
    });
    await prisma.gradeAttempt.create({
      data: { userId: otherId, courseId: courseA, requestId: randomUUID(), score: 99 },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { studentId: { startsWith: prefix } } });
    await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
    await prisma.$disconnect();
  });

  it('reports null GPA and numeric coverage without converting legacy grades or counting PT/zero credits', async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      attempts: [],
      summary: {
        gpa100: null,
        gpaPath: null,
        gradedCredits: 0,
        gradedCourseCount: 0,
        courseScores: [],
      },
      completedCoursesWithoutNumericGrades: [courseA, courseB].sort(),
    });
  });

  it('returns a server path at and just above the threshold on append and read', async () => {
    const boundary = await append(input({ score: 70 }));
    expect(boundary.body.data.summary.gpaPath).toBe('ALTERNATIVE');
    const above = await append(input({ score: 70.004 }));
    expect(above.body.data.summary.gpaPath).toBe('THESIS');
    expect((await read()).body.data.summary.gpaPath).toBe('THESIS');
  });

  it('preserves exact decimal boundary policy through PostgreSQL and API serialization', async () => {
    // Fixture credits: A=3, B=4. Weighted sum (93.32*3 + 52.51*4) = 490 exactly.
    await append(input({ score: 93.32 }));
    const response = await append(input({ courseId: courseB, score: 52.51 }));
    expect(response.body.data.summary.gpa100).toBe(70);
    expect(response.body.data.summary.gpaPath).toBe('ALTERNATIVE');
    expect((await read()).body.data.summary.gpaPath).toBe('ALTERNATIVE');
  });

  it('keeps highest-retake policy and changes paths when another scored course lowers GPA', async () => {
    await append(input({ score: 80 }));
    const lowerRetake = await append(input({ score: 20 }));
    expect(lowerRetake.body.data.summary.gpaPath).toBe('THESIS');
    const anotherCourse = await append(input({ courseId: courseB, score: 40 }));
    expect(anotherCourse.body.data.summary.gpaPath).toBe('ALTERNATIVE');
    expect((await read()).body.data.summary.gpaPath).toBe('ALTERNATIVE');
  });

  it('isolates GPA paths to the cookie account, ignoring another user query', async () => {
    await append(input({ score: 0 }));
    const owner = await request(app)
      .get(`${path}?userId=${otherId}`)
      .set('Cookie', cookie(ownerId));
    expect(owner.body.data.summary.gpaPath).toBe('ALTERNATIVE');
    expect((await read(otherId)).body.data.summary.gpaPath).toBe('THESIS');
    expect((await read(adminId)).body.data.summary.gpaPath).toBeNull();
  });

  it('includes score zero and preserves every existing progress/grade/claim field', async () => {
    const before = await records();
    const response = await append(input({ score: 0, semester: 'FALL', year: 2026 }));
    expect(response.status).toBe(200);
    expect(response.body.data.summary).toMatchObject({
      gpa100: 0,
      gradedCredits: 3,
      gradedCourseCount: 1,
    });
    expect(response.body.data.attempts[0]).toMatchObject({
      courseId: courseA,
      score: 0,
      semester: 'FALL',
      year: 2026,
      course: { id: courseA, credits: 3, name: 'Three credits' },
    });
    expect(response.body.data.attempts[0]).not.toHaveProperty('userId');
    expect(response.body.data.completedCoursesWithoutNumericGrades).toEqual([courseB]);
    expect(await records()).toEqual(before);
  });

  it('returns full immutable history and highest-score credit-weighted GPA', async () => {
    await append(input({ score: 84.125 }));
    await append(input({ score: 42 }));
    const response = await append(input({ courseId: courseB, score: 60 }));
    expect(response.status).toBe(200);
    expect(response.body.data.attempts).toHaveLength(3);
    expect(response.body.data.summary.gpa100).toBeCloseTo((84.125 * 3 + 60 * 4) / 7, 10);
    expect(response.body.data.summary).toMatchObject({ gradedCredits: 7, gradedCourseCount: 2 });
    expect(response.body.data.completedCoursesWithoutNumericGrades).toEqual([]);
    expect((await read()).body.data).toEqual(response.body.data);
  });

  it('retries the same request without creating another attempt or changing timestamps', async () => {
    const body = input();
    const first = await append(body);
    const before = await history();
    const retry = await append(body);
    expect(retry.status).toBe(200);
    expect(retry.body.data).toEqual(first.body.data);
    expect(await history()).toEqual(before);
  });

  it.each(['score', 'courseId', 'semester', 'year'])(
    'rejects a reused request ID with a different %s',
    async (field) => {
      const body = input({ semester: 'FALL', year: 2026 });
      await append(body);
      const before = await history();
      const changed = { score: 75, courseId: courseB, semester: 'SPRING', year: 2027 };
      expect(
        (await append({ ...body, [field]: changed[field as keyof typeof changed] })).status,
      ).toBe(409);
      expect(await history()).toEqual(before);
    },
  );

  it('rejects unknown courses without partial changes', async () => {
    const before = await records();
    expect((await append(input({ courseId: randomUUID() }))).status).toBe(404);
    expect(await history()).toEqual([]);
    expect(await records()).toEqual(before);
  });

  it('normalizes UUID casing for equivalent retry payloads', async () => {
    const body = input();
    expect(
      (
        await append({
          ...body,
          courseId: body.courseId.toUpperCase(),
          requestId: body.requestId.toUpperCase(),
        })
      ).status,
    ).toBe(200);
    expect((await append(body)).body.data.attempts).toHaveLength(1);
  });

  it('isolates cookie owners and keeps admin reads scoped to their own account', async () => {
    await append(input());
    expect((await read(otherId)).body.data.attempts).toEqual([
      expect.objectContaining({ score: 99 }),
    ]);
    const own = await read().query({ userId: otherId });
    expect(own.body.data.attempts).toEqual([expect.objectContaining({ score: 80 })]);
    expect((await read(adminId)).body.data.attempts).toEqual([]);
    expect((await append(input({ userId: otherId }))).status).toBe(400);
  });

  it('can record scores without completing courses and keeps history after uncompletion', async () => {
    await prisma.studentRecord.deleteMany({ where: { userId: ownerId, courseId: courseA } });
    expect((await append(input())).status).toBe(200);
    expect(
      await prisma.studentRecord.findUnique({
        where: { userId_courseId: { userId: ownerId, courseId: courseA } },
      }),
    ).toBeNull();
    expect((await read()).body.data.summary.gpa100).toBe(80);
  });

  it('retains PT/zero-credit history but excludes those scores from GPA', async () => {
    await append(input({ courseId: physicalId, score: 100 }));
    const response = await append(input({ courseId: zeroId, score: 100 }));
    expect(response.body.data.attempts).toHaveLength(2);
    expect(response.body.data.summary.gpa100).toBeNull();
    expect(response.body.data.summary.gradedCredits).toBe(0);
  });

  const invalid = [
    { score: -1 },
    { score: 101 },
    { score: null },
    { score: '80' },
    { courseId: 'invalid' },
    { requestId: 'invalid' },
    { semester: 'WINTER' },
    { semester: null },
    { year: 1999 },
    { year: 2101 },
    { year: 2026.5 },
    { year: null },
    { gradePoints: 4 },
    { grade: 'A' },
    { status: 'COMPLETED' },
    { userId: randomUUID() },
    { electiveGroup: 'Group 1' },
  ];
  it.each(invalid)('rejects malformed or unsupported fields %# atomically', async (override) => {
    const before = await records();
    expect((await append(input(override))).status).toBe(400);
    expect(await history()).toEqual([]);
    expect(await records()).toEqual(before);
  });

  it('requires both numeric score and a stable request ID', async () => {
    expect((await append({ courseId: courseA, score: 70 })).status).toBe(400);
    expect((await append({ courseId: courseA, requestId: randomUUID() })).status).toBe(400);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'schema rejects non-finite score %s',
    (score) => {
      expect(AppendGradeAttemptSchema.safeParse(input({ score })).success).toBe(false);
    },
  );

  it.each(['absent', 'malformed', 'expired'])(
    'requires a valid cookie for GET and POST (%s)',
    async (kind) => {
      const token =
        kind === 'expired'
          ? jwt.sign({}, config.jwtSecret, {
              ...AUTH_TOKEN_OPTIONS,
              subject: ownerId,
              expiresIn: -1,
            })
          : 'malformed';
      const get = request(app).get(path);
      const post = request(app).post(path).send(input());
      if (kind !== 'absent') {
        get.set('Cookie', `${AUTH_COOKIE_NAME}=${token}`);
        post.set('Cookie', `${AUTH_COOKIE_NAME}=${token}`);
      }
      expect((await get).status).toBe(401);
      expect((await post).status).toBe(401);
      expect(await history()).toEqual([]);
    },
  );

  it('rejects hostile browser origins and accepts the configured frontend', async () => {
    const before = await records();
    expect((await append(input()).set('Origin', 'https://hostile.example')).status).toBe(403);
    expect((await append(input()).set('Sec-Fetch-Site', 'cross-site')).status).toBe(403);
    expect(await history()).toEqual([]);
    expect(await records()).toEqual(before);
    expect((await append(input()).set('Origin', config.corsOrigin)).status).toBe(200);
  });
});
