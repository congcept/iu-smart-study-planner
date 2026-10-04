import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express from 'express';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { prisma } from '../db';
import router from '../routes/users';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { readRatingCourseChoices } from '../services/ratingCourseChoices';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/users', router);

describe('scope-consistent rating course choices (PostgreSQL)', () => {
  const prefix = `rating-choices-${randomUUID()}`;
  const users = Array.from({ length: 5 }, () => randomUUID());
  const contexts = Array.from({ length: 3 }, () => randomUUID());
  const courses = Array.from({ length: 4 }, () => randomUUID());
  const membershipId = randomUUID();
  const get = (userId = users[0], query = '') =>
    request(app)
      .get(`/api/users/me/ratings/courses${query}`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(userId)}`);
  const evidence = async () => ({
    users: await prisma.user.findMany({ where: { id: { in: users } }, orderBy: { id: 'asc' } }),
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
    memberships: await prisma.curriculumCourse.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    placements: await prisma.curriculumPlacement.findMany({
      where: { curriculumCourse: { curriculumId: { in: contexts } } },
      orderBy: { id: 'asc' },
    }),
  });
  const globalMean = async () => {
    const votes = await prisma.courseRating.aggregate({ _avg: { rating: true } });
    return (
      votes._avg.rating ??
      (await prisma.course.aggregate({ _avg: { difficultyLevel: true } }))._avg.difficultyLevel!
    );
  };
  beforeAll(async () => {
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: `Simulated rating choice ${index}`,
        credits: 3,
        difficultyLevel: [1, 3, 5, 4][index],
      })),
    });
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated rating choice context',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
      })),
    });
    await prisma.curriculumCourse.createMany({
      data: [
        { id: membershipId, curriculumId: contexts[0], courseId: courses[0] },
        { curriculumId: contexts[0], courseId: courses[2] },
        { curriculumId: contexts[1], courseId: courses[0] },
        { curriculumId: contexts[1], courseId: courses[1] },
      ],
    });
    await prisma.curriculumPlacement.createMany({
      data: [
        { curriculumCourseId: membershipId, sourceOrder: 0, electiveGroup: 'Group 1' },
        { curriculumCourseId: membershipId, sourceOrder: 1, electiveGroup: 'Group 2' },
      ],
    });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        email: `${id}@example.test`,
        name: 'Simulated rating choice owner',
        role: index === 2 ? ('ADMIN' as const) : ('STUDENT' as const),
        password: 'Private legacy fixture',
        passwordHash: 'Private fixture hash',
        curriculumId: index < 3 ? contexts[index] : null,
      })),
    });
    await prisma.studentRecord.createMany({
      data: [
        { userId: users[0], courseId: courses[0], status: 'COMPLETED' },
        { userId: users[0], courseId: courses[1], status: 'COMPLETED' },
        { userId: users[0], courseId: courses[2], status: 'PLANNED' },
        { userId: users[1], courseId: courses[2], status: 'COMPLETED' },
        { userId: users[1], courseId: courses[3], status: 'COMPLETED' },
        { userId: users[2], courseId: courses[1], status: 'COMPLETED' },
        { userId: users[3], courseId: courses[0], status: 'COMPLETED' },
      ].map((record) => ({
        ...record,
        status: record.status as 'COMPLETED' | 'PLANNED',
        grade: 'B+',
        gradePoints: 3.5,
        electiveGroup: 'Historical claim',
      })),
    });
    await prisma.gradeAttempt.create({
      data: { userId: users[0], courseId: courses[0], requestId: randomUUID(), score: 81 },
    });
    await prisma.ratingWriteLimit.create({
      data: { userId: users[0], windowStart: new Date('2026-01-01T00:00:00Z'), writeCount: 3 },
    });
  });
  beforeEach(async () => {
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[0] } });
    await prisma.studentRecord.updateMany({
      where: { userId: users[0] },
      data: { status: 'COMPLETED' },
    });
    await prisma.studentRecord.update({
      where: { userId_courseId: { userId: users[0], courseId: courses[2] } },
      data: { status: 'PLANNED' },
    });
    await prisma.courseRating.deleteMany({ where: { userId: { in: users } } });
    await prisma.courseRating.createMany({
      data: [
        { userId: users[0], courseId: courses[0], rating: 5 },
        { userId: users[1], courseId: courses[0], rating: 1 },
        { userId: users[1], courseId: courses[1], rating: 3 },
        { userId: users[0], courseId: courses[2], rating: 1 },
        { userId: users[2], courseId: courses[3], rating: 5 },
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
    expect((await request(app).get('/api/users/me/ratings/courses')).status).toBe(401);
    expect((await get(randomUUID())).status).toBe(401);
  });

  it('includes completed members and historical nonmembers with separate contextual/global priors and own votes', async () => {
    const global = await globalMean();
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body.data.scope).toEqual({ userId: users[0], curriculumId: contexts[0] });
    expect(response.body.data.courses.map((course: { id: string }) => course.id)).toEqual([
      courses[0],
      courses[1],
    ]);
    expect(response.body.data.courses[0]).toMatchObject({
      id: courses[0],
      code: `${prefix}-0`,
      name: 'Simulated rating choice 0',
      avgRating: 3,
      ratingCount: 2,
      ratingPriorMean: 7 / 3,
      ratingPriorSource: 'CURRICULUM_RATINGS',
      yourRating: 5,
      membership: 'CURRENT_CURRICULUM',
    });
    expect(response.body.data.courses[0].ratingDifficulty).toBeCloseTo((6 + (7 / 3) * 5) / 7, 12);
    expect(response.body.data.courses[1]).toMatchObject({
      id: courses[1],
      avgRating: 3,
      ratingCount: 1,
      ratingPriorMean: global,
      ratingPriorSource: 'GLOBAL_RATINGS',
      yourRating: null,
      membership: 'OTHER_HISTORY',
    });
    expect(response.body.data.courses[1].ratingDifficulty).toBeCloseTo((3 + global * 5) / 6, 12);
  });

  it.each(['PLANNED', 'IN_PROGRESS', 'FAILED', 'DROPPED'] as const)(
    'excludes current status %s despite grades and a historical personal vote',
    async (status) => {
      await prisma.studentRecord.update({
        where: { userId_courseId: { userId: users[0], courseId: courses[0] } },
        data: { status },
      });
      const response = await get();
      expect(response.status).toBe(200);
      expect(response.body.data.courses.map((course: { id: string }) => course.id)).toEqual([
        courses[1],
      ]);
    },
  );

  it('does not borrow another owner’s completion or historical votes', async () => {
    const response = await get(users[1]);
    expect(response.status).toBe(200);
    expect(response.body.data.scope).toEqual({ userId: users[1], curriculumId: contexts[1] });
    expect(response.body.data.courses.map((course: { id: string }) => course.id)).toEqual([
      courses[2],
      courses[3],
    ]);
    expect(
      response.body.data.courses.every(
        (course: { yourRating: number | null }) => course.yourRating === null,
      ),
    ).toBe(true);
  });

  it('keeps admin choices restricted to their own completion in an empty assigned context', async () => {
    const response = await get(users[2]);
    expect(response.status).toBe(200);
    expect(response.body.data.scope).toEqual({ userId: users[2], curriculumId: contexts[2] });
    expect(response.body.data.courses).toHaveLength(1);
    expect(response.body.data.courses[0]).toMatchObject({
      id: courses[1],
      membership: 'OTHER_HISTORY',
      yourRating: null,
      ratingPriorSource: 'GLOBAL_RATINGS',
    });
  });

  it('reports UNASSIGNED with a global prior and returns empty lists without catalog fallback', async () => {
    const unassigned = await get(users[3]);
    expect(unassigned.status).toBe(200);
    expect(unassigned.body.data.scope).toEqual({ userId: users[3], curriculumId: null });
    expect(unassigned.body.data.courses).toHaveLength(1);
    expect(unassigned.body.data.courses[0]).toMatchObject({
      id: courses[0],
      membership: 'UNASSIGNED',
      yourRating: null,
      ratingPriorSource: 'GLOBAL_RATINGS',
    });
    const empty = await get(users[4]);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual({
      scope: { userId: users[4], curriculumId: null },
      courses: [],
    });
  });

  it('labels completed history OTHER_HISTORY when assigned to an empty context', async () => {
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[2] } });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body.data.courses).toHaveLength(2);
    expect(
      response.body.data.courses.every(
        (course: { membership: string }) => course.membership === 'OTHER_HISTORY',
      ),
    ).toBe(true);
  });

  it('does not duplicate a course for repeated elective placements', async () => {
    expect(
      await prisma.curriculumPlacement.count({ where: { curriculumCourseId: membershipId } }),
    ).toBe(2);
    const response = await get();
    expect(response.status).toBe(200);
    expect(
      response.body.data.courses.filter((course: { id: string }) => course.id === courses[0]),
    ).toHaveLength(1);
  });

  it('returns an honest zero-vote member estimate from the contextual prior', async () => {
    await prisma.courseRating.deleteMany({ where: { courseId: courses[2] } });
    await prisma.studentRecord.update({
      where: { userId_courseId: { userId: users[0], courseId: courses[2] } },
      data: { status: 'COMPLETED' },
    });
    const response = await get();
    expect(response.status).toBe(200);
    const choice = response.body.data.courses.find(
      (course: { id: string }) => course.id === courses[2],
    );
    expect(choice).toMatchObject({
      avgRating: null,
      ratingCount: 0,
      ratingDifficulty: 3,
      ratingPriorMean: 3,
      ratingPriorSource: 'CURRICULUM_RATINGS',
      yourRating: null,
    });
  });

  it('uses unique contextual seed means when member courses have no votes', async () => {
    await prisma.courseRating.deleteMany({ where: { courseId: { in: [courses[0], courses[2]] } } });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body.data.courses[0]).toMatchObject({
      avgRating: null,
      ratingCount: 0,
      ratingDifficulty: 3,
      ratingPriorMean: 3,
      ratingPriorSource: 'CURRICULUM_SEED',
      yourRating: null,
    });
  });

  it.each([
    '?userId=other',
    '?curriculumId=other',
    '?status=PLANNED',
    '?role=ADMIN',
    '?curriculumId=',
  ])('rejects query override %s without any write', async (query) => {
    const before = await evidence();
    expect((await get(users[0], query)).status).toBe(400);
    expect(await evidence()).toEqual(before);
  });

  it('exposes only course choices and scope, preserving all stored state on reads', async () => {
    const before = await evidence();
    const expectedKeys = [
      'avgRating',
      'code',
      'id',
      'membership',
      'name',
      'ratingCount',
      'ratingDifficulty',
      'ratingPriorMean',
      'ratingPriorSource',
      'yourRating',
    ].sort();
    for (const userId of users) {
      const response = await get(userId);
      expect(response.status).toBe(200);
      expect(Object.keys(response.body.data).sort()).toEqual(['courses', 'scope']);
      for (const course of response.body.data.courses)
        expect(Object.keys(course).sort()).toEqual(expectedKeys);
      const serialized = JSON.stringify(response.body);
      for (const other of users.filter((id) => id !== userId))
        expect(serialized).not.toContain(other);
      for (const field of [
        'password',
        'passwordHash',
        'email',
        'studentId',
        'gradePoints',
        'electiveGroup',
        'semester',
        'createdAt',
        'updatedAt',
      ])
        expect(serialized).not.toContain(field);
    }
    expect(await evidence()).toEqual(before);
  });

  it('reports missing owner as 404 in direct reads', async () => {
    await expect(readRatingCourseChoices(randomUUID())).rejects.toMatchObject({ status: 404 });
  });

  it('preserves owner, completion, membership, vote, prior and aggregate evidence in a provided RepeatableRead transaction', async () => {
    await prisma.$transaction(
      async (tx) => {
        const initial = await readRatingCourseChoices(users[0], tx);
        await prisma.$transaction(async (write) => {
          await write.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[1] } });
          await write.studentRecord.update({
            where: { userId_courseId: { userId: users[0], courseId: courses[0] } },
            data: { status: 'DROPPED' },
          });
          await write.courseRating.update({
            where: { userId_courseId: { userId: users[1], courseId: courses[1] } },
            data: { rating: 1 },
          });
          await write.courseRating.create({
            data: { userId: users[0], courseId: courses[1], rating: 5 },
          });
        });
        expect(await readRatingCourseChoices(users[0], tx)).toEqual(initial);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000 },
    );
    const latest = await readRatingCourseChoices(users[0]);
    expect(latest.scope).toEqual({ userId: users[0], curriculumId: contexts[1] });
    expect(latest.courses).toHaveLength(1);
    expect(latest.courses[0]).toMatchObject({
      id: courses[1],
      avgRating: 3,
      ratingCount: 2,
      yourRating: 5,
      membership: 'CURRENT_CURRICULUM',
      ratingPriorSource: 'CURRICULUM_RATINGS',
    });
    expect(latest.courses[0].ratingPriorMean).toBe(3);
    expect(latest.courses[0].ratingDifficulty).toBe(3);
  });
});
