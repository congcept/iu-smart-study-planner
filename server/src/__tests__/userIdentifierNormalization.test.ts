import { randomUUID } from 'crypto';
import request from 'supertest';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';

describe('UUID owner identifier normalization (PostgreSQL)', () => {
  const prefix = `identifier-case-${randomUUID()}`;
  const ownerId = `a${randomUUID().slice(1)}`;
  const otherId = randomUUID();
  const adminId = randomUUID();
  const ambiguousId = randomUUID();
  const userIds = [ownerId, otherId, adminId, ambiguousId];
  const contextId = randomUUID();
  const courseA = randomUUID();
  const courseB = randomUUID();
  const ownerStudentId = `${prefix}-MixedCase`;
  let planId: string;
  const cookie = (id: string = ownerId) => `${AUTH_COOKIE_NAME}=${issueToken(id)}`;
  const get = (path: string, actor: string = ownerId) =>
    request(app).get(path).set('Cookie', cookie(actor));
  const userPaths = (id: string) =>
    ['', '/records', '/progress'].map((suffix) => `/api/users/${id}${suffix}`);
  const directPaths = (id: string) => [
    `/api/recommendations/user/${id}`,
    `/api/study-plans/user/${id}`,
  ];

  beforeAll(async () => {
    await prisma.curriculum.create({
      data: {
        id: contextId,
        code: prefix,
        name: 'Simulated identifier context',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/simulated',
      },
    });
    await prisma.user.createMany({
      data: userIds.map((id) => ({
        id,
        studentId:
          id === ownerId
            ? ownerStudentId
            : id === ambiguousId
              ? ownerId.toUpperCase()
              : `${prefix}-${id}`,
        name: 'Identifier case fixture',
        email: `${prefix}-${id}@example.test`,
        role: id === adminId ? 'ADMIN' : 'STUDENT',
        curriculumId: id === ownerId ? contextId : null,
      })),
    });
    await prisma.course.createMany({
      data: [courseA, courseB].map((id) => ({
        id,
        code: `${prefix}-${id}`,
        name: 'Identifier case course',
        credits: 3,
        difficultyLevel: 2,
      })),
    });
    for (const courseId of [courseA, courseB]) {
      const member = await prisma.curriculumCourse.create({
        data: { curriculumId: contextId, courseId },
      });
      await prisma.curriculumPlacement.create({
        data: {
          curriculumCourseId: member.id,
          academicYear: 1,
          academicSemester: 1,
          sourceOrder: courseId === courseA ? 0 : 1,
        },
      });
    }
    planId = (
      await prisma.studyPlan.create({
        data: {
          userId: ownerId,
          name: 'Identifier fixture plan',
          semesters: {
            create: {
              semester: 'FALL',
              year: 2026,
              courses: [{ courseId: courseB, position: 0 }],
              totalCredits: 3,
              difficultyScore: 2,
            },
          },
        },
      })
    ).id;
    await prisma.gradeAttempt.create({
      data: { userId: ownerId, courseId: courseA, requestId: randomUUID(), score: 81 },
    });
  });

  beforeEach(async () => {
    await prisma.studentRecord.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.studentRecord.createMany({
      data: [
        {
          userId: ownerId,
          courseId: courseA,
          status: 'COMPLETED',
          grade: 'B+',
          gradePoints: 3.5,
          createdAt: new Date('2026-10-01T00:00:00Z'),
        },
        {
          userId: ownerId,
          courseId: courseB,
          status: 'PLANNED',
          createdAt: new Date('2026-10-02T00:00:00Z'),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.curriculum.deleteMany({ where: { id: contextId } });
    await prisma.course.deleteMany({ where: { id: { in: [courseA, courseB] } } });
    await prisma.$disconnect();
  });

  it.each(['', '/records', '/progress'])(
    'returns the same owner view for uppercase and lowercase UUIDs on %s',
    async (suffix) => {
      const lowercase = await get(`/api/users/${ownerId}${suffix}`);
      const uppercase = await get(`/api/users/${ownerId.toUpperCase()}${suffix}`);
      expect(lowercase.status).toBe(200);
      expect(uppercase.status).toBe(200);
      expect(uppercase.body).toEqual(lowercase.body);
    },
  );

  it('normalizes direct recommendation userId queries rather than returning an absent text ID', async () => {
    const lower = await get(directPaths(ownerId)[0]);
    const upper = await get(directPaths(ownerId.toUpperCase())[0]);
    expect(lower.status).toBe(200);
    expect(upper.status).toBe(200);
    expect(upper.body).toEqual(lower.body);
    expect(upper.body.data.scope.curriculumId).toBe(contextId);
    expect(upper.body.data.courses.map((course: { id: string }) => course.id)).toEqual([courseB]);
  });

  it('normalizes direct study-plan userId queries and returns the actual saved plan', async () => {
    const lower = await get(directPaths(ownerId)[1]);
    const upper = await get(directPaths(ownerId.toUpperCase())[1]);
    expect(lower.status).toBe(200);
    expect(upper.status).toBe(200);
    expect(upper.body).toEqual(lower.body);
    expect(upper.body.count).toBe(1);
    expect(upper.body.data[0]).toMatchObject({ id: planId, userId: ownerId });
  });

  it('gives administrators identical target views for either UUID casing', async () => {
    const lowerPaths = [...userPaths(ownerId), ...directPaths(ownerId)];
    const upperPaths = [...userPaths(ownerId.toUpperCase()), ...directPaths(ownerId.toUpperCase())];
    for (let index = 0; index < lowerPaths.length; index++) {
      const lower = await get(lowerPaths[index], adminId);
      const upper = await get(upperPaths[index], adminId);
      expect(lower.status).toBe(200);
      expect(upper.status).toBe(200);
      expect(upper.body).toEqual(lower.body);
    }
  });

  it('keeps another student and a UUID-shaped student alias outside the target owner scope', async () => {
    for (const actor of [otherId, ambiguousId]) {
      for (const id of [ownerId, ownerId.toUpperCase()]) {
        for (const path of [...userPaths(id), ...directPaths(id)]) {
          const response = await get(path, actor);
          expect(response.status).toBe(403);
          expect(response.body).not.toHaveProperty('data');
        }
      }
    }
  });

  it('preserves the exact casing of non-UUID student aliases and rejects alternate casing', async () => {
    for (const suffix of ['', '/records', '/progress']) {
      const exact = await get(`/api/users/${ownerStudentId}${suffix}`);
      const altered = await get(`/api/users/${ownerStudentId.toUpperCase()}${suffix}`);
      expect(exact.status).toBe(200);
      expect(altered.status).toBe(403);
    }
    for (const path of directPaths(ownerStudentId)) expect((await get(path)).status).toBe(403);
  });

  it('reports missing uppercase UUID targets to administrators without resolving student aliases', async () => {
    const absentId = `a${randomUUID().slice(1)}`.toUpperCase();
    for (const path of userPaths(absentId)) expect((await get(path, adminId)).status).toBe(404);
    expect((await get(directPaths(absentId)[0], adminId)).status).toBe(404);
    const emptyPlans = await get(directPaths(absentId)[1], adminId);
    expect(emptyPlans.status).toBe(200);
    expect(emptyPlans.body).toMatchObject({ data: [], count: 0 });
  });

  it('normalizes uppercase record writes to the same owner and retains other-owner write guards', async () => {
    const invalid = await request(app)
      .post(`/api/users/${ownerId.toUpperCase()}/records`)
      .set('Cookie', cookie())
      .send({ courseId: 'invalid', status: 'COMPLETED' });
    expect(invalid.status).toBe(400);
    const written = await request(app)
      .post(`/api/users/${ownerId.toUpperCase()}/records`)
      .set('Cookie', cookie())
      .send({ courseId: courseB, status: 'COMPLETED' });
    expect(written.status).toBe(200);
    expect(written.body.data).toMatchObject({
      userId: ownerId,
      courseId: courseB,
      status: 'COMPLETED',
    });
    expect(
      await prisma.studentRecord.count({ where: { userId: ownerId, courseId: courseB } }),
    ).toBe(1);
    const blocked = await request(app)
      .post(`/api/users/${ownerId.toUpperCase()}/records`)
      .set('Cookie', cookie(otherId))
      .send({ courseId: courseB, status: 'PLANNED' });
    expect(blocked.status).toBe(403);
    expect(await prisma.studentRecord.count({ where: { userId: otherId } })).toBe(0);
  });

  it('leaves progress, immutable grades and cached plans unchanged during normalized reads', async () => {
    const snapshot = async () => ({
      records: await prisma.studentRecord.findMany({
        where: { userId: ownerId },
        orderBy: { id: 'asc' },
      }),
      attempts: await prisma.gradeAttempt.findMany({
        where: { userId: ownerId },
        orderBy: { id: 'asc' },
      }),
      plans: await prisma.studyPlan.findMany({
        where: { userId: ownerId },
        include: { semesters: true },
      }),
    });
    const before = await snapshot();
    for (const path of [
      ...userPaths(ownerId.toUpperCase()),
      ...directPaths(ownerId.toUpperCase()),
    ]) {
      expect((await get(path)).status).toBe(200);
    }
    expect(await snapshot()).toEqual(before);
  });
});
