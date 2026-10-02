import { randomUUID } from 'crypto';
import request from 'supertest';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';

describe('current-student progress API (PostgreSQL)', () => {
  const runId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const courses = Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map((name) => [name, randomUUID()]));
  const cookie = `${AUTH_COOKIE_NAME}=${issueToken(userId)}`;
  const complete = (name: string, body: Record<string, unknown> = {}) =>
    request(app)
      .post('/api/users/me/complete')
      .set('Cookie', cookie)
      .send({ courseId: courses[name], ...body });
  const progress = () => request(app).get('/api/users/me/progress').set('Cookie', cookie);

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [userId, otherUserId].map((id) => ({
        id,
        studentId: `progress-test-${id}`,
        name: 'Progress test',
        email: `${id}@example.test`,
      })),
    });
    await prisma.course.createMany({
      data: Object.entries(courses).map(([name, id]) => ({
        id,
        code: `PROGRESS-${runId}-${name}`,
        name,
        credits: 3,
        difficultyLevel: 2,
      })),
    });
  });
  beforeEach(async () => {
    await prisma.studentRecord.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.prerequisite.deleteMany({ where: { courseId: { in: Object.values(courses) } } });
    await prisma.prerequisite.createMany({
      data: [
        { courseId: courses.B, prerequisiteId: courses.A, isStrict: false, isCorequisite: true },
        { courseId: courses.C, prerequisiteId: courses.B },
      ],
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.course.deleteMany({ where: { id: { in: Object.values(courses) } } });
    await prisma.$disconnect();
  });

  it('requires a cookie session for both current-student endpoints', async () => {
    expect((await request(app).get('/api/users/me/progress')).status).toBe(401);
    expect(
      (await request(app).post('/api/users/me/complete').send({ courseId: courses.A })).status,
    ).toBe(401);
    expect((await progress()).body.data).toEqual({ completedIds: {}, plannedIds: [] });
  });

  it('round-trips completion claims and planned IDs without exposing another student', async () => {
    await prisma.studentRecord.create({
      data: { userId: otherUserId, courseId: courses.C, status: 'COMPLETED' },
    });
    expect((await complete('A')).status).toBe(200);
    expect((await complete('B')).status).toBe(200);
    const claim = await complete('E', { electiveGroup: ' Elective Group 2 ' });
    expect(claim.body.data.completedIds).toEqual({
      [courses.A]: null,
      [courses.B]: null,
      [courses.E]: 'Elective Group 2',
    });
    const plan = await complete('D', { status: 'PLANNED', electiveGroup: 'Unused group' });
    expect(plan.body.data.plannedIds).toEqual([courses.D]);
    expect(plan.body.data.uncompletedCourseIds).toEqual([]);
    const restored = await request(app)
      .get(`/api/users/me/progress?userId=${otherUserId}`)
      .set('Cookie', cookie);
    expect(restored.status).toBe(200);
    expect(restored.body.data).toEqual({
      completedIds: claim.body.data.completedIds,
      plannedIds: [courses.D],
    });
    expect(
      await prisma.studentRecord.findUniqueOrThrow({
        where: { userId_courseId: { userId, courseId: courses.D } },
      }),
    ).toMatchObject({ electiveGroup: null });
  });

  it('blocks mandatory recommended/corequisite completion and preserves existing plans', async () => {
    await prisma.studentRecord.createMany({
      data: [
        { userId: otherUserId, courseId: courses.A, status: 'COMPLETED' },
        { userId, courseId: courses.B, status: 'PLANNED' },
      ],
    });
    const response = await complete('B');
    expect(response.status).toBe(409);
    expect(response.body.details[0].id).toBe(courses.A);
    expect((await progress()).body.data).toEqual({ completedIds: {}, plannedIds: [courses.B] });
  });

  it('returns the full reconciled snapshot after a transitive cascade in the same transaction', async () => {
    await complete('A');
    await complete('B');
    await complete('C');
    await complete('E', { electiveGroup: 'Elective Group 3' });
    await prisma.studentRecord.create({
      data: { userId: otherUserId, courseId: courses.C, status: 'COMPLETED' },
    });
    const response = await complete('A', { status: 'PLANNED' });
    expect(response.status).toBe(200);
    expect(response.body.data.uncompletedCourseIds.sort()).toEqual([courses.B, courses.C].sort());
    expect(response.body.data.completedIds).toEqual({ [courses.E]: 'Elective Group 3' });
    expect(response.body.data.plannedIds).toEqual([courses.A]);
    expect((await progress()).body.data).toEqual({
      completedIds: response.body.data.completedIds,
      plannedIds: response.body.data.plannedIds,
    });
    expect(
      await prisma.studentRecord.count({ where: { userId: otherUserId, courseId: courses.C } }),
    ).toBe(1);
  });

  it('removes a completion or plan using DROPPED and clears its elective claim', async () => {
    await complete('E', { electiveGroup: 'Elective Group 2' });
    const response = await complete('E', { status: 'DROPPED' });
    expect(response.body.data.completedIds).toEqual({});
    expect(response.body.data.plannedIds).toEqual([]);
    expect(
      await prisma.studentRecord.findUniqueOrThrow({
        where: { userId_courseId: { userId, courseId: courses.E } },
      }),
    ).toMatchObject({ status: 'DROPPED', electiveGroup: null });
    await complete('D', { status: 'PLANNED' });
    await complete('D', { status: 'DROPPED' });
    expect((await progress()).body.data.plannedIds).toEqual([]);
  });

  it('preserves claims and grade metadata during repeated completion without new values', async () => {
    await prisma.studentRecord.create({
      data: {
        userId,
        courseId: courses.E,
        status: 'COMPLETED',
        electiveGroup: 'Elective Group 2',
        grade: 'A',
        gradePoints: 4,
      },
    });
    const response = await complete('E');
    expect(response.body.data.completedIds[courses.E]).toBe('Elective Group 2');
    const record = await prisma.studentRecord.findUniqueOrThrow({
      where: { userId_courseId: { userId, courseId: courses.E } },
    });
    expect(record.grade).toBe('A');
    expect(record.gradePoints).toBe(4);
  });

  it.each([
    { userId: otherUserId },
    { electiveGroup: '' },
    { status: 'IN_PROGRESS' },
    { grade: 'A' },
  ])('rejects unsupported fields and invalid state without writes', async (body) => {
    expect((await complete('A', body)).status).toBe(400);
    expect(await prisma.studentRecord.count({ where: { userId } })).toBe(0);
  });

  it('returns 404 for an unknown course without changing progress', async () => {
    expect((await complete('A', { courseId: randomUUID() })).status).toBe(404);
    expect((await progress()).body.data).toEqual({ completedIds: {}, plannedIds: [] });
  });
});
