import { randomUUID } from 'crypto';
import { CourseStatus } from '@prisma/client';
import request from 'supertest';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';

describe('student record prerequisite transactions (PostgreSQL)', () => {
  const runId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const courses = Object.fromEntries(
    ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => [name, randomUUID()]),
  );
  const endpoints = ['records', 'records/toggle'];

  const write = (course: string, status: CourseStatus, endpoint = 'records') =>
    request(app)
      .post(`/api/users/${userId}/${endpoint}`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(userId)}`)
      .send({ courseId: courses[course], status });

  async function seedRecord(
    course: string,
    status: CourseStatus = CourseStatus.COMPLETED,
    owner = userId,
  ) {
    return prisma.studentRecord.create({
      data: { userId: owner, courseId: courses[course], status },
    });
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [userId, otherUserId].map((id) => ({
        id,
        studentId: `prereq-test-${id}`,
        email: `${id}@example.test`,
        name: 'Prerequisite test student',
      })),
    });
    await prisma.course.createMany({
      data: Object.entries(courses).map(([name, id]) => ({
        id,
        code: `TEST-${runId}-${name}`,
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
        ['B', 'A'],
        ['C', 'B'],
        ['D', 'B'],
        ['E', 'C'],
        ['E', 'D'],
      ].map(([course, prerequisite]) => ({
        courseId: courses[course],
        prerequisiteId: courses[prerequisite],
      })),
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.course.deleteMany({ where: { id: { in: Object.values(courses) } } });
    await prisma.$disconnect();
  });

  it.each(endpoints)(
    'blocks completion through %s without changing an existing plan',
    async (endpoint) => {
      await seedRecord('A', CourseStatus.IN_PROGRESS);
      const planned = await seedRecord('B', CourseStatus.PLANNED);
      await seedRecord('A', CourseStatus.COMPLETED, otherUserId);

      const response = await write('B', CourseStatus.COMPLETED, endpoint);

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.details).toEqual([
        { id: courses.A, code: `TEST-${runId}-A`, name: 'A' },
      ]);
      expect(await prisma.studentRecord.findUnique({ where: { id: planned.id } })).toEqual(planned);
    },
  );

  it.each(endpoints)(
    'allows completion through %s after all prerequisites are completed',
    async (endpoint) => {
      await seedRecord('A');
      const response = await write('B', CourseStatus.COMPLETED, endpoint);

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('COMPLETED');
      expect(response.body.details.uncompletedCourseIds).toEqual([]);
      expect(
        await prisma.studentRecord.count({
          where: { userId, courseId: courses.B, status: CourseStatus.COMPLETED },
        }),
      ).toBe(1);
    },
  );

  it.each([
    ['recommended', { isStrict: false }],
    ['corequisite', { isCorequisite: true }],
  ] as const)('requires a %s prerequisite under the mandatory policy', async (_label, flags) => {
    await prisma.prerequisite.updateMany({ where: { courseId: courses.B }, data: flags });

    const blocked = await write('B', CourseStatus.COMPLETED);
    expect(blocked.status).toBe(409);
    expect(blocked.body.details.map((course: { id: string }) => course.id)).toEqual([courses.A]);
    await seedRecord('A');
    expect((await write('B', CourseStatus.COMPLETED)).status).toBe(200);
  });

  it('preserves student ID lookup for existing API callers', async () => {
    const response = await request(app)
      .post(`/api/users/prereq-test-${userId}/records`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(userId)}`)
      .send({
        courseId: courses.A,
        status: 'COMPLETED',
      });
    expect(response.status).toBe(200);
    expect(response.body.data.userId).toBe(userId);
  });

  it.each(endpoints)(
    'cascades through incomplete intermediates and shared dependents via %s',
    async (endpoint) => {
      for (const course of ['A', 'C', 'D', 'E', 'F']) await seedRecord(course);
      await seedRecord('B', CourseStatus.PLANNED);
      await seedRecord('E', CourseStatus.COMPLETED, otherUserId);
      const status = endpoint === 'records/toggle' ? CourseStatus.PLANNED : CourseStatus.FAILED;

      const response = await write('A', status, endpoint);

      expect(response.status).toBe(200);
      expect(new Set(response.body.details.uncompletedCourseIds)).toEqual(
        new Set([courses.C, courses.D, courses.E]),
      );
      const records = await prisma.studentRecord.findMany({ where: { userId } });
      expect(
        records
          .filter((record) => record.status === CourseStatus.COMPLETED)
          .map((record) => record.courseId),
      ).toEqual([courses.F]);
      expect(records.find((record) => record.courseId === courses.B)?.status).toBe(
        CourseStatus.PLANNED,
      );
      expect(records.find((record) => record.courseId === courses.A)?.status).toBe(
        endpoint === 'records/toggle' ? undefined : CourseStatus.FAILED,
      );
      expect(
        await prisma.studentRecord.count({ where: { userId: otherUserId, courseId: courses.E } }),
      ).toBe(1);
    },
  );

  it('handles cycles without returning the initiating course or duplicating dependents', async () => {
    await prisma.prerequisite.create({ data: { courseId: courses.A, prerequisiteId: courses.B } });
    await prisma.prerequisite.create({ data: { courseId: courses.C, prerequisiteId: courses.A } });
    for (const course of ['A', 'B', 'C']) await seedRecord(course);

    const response = await write('A', CourseStatus.PLANNED, 'records/toggle');

    expect(response.status).toBe(200);
    expect(new Set(response.body.details.uncompletedCourseIds)).toEqual(
      new Set([courses.B, courses.C]),
    );
    expect(response.body.details.uncompletedCourseIds).toHaveLength(2);
    expect(await prisma.studentRecord.count({ where: { userId } })).toBe(0);
  });

  it('keeps toggle removal idempotent and returns real not-found errors', async () => {
    expect((await write('A', CourseStatus.PLANNED, 'records/toggle')).status).toBe(200);
    expect((await write('A', CourseStatus.PLANNED, 'records/toggle')).status).toBe(200);
    expect(await prisma.studentRecord.count({ where: { userId } })).toBe(0);
    const missingCourse = await request(app)
      .post(`/api/users/${userId}/records/toggle`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(userId)}`)
      .send({ courseId: randomUUID(), status: 'PLANNED' });
    expect(missingCourse.status).toBe(404);
    const missingUser = await request(app)
      .post(`/api/users/${randomUUID()}/records`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(userId)}`)
      .send({ courseId: courses.A, status: 'COMPLETED' });
    expect(missingUser.status).toBe(403);
    const invalid = await request(app)
      .post(`/api/users/${userId}/records/toggle`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(userId)}`)
      .send({ courseId: 'invalid', status: 'COMPLETED' });
    expect(invalid.status).toBe(400);
  });

  it('does not leave an invalid completion after concurrent prerequisite removal', async () => {
    await seedRecord('A');

    const [removed, completed] = await Promise.all([
      write('A', CourseStatus.PLANNED, 'records/toggle'),
      write('B', CourseStatus.COMPLETED),
    ]);

    expect(removed.status).toBe(200);
    expect([200, 409]).toContain(completed.status);
    expect(
      await prisma.studentRecord.count({ where: { userId, status: CourseStatus.COMPLETED } }),
    ).toBe(0);
  });
});
