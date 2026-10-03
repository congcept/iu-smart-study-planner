import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';

describe('account-scoped workload analysis (PostgreSQL)', () => {
  const prefix = `workload-context-${randomUUID()}`;
  const courses = Array.from({ length: 6 }, () => randomUUID());
  const contexts = Array.from({ length: 3 }, () => randomUUID());
  const users = Array.from({ length: 4 }, () => randomUUID());
  const analyze = (
    ids: string[] = [courses[0]],
    user?: number,
    extra: Record<string, unknown> = {},
  ) => {
    const call = request(app).post('/api/recommendations/analyze-workload');
    if (user !== undefined) call.set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(users[user])}`);
    return call.send({ courseIds: ids, ...extra });
  };
  const detail = (index: number) => request(app).get(`/api/curricula/${contexts[index]}`);
  beforeAll(async () => {
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated course',
        credits: 3,
        category: 'CORE',
        difficultyLevel: [1, 5, 1, 5, 4, 2][index],
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
    for (const [context, indices] of [
      [0, [0, 1, 2, 3, 4]],
      [1, [0, 5]],
    ] as const) {
      for (const index of indices) {
        await prisma.curriculumCourse.create({
          data: {
            curriculumId: contexts[context],
            courseId: courses[index],
            placements:
              index === 4
                ? undefined
                : {
                    create: {
                      academicYear: 1,
                      academicSemester: 1,
                      sourceOrder: index,
                      sourceLabel: 'Simulated reference',
                    },
                  },
          },
        });
      }
    }
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        name: 'Simulated student',
        email: `${id}@example.test`,
        curriculumId: index === 2 ? null : contexts[index === 3 ? 2 : index],
      })),
    });
  });
  beforeEach(async () => {
    await prisma.courseRating.deleteMany({ where: { userId: { in: users } } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
    await prisma.$disconnect();
  });

  it('matches the full context seed prior rather than the selected-course seeds', async () => {
    const response = await analyze([courses[0]], 0);
    expect(response.status).toBe(200);
    const context = (await detail(0)).body.data;
    expect(response.body.data.scope).toEqual({
      curriculumId: contexts[0],
      categoryBalanceAvailable: false,
      ratingPrior: context.ratingPrior,
    });
    expect(response.body.data.averageDifficulty).toBe(3.2);
    expect(response.body.data.totalCredits).toBe(3);
    expect(response.body.data.workloadScore).toBe(6.96);
    expect(response.body.data.riskLevel).toBe('LOW');
  });

  it('isolates two accounts on the same global course by their stored curriculum', async () => {
    const first = await analyze([courses[0]], 0);
    const second = await analyze([courses[0]], 1);
    expect(first.body.data.averageDifficulty).toBe(3.2);
    expect(second.body.data.averageDifficulty).toBe(1.5);
    expect(second.body.data.scope.curriculumId).toBe(contexts[1]);
    expect((await analyze([courses[5]], 0)).status).toBe(409);
    expect((await analyze([courses[5]], 1)).status).toBe(200);
  });

  it('uses member votes from any student and excludes unrelated votes', async () => {
    await prisma.courseRating.createMany({
      data: [
        { userId: users[2], courseId: courses[1], rating: 1 },
        { userId: users[2], courseId: courses[5], rating: 5 },
      ],
    });
    const first = await analyze([courses[0]], 0);
    const second = await analyze([courses[0]], 1);
    expect(first.body.data.averageDifficulty).toBe(1);
    expect(second.body.data.averageDifficulty).toBe(5);
    expect(first.body.data.scope.ratingPrior).toEqual({ mean: 1, source: 'CURRICULUM_RATINGS' });
  });

  it('keeps course vote evidence global while matching context detail estimates', async () => {
    await prisma.courseRating.createMany({
      data: [
        { userId: users[2], courseId: courses[0], rating: 5 },
        { userId: users[2], courseId: courses[1], rating: 1 },
      ],
    });
    const context = (await detail(0)).body.data;
    const row = context.courses.find((course: { id: string }) => course.id === courses[0]);
    const response = await analyze([courses[0]], 0);
    expect(row.ratingCount).toBe(1);
    expect(response.body.data.averageDifficulty).toBe(Math.round(row.ratingDifficulty * 100) / 100);
    expect(response.body.data.scope.ratingPrior).toEqual(context.ratingPrior);
  });

  it('counts repeated placements and repeated/uppercase input IDs only once', async () => {
    const member = await prisma.curriculumCourse.findUniqueOrThrow({
      where: { curriculumId_courseId: { curriculumId: contexts[0], courseId: courses[0] } },
    });
    const placement = await prisma.curriculumPlacement.create({
      data: {
        curriculumCourseId: member.id,
        sourceOrder: 99,
        sourceLabel: 'Repeated elective placement',
        electiveGroup: 'Group 2',
        electiveSelectCount: 1,
      },
    });
    try {
      const response = await analyze([courses[0], courses[0].toUpperCase()], 0);
      expect(response.status).toBe(200);
      expect(response.body.data.totalCredits).toBe(3);
      expect(response.body.data.scope.ratingPrior.mean).toBe(3.2);
    } finally {
      await prisma.curriculumPlacement.delete({ where: { id: placement.id } });
    }
  });

  it('rejects an entire selection containing nonmembers or unplaced members', async () => {
    for (const id of [courses[4], courses[5], randomUUID()]) {
      const response = await analyze([courses[0], id], 0);
      expect(response.status).toBe(409);
      expect(response.body.data).toBeUndefined();
    }
  });

  it('rejects an assigned empty curriculum without falling back to the legacy catalog', async () => {
    expect((await analyze([courses[0]], 3)).status).toBe(409);
  });

  it('suppresses unverified category advice while preserving numeric workload advice', async () => {
    const assigned = await analyze(courses.slice(0, 4), 0);
    const guest = await analyze(courses.slice(0, 4));
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.totalCredits).toBe(12);
    expect(assigned.body.data.recommendations).not.toContain(
      'Consider diversifying course categories for better balance',
    );
    expect(guest.body.data.recommendations).toContain(
      'Consider diversifying course categories for better balance',
    );
    expect((await analyze([courses[0]], 0)).body.data.recommendations).toContain(
      'Consider adding more courses to reach at least 12 credits',
    );
  });

  it('keeps guests and unassigned accounts on the same global prior and category policy', async () => {
    const guest = await analyze([courses[5]]);
    const unassigned = await analyze([courses[5]], 2);
    expect(guest.status).toBe(200);
    expect(unassigned.body.data).toEqual(guest.body.data);
    expect(guest.body.data.scope).toMatchObject({
      curriculumId: null,
      categoryBalanceAvailable: true,
    });
    expect(guest.body.data.scope.ratingPrior.source).toMatch(/^GLOBAL_/);
  });

  it('rejects missing global courses instead of returning a partial workload', async () => {
    const response = await analyze([courses[0], randomUUID()]);
    expect(response.status).toBe(404);
    expect(response.body.data).toBeUndefined();
  });

  it.each(['invalid', ''])(
    'does not downgrade an invalid supplied session to a guest (%s)',
    async (token) => {
      const response = await request(app)
        .post('/api/recommendations/analyze-workload')
        .set('Cookie', `${AUTH_COOKIE_NAME}=${token}`)
        .send({ courseIds: [courses[0]] });
      expect(response.status).toBe(401);
    },
  );

  it('rejects a session whose user has been deleted', async () => {
    const response = await request(app)
      .post('/api/recommendations/analyze-workload')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(randomUUID())}`)
      .send({ courseIds: [courses[0]] });
    expect(response.status).toBe(401);
  });

  it('cannot select another context through query values', async () => {
    const response = await request(app)
      .post(`/api/recommendations/analyze-workload?curriculumId=${contexts[1]}&userId=${users[1]}`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(users[0])}`)
      .send({ courseIds: [courses[0]] });
    expect(response.status).toBe(200);
    expect(response.body.data.scope.curriculumId).toBe(contexts[0]);
  });

  it.each([{ curriculumId: contexts[1] }, { userId: users[1] }, { courseIds: [] }])(
    'rejects malformed or client-directed request bodies (%#)',
    async (body) => {
      expect((await analyze([courses[0]], 0, body)).status).toBe(400);
    },
  );
});
