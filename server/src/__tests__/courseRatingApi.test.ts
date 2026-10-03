import { randomUUID } from 'crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { RateCourseSchema } from '@iu-study-planner/shared';
import config from '../config';
import { prisma } from '../db';
import { checkRequestOrigin } from '../middleware/auth';
import router from '../routes/courseRatings';
import { AUTH_COOKIE_NAME, AUTH_TOKEN_OPTIONS, issueToken } from '../services/authService';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(checkRequestOrigin);
app.use('/api/courses', router);
describe('course-rating APIs (PostgreSQL)', () => {
  const prefix = `rating-api-${randomUUID()}`;
  const users: string[] = Array.from({ length: 4 }, () => randomUUID());
  const courses: string[] = [randomUUID(), randomUUID()];
  const cookie = (id = users[0]) => `${AUTH_COOKIE_NAME}=${issueToken(id)}`;
  const post = (body: unknown, id = users[0], courseId = courses[0]) =>
    request(app)
      .post(`/api/courses/${courseId}/rate`)
      .set('Cookie', cookie(id))
      .send(body as Record<string, unknown>);
  const get = (id = courses[0]) => request(app).get(`/api/courses/${id}/ratings`);
  const currentHour = () => new Date(Math.floor(Date.now() / 3600000) * 3600000);
  const votes = () =>
    prisma.courseRating.findMany({ where: { courseId: { in: courses } }, orderBy: { id: 'asc' } });
  const quota = (writeCount: number, windowStart = currentHour()) =>
    prisma.ratingWriteLimit.create({ data: { userId: users[0], writeCount, windowStart } });
  beforeAll(async () => {
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-${id}`,
        email: `${id}@example.test`,
        name: 'Rating API test',
        role: index === 3 ? 'ADMIN' : 'STUDENT',
      })),
    });
    await prisma.course.createMany({
      data: courses.map((id) => ({
        id,
        code: `${prefix}-${id}`,
        name: 'Rating API course',
        credits: 3,
        difficultyLevel: 2,
      })),
    });
  });
  beforeEach(async () => {
    await prisma.courseRating.deleteMany({ where: { courseId: { in: courses } } });
    await prisma.ratingWriteLimit.deleteMany({ where: { userId: { in: users } } });
    await prisma.studentRecord.deleteMany({ where: { userId: { in: users } } });
    await prisma.studentRecord.createMany({
      data: users.flatMap((userId) =>
        courses.map((courseId) => ({
          userId,
          courseId,
          status: 'COMPLETED' as const,
          grade: 'B+',
          gradePoints: 3.5,
          electiveGroup: 'Keep claim',
        })),
      ),
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { studentId: { startsWith: prefix } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
    await prisma.$disconnect();
  });
  it('allows a public aggregate read without revealing account identities', async () => {
    await post({ rating: 4 });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      average: 4,
      count: 1,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 },
    });
    expect(JSON.stringify(response.body)).not.toContain(users[0]);
    expect(response.body.data.yourRating).toBeUndefined();
  });
  it('uses the global seed mean for cold start when there are no global votes', async () => {
    const aggregate = await prisma.courseRating.aggregate({ _count: true });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      average: null,
      count: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
    if (aggregate._count === 0) {
      const mean = await prisma.course.aggregate({ _avg: { difficultyLevel: true } });
      expect(response.body.data.priorSource).toBe('GLOBAL_SEED');
      expect(response.body.data.difficulty).toBe(mean._avg.difficultyLevel);
    } else {
      const mean = await prisma.courseRating.aggregate({ _avg: { rating: true } });
      expect(response.body.data.difficulty).toBe(mean._avg.rating);
    }
  });
  it('returns an exact shared rated mean for a zero-rating course', async () => {
    await post({ rating: 1 });
    await post({ rating: 5 }, users[1]);
    const mean = await prisma.courseRating.aggregate({ _avg: { rating: true } });
    const response = await get(courses[1]);
    expect(response.body.data).toMatchObject({
      count: 0,
      average: null,
      priorSource: 'GLOBAL_RATINGS',
      difficulty: mean._avg.rating,
      priorMean: mean._avg.rating,
    });
  });
  it('uses Bayesian shrinkage and returns confidence with a mixed distribution', async () => {
    await post({ rating: 1 }, users[0], courses[1]);
    await post({ rating: 5 });
    await post({ rating: 3 }, users[1]);
    const response = await get();
    const mean = await prisma.courseRating.aggregate({ _avg: { rating: true } });
    expect(response.body.data.average).toBe(4);
    expect(response.body.data.count).toBe(2);
    expect(response.body.data.difficulty).toBeCloseTo((8 + mean._avg.rating! * 5) / 7, 14);
    expect(response.body.data.distribution).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 1 });
  });
  it('requires an authenticated session for writes', async () => {
    const response = await request(app).post(`/api/courses/${courses[0]}/rate`).send({ rating: 3 });
    expect(response.status).toBe(401);
    expect(await votes()).toEqual([]);
  });
  it('rejects an expired cookie', async () => {
    const token = jwt.sign({ sub: users[0] }, config.jwtSecret, {
      ...AUTH_TOKEN_OPTIONS,
      expiresIn: -1,
    });
    const response = await request(app)
      .post(`/api/courses/${courses[0]}/rate`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${token}`)
      .send({ rating: 3 });
    expect(response.status).toBe(401);
  });
  it('rejects an unknown account cookie', async () => {
    expect((await post({ rating: 3 }, randomUUID())).status).toBe(401);
  });
  it('rejects writes from an untrusted origin', async () => {
    const response = await request(app)
      .post(`/api/courses/${courses[0]}/rate`)
      .set('Cookie', cookie())
      .set('Origin', 'https://untrusted.example')
      .send({ rating: 3 });
    expect(response.status).toBe(403);
    expect(await votes()).toEqual([]);
  });
  it('allows same-origin completed students to submit their own rating', async () => {
    const response = await request(app)
      .post(`/api/courses/${courses[0]}/rate`)
      .set('Cookie', cookie())
      .set('Origin', config.corsOrigin)
      .send({ rating: 3 });
    expect(response.status).toBe(200);
    expect(response.body.data.yourRating).toBe(3);
  });
  it.each(['PLANNED', 'IN_PROGRESS', 'FAILED', 'DROPPED'] as const)(
    'rejects status%s despite existing grade metadata',
    async (status) => {
      await prisma.studentRecord.update({
        where: { userId_courseId: { userId: users[0], courseId: courses[0] } },
        data: { status },
      });
      expect((await post({ rating: 3 })).status).toBe(403);
      expect(await votes()).toEqual([]);
      expect(await prisma.ratingWriteLimit.count({ where: { userId: users[0] } })).toBe(0);
    },
  );
  it('rejects a missing completion and cannot borrow another student’s completion', async () => {
    await prisma.studentRecord.delete({
      where: { userId_courseId: { userId: users[0], courseId: courses[0] } },
    });
    expect((await post({ rating: 3 })).status).toBe(403);
  });
  it('applies the same completion policy to administrators', async () => {
    await prisma.studentRecord.delete({
      where: { userId_courseId: { userId: users[3], courseId: courses[0] } },
    });
    expect((await post({ rating: 3 }, users[3])).status).toBe(403);
    expect((await post({ rating: 3 }, users[3], courses[1])).status).toBe(200);
  });
  it.each([
    {},
    { rating: 0 },
    { rating: 6 },
    { rating: 2.5 },
    { rating: '3' },
    { rating: null },
    { rating: true },
    { rating: 3, userId: 'spoof' },
    { rating: 3, courseId: 'spoof' },
  ])('rejects malformed or extra payload %j before writing', async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(await votes()).toEqual([]);
    expect(await prisma.ratingWriteLimit.count({ where: { userId: users[0] } })).toBe(0);
  });
  it.each([1, 5])('accepts scale boundary%s', async (rating) => {
    expect((await post({ rating })).body.data.yourRating).toBe(rating);
  });
  it('rejects malformed IDs and reports absent courses consistently', async () => {
    expect((await get('invalid')).status).toBe(400);
    expect((await post({ rating: 3 }, users[0], 'invalid')).status).toBe(400);
    expect((await get(randomUUID())).status).toBe(404);
    expect((await post({ rating: 3 }, users[0], randomUUID())).status).toBe(404);
  });
  it('normalizes an uppercase course UUID', async () => {
    expect((await post({ rating: 3 }, users[0], courses[0].toUpperCase())).status).toBe(200);
    expect((await get(courses[0].toUpperCase())).status).toBe(200);
  });
  it('upserts changes and preserves progress, legacy grades and the seed difficulty', async () => {
    const before = await prisma.studentRecord.findMany({
      where: { userId: users[0] },
      orderBy: { id: 'asc' },
    });
    await post({ rating: 2 });
    const changed = await post({ rating: 5 });
    expect(changed.body.data).toMatchObject({ average: 5, count: 1, yourRating: 5 });
    expect(await votes()).toHaveLength(1);
    expect(
      await prisma.studentRecord.findMany({ where: { userId: users[0] }, orderBy: { id: 'asc' } }),
    ).toEqual(before);
    expect(
      (await prisma.course.findUniqueOrThrow({ where: { id: courses[0] } })).difficultyLevel,
    ).toBe(2);
  });
  it('keeps identical retries idempotent without consuming another write', async () => {
    await post({ rating: 3 });
    await post({ rating: 3 });
    expect(
      (await prisma.ratingWriteLimit.findUniqueOrThrow({ where: { userId: users[0] } })).writeCount,
    ).toBe(1);
    expect(await votes()).toHaveLength(1);
  });
  it('rejects the next changed vote at the persisted cap with Retry-After and no partial write', async () => {
    await quota(config.ratingWritesPerHour);
    const response = await post({ rating: 3 });
    expect(response.status).toBe(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(response.headers['retry-after'])).toBeLessThanOrEqual(3600);
    expect(await votes()).toEqual([]);
    expect(
      (await prisma.ratingWriteLimit.findUniqueOrThrow({ where: { userId: users[0] } })).writeCount,
    ).toBe(config.ratingWritesPerHour);
  });
  it('allows an identical retry even when the changed-vote cap is reached', async () => {
    await post({ rating: 3 });
    await prisma.ratingWriteLimit.update({
      where: { userId: users[0] },
      data: { writeCount: config.ratingWritesPerHour },
    });
    expect((await post({ rating: 3 })).status).toBe(200);
    expect((await post({ rating: 4 })).status).toBe(429);
  });
  it('resets an expired quota window and isolates accounts', async () => {
    await quota(config.ratingWritesPerHour, new Date(currentHour().getTime() - 3600000));
    expect((await post({ rating: 3 })).status).toBe(200);
    await prisma.ratingWriteLimit.update({
      where: { userId: users[0] },
      data: { writeCount: config.ratingWritesPerHour },
    });
    expect((await post({ rating: 5 }, users[1])).status).toBe(200);
  });
  it('enforces the final remaining quota slot across concurrent courses', async () => {
    await quota(config.ratingWritesPerHour - 1);
    const responses = await Promise.all([
      post({ rating: 2 }),
      post({ rating: 4 }, users[0], courses[1]),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 429]);
    expect(await votes()).toHaveLength(1);
    expect(
      (await prisma.ratingWriteLimit.findUniqueOrThrow({ where: { userId: users[0] } })).writeCount,
    ).toBe(config.ratingWritesPerHour);
  });
  it('keeps concurrent identical retries as one vote and one quota write', async () => {
    const responses = await Promise.all(Array.from({ length: 4 }, () => post({ rating: 4 })));
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(await votes()).toHaveLength(1);
    expect(
      (await prisma.ratingWriteLimit.findUniqueOrThrow({ where: { userId: users[0] } })).writeCount,
    ).toBe(1);
  });
  it('keeps concurrent votes from different accounts and courses consistent', async () => {
    const responses = await Promise.all(
      users.map((userId, index) => post({ rating: index + 2 }, userId, courses[index % 2])),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    expect(await votes()).toHaveLength(4);
    expect((await get(courses[0])).body.data).toMatchObject({ average: 3, count: 2 });
    expect((await get(courses[1])).body.data).toMatchObject({ average: 4, count: 2 });
  });
  it('rejects a changed rating after completion is removed while retaining the historical vote', async () => {
    await post({ rating: 4 });
    await prisma.studentRecord.delete({
      where: { userId_courseId: { userId: users[0], courseId: courses[0] } },
    });
    expect((await post({ rating: 2 })).status).toBe(403);
    expect((await get()).body.data).toMatchObject({ average: 4, count: 1 });
  });
  it('rejects nonfinite values at the shared-schema boundary', () => {
    for (const rating of [Number.NaN, Infinity, -Infinity])
      expect(RateCourseSchema.safeParse({ rating }).success).toBe(false);
  });
});
