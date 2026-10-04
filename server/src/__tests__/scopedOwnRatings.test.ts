import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express from 'express';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { prisma } from '../db';
import router from '../routes/users';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { readScopedOwnRatings } from '../services/ownCourseRatings';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/users', router);

describe('scoped own-rating snapshots (PostgreSQL)', () => {
  const prefix = `own-rating-scope-${randomUUID()}`;
  const users = Array.from({ length: 4 }, () => randomUUID());
  const contexts = Array.from({ length: 3 }, () => randomUUID());
  const courses = Array.from({ length: 3 }, () => randomUUID()).sort();
  const ratings = [
    { courseId: courses[0], rating: 2 },
    { courseId: courses[1], rating: 4 },
    { courseId: courses[2], rating: 5 },
  ];
  const get = (userId = users[0], query = '', legacy = false) =>
    request(app)
      .get(`/api/users/me/ratings${legacy ? '' : '/snapshot'}${query}`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(userId)}`);
  const evidence = async () => ({
    users: await prisma.user.findMany({ where: { id: { in: users } }, orderBy: { id: 'asc' } }),
    contexts: await prisma.curriculum.findMany({
      where: { id: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    courses: await prisma.course.findMany({
      where: { id: { in: courses } },
      orderBy: { id: 'asc' },
    }),
    votes: await prisma.courseRating.findMany({
      where: { userId: { in: users } },
      orderBy: { id: 'asc' },
    }),
    quota: await prisma.ratingWriteLimit.findMany({
      where: { userId: { in: users } },
      orderBy: { userId: 'asc' },
    }),
    records: await prisma.studentRecord.findMany({
      where: { userId: { in: users } },
      orderBy: { id: 'asc' },
    }),
    attempts: await prisma.gradeAttempt.findMany({
      where: { userId: { in: users } },
      orderBy: { id: 'asc' },
    }),
  });
  beforeAll(async () => {
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated historical rating course',
        credits: 3,
        difficultyLevel: index + 2,
      })),
    });
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated ratings context',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
      })),
    });
    await prisma.curriculumCourse.createMany({
      data: [
        { curriculumId: contexts[0], courseId: courses[0] },
        { curriculumId: contexts[1], courseId: courses[1] },
      ],
    });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        email: `${id}@example.test`,
        name: 'Simulated rating owner',
        role: index === 2 ? ('ADMIN' as const) : ('STUDENT' as const),
        password: 'Legacy private fixture',
        passwordHash: 'Private fixture hash',
        curriculumId: index < 3 ? contexts[index] : null,
      })),
    });
    await prisma.studentRecord.createMany({
      data: courses.map((courseId) => ({
        userId: users[0],
        courseId,
        status: 'DROPPED' as const,
        grade: 'A',
        gradePoints: 4,
        electiveGroup: 'Preserved historical claim',
      })),
    });
    await prisma.gradeAttempt.create({
      data: { userId: users[0], courseId: courses[0], requestId: randomUUID(), score: 91 },
    });
    await prisma.ratingWriteLimit.create({
      data: { userId: users[0], windowStart: new Date('2026-01-01T00:00:00Z'), writeCount: 3 },
    });
  });
  beforeEach(async () => {
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[0] } });
    await prisma.courseRating.deleteMany({ where: { userId: { in: users } } });
    await prisma.courseRating.createMany({
      data: [
        ...[...ratings].reverse().map((rating) => ({ userId: users[0], ...rating })),
        { userId: users[1], courseId: courses[0], rating: 1 },
        { userId: users[2], courseId: courses[1], rating: 3 },
      ],
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
    await prisma.$disconnect();
  });

  it('requires a current cookie account and rejects absent/unknown sessions', async () => {
    expect((await request(app).get('/api/users/me/ratings/snapshot')).status).toBe(401);
    expect((await get(randomUUID())).status).toBe(401);
  });

  it.each([0, 1, 2])(
    'returns only cookie owner %s votes for students and admins',
    async (index) => {
      const response = await get(users[index]);
      expect(response.status).toBe(200);
      const expected =
        index === 0
          ? ratings
          : [{ courseId: courses[index === 1 ? 0 : 1], rating: index === 1 ? 1 : 3 }];
      expect(response.body).toEqual({
        success: true,
        data: { scope: { userId: users[index], curriculumId: contexts[index] }, ratings: expected },
      });
      expect(
        response.body.data.ratings.every(
          (rating: Record<string, unknown>) =>
            Object.keys(rating).sort().join(',') === 'courseId,rating',
        ),
      ).toBe(true);
      const serialized = JSON.stringify(response.body);
      for (const other of users.filter((id) => id !== users[index]))
        expect(serialized).not.toContain(other);
      for (const privateField of [
        'password',
        'passwordHash',
        'email',
        'studentId',
        'name',
        'createdAt',
        'updatedAt',
        'eligibility',
        'prior',
      ])
        expect(serialized).not.toContain(privateField);
      expect(serialized).not.toContain('Private fixture');
    },
  );

  it('keeps all historical votes after uncompletion and orders by course UUID independently of insertion order', async () => {
    expect(
      await prisma.studentRecord.count({ where: { userId: users[0], status: 'COMPLETED' } }),
    ).toBe(0);
    expect(await prisma.curriculumCourse.count({ where: { curriculumId: contexts[0] } })).toBe(1);
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body.data.ratings).toEqual(ratings);
    expect((await get()).body.data).toEqual(response.body.data);
  });

  it('returns historical votes for an empty assigned context without membership fallback', async () => {
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[2] } });
    expect(await prisma.curriculumCourse.count({ where: { curriculumId: contexts[2] } })).toBe(0);
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      scope: { userId: users[0], curriculumId: contexts[2] },
      ratings,
    });
  });

  it('reports explicit null for unassigned owners, including an empty vote list', async () => {
    const empty = await get(users[3]);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual({
      scope: { userId: users[3], curriculumId: null },
      ratings: [],
    });
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: null } });
    expect((await get()).body.data).toEqual({
      scope: { userId: users[0], curriculumId: null },
      ratings,
    });
  });

  it.each([
    '?userId=other',
    '?curriculumId=other',
    '?role=ADMIN',
    '?curriculumId=',
    '?userId[]=a&userId[]=b',
  ])('rejects every query override %s without changing stored state', async (query) => {
    const before = await evidence();
    expect((await get(users[0], query)).status).toBe(400);
    expect(await evidence()).toEqual(before);
  });

  it('preserves the legacy own-rating array contract and ignores its legacy selector query', async () => {
    expect((await get(users[0], '', true)).body.data).toEqual(ratings);
    expect(
      (await get(users[0], `?userId=${users[1]}&curriculumId=${contexts[1]}`, true)).body.data,
    ).toEqual(ratings);
  });

  it('does not mutate assignments, votes, aggregate cache, quotas, progress or numeric history on reads', async () => {
    const before = await evidence();
    for (const userId of users) expect((await get(userId)).status).toBe(200);
    expect(await evidence()).toEqual(before);
  });

  it('returns 404 for a missing owner in direct service reads', async () => {
    await expect(readScopedOwnRatings(randomUUID())).rejects.toMatchObject({ status: 404 });
  });

  it('keeps scope and votes from the same provided RepeatableRead snapshot across a committed update', async () => {
    await prisma.$transaction(
      async (tx) => {
        const initial = await readScopedOwnRatings(users[0], tx);
        expect(initial).toEqual({
          scope: { userId: users[0], curriculumId: contexts[0] },
          ratings,
        });
        await prisma.$transaction(async (write) => {
          await write.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[1] } });
          await write.courseRating.update({
            where: { userId_courseId: { userId: users[0], courseId: courses[0] } },
            data: { rating: 1 },
          });
          await write.courseRating.delete({
            where: { userId_courseId: { userId: users[0], courseId: courses[2] } },
          });
        });
        expect(await readScopedOwnRatings(users[0], tx)).toEqual(initial);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000 },
    );
    expect(await readScopedOwnRatings(users[0])).toEqual({
      scope: { userId: users[0], curriculumId: contexts[1] },
      ratings: [{ courseId: courses[0], rating: 1 }, ratings[1]],
    });
  });
});
