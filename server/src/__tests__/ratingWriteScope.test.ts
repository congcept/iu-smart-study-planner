import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import type { AccountWriteScopeDTO } from '@iu-study-planner/shared';
import config from '../config';
import { prisma } from '../db';
import { checkRequestOrigin } from '../middleware/auth';
import router from '../routes/courseRatings';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { submitCourseRating } from '../services/courseRatings';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(checkRequestOrigin);
app.use('/api/courses', router);

describe('rating write owner/context preconditions (PostgreSQL)', () => {
  const prefix = `rating-scope-${randomUUID()}`;
  const users = [randomUUID(), randomUUID()];
  const contexts = [randomUUID(), randomUUID()];
  const courses = [randomUUID(), randomUUID()];
  const scope = (
    curriculumId: string | null = contexts[0],
    userId = users[0],
  ): AccountWriteScopeDTO => ({ userId, curriculumId });
  const post = (body: unknown, courseId = courses[0]) =>
    request(app)
      .post(`/api/courses/${courseId}/rate`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(users[0])}`)
      .send(body as Record<string, unknown>);
  const assign = (curriculumId: string | null) =>
    prisma.user.update({ where: { id: users[0] }, data: { curriculumId } });
  const evidence = async () => ({
    votes: await prisma.courseRating.findMany({
      where: { userId: { in: users } },
      orderBy: { id: 'asc' },
    }),
    quotas: await prisma.ratingWriteLimit.findMany({
      where: { userId: { in: users } },
      orderBy: { userId: 'asc' },
    }),
    courses: await prisma.course.findMany({
      where: { id: { in: courses } },
      orderBy: { id: 'asc' },
    }),
    records: await prisma.studentRecord.findMany({
      where: { userId: { in: users } },
      orderBy: { id: 'asc' },
    }),
    attempts: await prisma.gradeAttempt.findMany({
      where: { userId: { in: users } },
      orderBy: { id: 'asc' },
    }),
    users: await prisma.user.findMany({ where: { id: { in: users } }, orderBy: { id: 'asc' } }),
  });
  beforeAll(async () => {
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated scope course',
        credits: 3,
        difficultyLevel: index + 2,
      })),
    });
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated scope curriculum',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
      })),
    });
    await prisma.curriculumCourse.createMany({
      data: [
        { curriculumId: contexts[0], courseId: courses[0] },
        { curriculumId: contexts[0], courseId: courses[1] },
        { curriculumId: contexts[1], courseId: courses[0] },
      ],
    });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        email: `${id}@example.test`,
        name: 'Simulated scope student',
        curriculumId: contexts[index],
      })),
    });
    await prisma.studentRecord.createMany({
      data: users.flatMap((userId) =>
        courses.map((courseId) => ({
          userId,
          courseId,
          status: 'COMPLETED' as const,
          grade: 'B+',
          gradePoints: 3.5,
          electiveGroup: 'Preserve history',
          semester: 'Spring 2024',
          year: 2024,
        })),
      ),
    });
    await prisma.gradeAttempt.createMany({
      data: users.flatMap((userId) =>
        courses.map((courseId) => ({
          userId,
          courseId,
          requestId: randomUUID(),
          score: 81,
          semester: 'SPRING' as const,
          year: 2024,
        })),
      ),
    });
  });
  beforeEach(async () => {
    await prisma.courseRating.deleteMany({ where: { userId: { in: users } } });
    await prisma.ratingWriteLimit.deleteMany({ where: { userId: { in: users } } });
    await assign(contexts[0]);
    await prisma.studentRecord.updateMany({
      where: { userId: { in: users } },
      data: { status: 'COMPLETED' },
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
    await prisma.$disconnect();
  });

  it.each([
    ['A to B', contexts[0], contexts[1]],
    ['null to A', null, contexts[0]],
    ['A to null', contexts[0], null],
  ] as const)(
    'rejects a stale initial vote after %s without changing any persisted evidence',
    async (_label, previous, current) => {
      await assign(current);
      const before = await evidence();
      expect((await post({ rating: 4, expectedScope: scope(previous) })).status).toBe(409);
      expect(await evidence()).toEqual(before);
    },
  );

  it.each([
    ['A to B', contexts[0], contexts[1], 2],
    ['A to B', contexts[0], contexts[1], 4],
    ['null to A', null, contexts[0], 2],
    ['null to A', null, contexts[0], 4],
    ['A to null', contexts[0], null, 2],
    ['A to null', contexts[0], null, 4],
  ] as const)(
    'rejects stale edited or identical rating after %s (case %#) before retry/quota handling',
    async (_label, previous, current, rating) => {
      await assign(previous);
      expect((await post({ rating: 4, expectedScope: scope(previous) })).status).toBe(200);
      await assign(current);
      await prisma.ratingWriteLimit.update({
        where: { userId: users[0] },
        data: { writeCount: config.ratingWritesPerHour },
      });
      const before = await evidence();
      expect((await post({ rating, expectedScope: scope(previous) })).status).toBe(409);
      expect(await evidence()).toEqual(before);
    },
  );

  it('cannot select another owner or assign a context through scope', async () => {
    const before = await evidence();
    expect((await post({ rating: 3, expectedScope: scope(contexts[1], users[1]) })).status).toBe(
      409,
    );
    expect((await post({ rating: 3, expectedScope: scope(contexts[1]) })).status).toBe(409);
    expect(await evidence()).toEqual(before);
  });

  it.each([
    null,
    {},
    { userId: users[0] },
    { curriculumId: null },
    { userId: 'invalid', curriculumId: null },
    { userId: users[0], curriculumId: 'invalid' },
    { userId: users[0], curriculumId: 42 },
    { userId: users[0], curriculumId: null, role: 'ADMIN' },
  ])('rejects malformed scope %j with 400 and no side effects', async (expectedScope) => {
    const before = await evidence();
    expect((await post({ rating: 3, expectedScope })).status).toBe(400);
    expect(await evidence()).toEqual(before);
  });

  it('accepts uppercase owner/context UUIDs with matching current assignment', async () => {
    const response = await post({
      rating: 5,
      expectedScope: { userId: users[0].toUpperCase(), curriculumId: contexts[0].toUpperCase() },
    });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ yourRating: 5, priorSource: 'CURRICULUM_RATINGS' });
    expect(await prisma.courseRating.count({ where: { userId: users[0] } })).toBe(1);
    expect(await prisma.courseRating.count({ where: { userId: users[1] } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: users[0] } })).curriculumId).toBe(
      contexts[0],
    );
  });

  it('retains legacy scope-less writes and explicitly null matched writes', async () => {
    await assign(null);
    expect((await post({ rating: 3 })).status).toBe(200);
    expect((await post({ rating: 5, expectedScope: scope(null) })).status).toBe(200);
    expect(
      (await prisma.ratingWriteLimit.findUniqueOrThrow({ where: { userId: users[0] } })).writeCount,
    ).toBe(2);
    expect(
      (
        await prisma.courseRating.findUniqueOrThrow({
          where: { userId_courseId: { userId: users[0], courseId: courses[0] } },
        })
      ).rating,
    ).toBe(5);
  });

  it('keeps a matched identical retry immutable without another quota write', async () => {
    expect((await post({ rating: 4, expectedScope: scope() })).status).toBe(200);
    const before = await evidence();
    expect((await post({ rating: 4, expectedScope: scope() })).status).toBe(200);
    expect(await evidence()).toEqual(before);
  });

  it('allows completed historical nonmembers with the CURRENT scope and global prior', async () => {
    await assign(contexts[1]);
    const before = await evidence();
    const response = await post({ rating: 2, expectedScope: scope(contexts[1]) }, courses[1]);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ yourRating: 2, priorSource: 'GLOBAL_RATINGS' });
    const publicResponse = await request(app).get(`/api/courses/${courses[1]}/ratings`);
    expect(response.body.data).toEqual({ ...publicResponse.body.data, yourRating: 2 });
    const after = await evidence();
    expect(after.records).toEqual(before.records);
    expect(after.attempts).toEqual(before.attempts);
    expect(after.users).toEqual(before.users);
  });

  it('checks stale scope before missing-course and incomplete-course policies', async () => {
    await assign(contexts[1]);
    await prisma.studentRecord.update({
      where: { userId_courseId: { userId: users[0], courseId: courses[0] } },
      data: { status: 'PLANNED' },
    });
    const before = await evidence();
    expect((await post({ rating: 4, expectedScope: scope() }, randomUUID())).status).toBe(409);
    expect((await post({ rating: 4, expectedScope: scope() })).status).toBe(409);
    expect((await post({ rating: 4, expectedScope: scope(contexts[1]) })).status).toBe(403);
    expect(await evidence()).toEqual(before);
  });

  it('rejects an old scope when its owner lock is acquired after a concurrent context switch', async () => {
    let vote!: Promise<unknown>;
    const before = await evidence();
    let waiting = false;
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id=${users[0]} FOR UPDATE`;
        await tx.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[1] } });
        vote = submitCourseRating(users[0], courses[0], 4, scope());
        // Handle the rejection immediately while retaining it for the assertion after commit.
        void vote.catch(() => undefined);
        for (let poll = 0; poll < 40; poll++) {
          await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
          const rows = await tx.$queryRaw<
            { waiting: boolean }[]
          >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FROM users WHERE id=%FOR NO KEY UPDATE%') AS waiting`;
          if (rows[0].waiting) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      },
      { timeout: 10000 },
    );
    await expect(vote).rejects.toMatchObject({ status: 409 });
    expect(waiting).toBe(true);
    const after = await evidence();
    expect(after.votes).toEqual(before.votes);
    expect(after.quotas).toEqual(before.quotas);
    expect(after.courses).toEqual(before.courses);
    expect(after.records).toEqual(before.records);
    expect(after.attempts).toEqual(before.attempts);
    expect(after.users.find((user) => user.id === users[0])?.curriculumId).toBe(contexts[1]);
  });
});
