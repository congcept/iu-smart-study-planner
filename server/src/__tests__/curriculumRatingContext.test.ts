import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';

describe('curriculum-consistent rating summaries (PostgreSQL)', () => {
  const prefix = `rating-context-${randomUUID()}`;
  const courses: string[] = [randomUUID(), randomUUID(), randomUUID()];
  const contexts: string[] = [randomUUID(), randomUUID(), randomUUID()];
  const users: string[] = [randomUUID(), randomUUID(), randomUUID()];
  const read = (course = 0, context?: number) =>
    request(app)
      .get(`/api/courses/${courses[course]}/ratings`)
      .query(context === undefined ? {} : { curriculumId: contexts[context] });
  const post = (rating: number, course = 0, user = 0, query = '') =>
    request(app)
      .post(`/api/courses/${courses[course]}/rate${query}`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(users[user])}`)
      .send({ rating });
  const directVote = (course: number, rating: number) =>
    prisma.courseRating.create({ data: { userId: users[2], courseId: courses[course], rating } });
  beforeAll(async () => {
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated course',
        credits: 3,
        difficultyLevel: [1, 5, 2][index],
      })),
    });
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated curriculum',
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
        { curriculumId: contexts[1], courseId: courses[2] },
      ],
    });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        name: 'Simulated student',
        email: `${id}@example.test`,
        curriculumId: index < 2 ? contexts[index] : null,
      })),
    });
    await prisma.studentRecord.createMany({
      data: users.flatMap((userId) =>
        courses.map((courseId) => ({
          userId,
          courseId,
          status: 'COMPLETED' as const,
          grade: 'A',
          gradePoints: 4,
        })),
      ),
    });
  });
  beforeEach(async () => {
    await prisma.courseRating.deleteMany({ where: { userId: { in: users } } });
    await prisma.ratingWriteLimit.deleteMany({ where: { userId: { in: users } } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
    await prisma.$disconnect();
  });

  it('uses context seed means on public reads without exposing student identities', async () => {
    const first = await read(0, 0);
    const second = await read(0, 1);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data).toMatchObject({
      average: null,
      count: 0,
      priorMean: 3,
      difficulty: 3,
      priorSource: 'CURRICULUM_SEED',
    });
    expect(second.body.data).toMatchObject({
      priorMean: 1.5,
      difficulty: 1.5,
      priorSource: 'CURRICULUM_SEED',
    });
    for (const userId of users) expect(JSON.stringify(first.body)).not.toContain(userId);
  });

  it('excludes unrelated votes from a zero-rating member prior', async () => {
    await directVote(1, 1);
    await directVote(2, 5);
    expect((await read(0, 0)).body.data).toMatchObject({
      count: 0,
      difficulty: 1,
      priorMean: 1,
      priorSource: 'CURRICULUM_RATINGS',
    });
    expect((await read(0, 1)).body.data).toMatchObject({ count: 0, difficulty: 5, priorMean: 5 });
  });

  it('retains global distribution/counts while changing only the contextual prior and estimate', async () => {
    await directVote(0, 5);
    await directVote(1, 1);
    await directVote(2, 3);
    const first = (await read(0, 0)).body.data;
    const second = (await read(0, 1)).body.data;
    expect(first).toMatchObject({
      average: 5,
      count: 1,
      priorMean: 3,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
    });
    expect(second).toMatchObject({
      average: 5,
      count: 1,
      priorMean: 4,
      distribution: first.distribution,
    });
    expect(first.difficulty).toBeCloseTo(3 + 2 / 6, 12);
    expect(second.difficulty).toBeCloseTo(4 + 1 / 6, 12);
  });

  it('makes a signed-in member vote reply match the corresponding curriculum detail/read', async () => {
    await directVote(1, 3);
    await directVote(2, 1);
    const response = await post(5);
    expect(response.status).toBe(200);
    const publicSummary = (await read(0, 0)).body.data;
    expect(response.body.data).toEqual({ ...publicSummary, yourRating: 5 });
    const detail = await request(app).get(`/api/curricula/${contexts[0]}`);
    const first = detail.body.data.courses.find((row: { id: string }) => row.id === courses[0]);
    expect(first.ratingDifficulty).toBe(publicSummary.difficulty);
    expect(first.ratingPriorMean).toBe(publicSummary.priorMean);
    expect(first.ratingPriorSource).toBe(publicSummary.priorSource);
  });

  it('uses the stored cookie-owner context instead of a query-selected curriculum', async () => {
    await directVote(1, 1);
    await directVote(2, 5);
    const response = await post(5, 0, 0, `?curriculumId=${contexts[1]}&userId=${users[1]}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      priorMean: 3,
      priorSource: 'CURRICULUM_RATINGS',
      yourRating: 5,
    });
    expect(await prisma.courseRating.count({ where: { userId: users[1] } })).toBe(0);
  });

  it('keeps completed historical nonmember courses globally rateable after an assignment', async () => {
    const response = await post(4, 2);
    expect(response.status).toBe(200);
    expect(response.body.data.priorSource).toBe('GLOBAL_RATINGS');
    expect(response.body.data).toEqual({ ...(await read(2)).body.data, yourRating: 4 });
  });

  it('keeps identical retries as one immutable vote and quota write while using the context prior', async () => {
    await post(4);
    const before = await prisma.courseRating.findUniqueOrThrow({
      where: { userId_courseId: { userId: users[0], courseId: courses[0] } },
    });
    const retry = await post(4);
    expect(retry.status).toBe(200);
    expect(retry.body.data.priorSource).toBe('CURRICULUM_RATINGS');
    expect(await prisma.courseRating.findUniqueOrThrow({ where: { id: before.id } })).toEqual(
      before,
    );
    expect(
      (await prisma.ratingWriteLimit.findUniqueOrThrow({ where: { userId: users[0] } })).writeCount,
    ).toBe(1);
  });

  it('retains global summary behavior when no context is requested or assigned', async () => {
    const posted = await post(2, 0, 2);
    expect(posted.status).toBe(200);
    expect(posted.body.data.priorSource).toBe('GLOBAL_RATINGS');
    expect(posted.body.data).toEqual({ ...(await read()).body.data, yourRating: 2 });
  });

  it('returns 404 for absent contexts, empty contexts and nonmember courses', async () => {
    expect((await read(2, 0)).status).toBe(404);
    expect((await read(0, 2)).status).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/courses/${courses[0]}/ratings`)
          .query({ curriculumId: randomUUID() })
      ).status,
    ).toBe(404);
  });

  it.each(['invalid', ['a', 'b'], ''])(
    'rejects malformed context query %#',
    async (curriculumId) => {
      expect(
        (await request(app).get(`/api/courses/${courses[0]}/ratings`).query({ curriculumId }))
          .status,
      ).toBe(400);
    },
  );

  it('normalizes uppercase context UUIDs while rejecting a context in the vote body', async () => {
    expect(
      (
        await request(app)
          .get(`/api/courses/${courses[0]}/ratings`)
          .query({ curriculumId: contexts[0].toUpperCase() })
      ).status,
    ).toBe(200);
    const response = await request(app)
      .post(`/api/courses/${courses[0]}/rate`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(users[0])}`)
      .send({ rating: 3, curriculumId: contexts[1] });
    expect(response.status).toBe(400);
    expect(await prisma.courseRating.count({ where: { userId: users[0] } })).toBe(0);
  });

  it('keeps concurrent identical member votes consistent with quota and context evidence', async () => {
    const responses = await Promise.all(Array.from({ length: 4 }, () => post(4)));
    expect(responses.every(({ status }) => status === 200)).toBe(true);
    expect((await read(0, 0)).body.data).toMatchObject({
      average: 4,
      count: 1,
      priorMean: 4,
      difficulty: 4,
    });
    expect(
      (await prisma.ratingWriteLimit.findUniqueOrThrow({ where: { userId: users[0] } })).writeCount,
    ).toBe(1);
  });
});
