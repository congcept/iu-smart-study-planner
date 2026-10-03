import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';

describe('account-context completion and import (PostgreSQL)', () => {
  const prefix = `context-progress-${randomUUID()}`;
  const contexts: string[] = [randomUUID(), randomUUID()];
  const users: string[] = [randomUUID(), randomUUID(), randomUUID()];
  const courses: Record<string, string> = Object.fromEntries(
    ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((key) => [key, randomUUID()]),
  );
  const cookie = (index = 0) => `${AUTH_COOKIE_NAME}=${issueToken(users[index])}`;
  const complete = (
    course: string,
    status = 'COMPLETED',
    electiveGroup?: string | null,
    index = 0,
    query = '',
  ) =>
    request(app)
      .post(`/api/users/me/complete${query}`)
      .set('Cookie', cookie(index))
      .send({
        courseId: courses[course],
        status,
        ...(electiveGroup !== undefined ? { electiveGroup } : {}),
      });
  const importProgress = (
    completedIds: Record<string, string | null>,
    plannedIds: string[] = [],
    index = 0,
  ) =>
    request(app)
      .post('/api/users/me/progress')
      .set('Cookie', cookie(index))
      .send({ completedIds, plannedIds });
  const records = (index = 0) =>
    prisma.studentRecord.findMany({
      where: { userId: users[index] },
      orderBy: { courseId: 'asc' },
    });
  const saved = (course: string, index = 0) =>
    prisma.studentRecord.findUnique({
      where: { userId_courseId: { userId: users[index], courseId: courses[course] } },
    });
  const seedCompletion = (course: string, index = 0) =>
    prisma.studentRecord.create({
      data: { userId: users[index], courseId: courses[course], status: 'COMPLETED' },
    });

  beforeAll(async () => {
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated curriculum',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/source',
      })),
    });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        email: `${id}@example.test`,
        name: 'Simulated student',
        curriculumId: contexts[index] ?? null,
      })),
    });
    await prisma.course.createMany({
      data: Object.entries(courses).map(([key, id]) => ({
        id,
        code: `${prefix}-${key}`,
        name: key,
        credits: 3,
        difficultyLevel: 2,
        electiveGroup: 'Wrong legacy group',
      })),
    });
    for (const [index, keys] of [
      ['A', 'B', 'C', 'E', 'F', 'G'],
      ['A', 'B', 'D', 'E', 'F'],
    ].entries()) {
      for (const key of keys) {
        const member = await prisma.curriculumCourse.create({
          data: { curriculumId: contexts[index], courseId: courses[key] },
        });
        if (key === 'G') continue;
        const groups =
          key === 'E'
            ? index === 0
              ? ['Group 1', 'Group 2']
              : ['Other group']
            : key === 'F'
              ? [null, 'Group 1']
              : [null];
        await prisma.curriculumPlacement.createMany({
          data: groups.map((electiveGroup, sourceOrder) => ({
            curriculumCourseId: member.id,
            academicYear: 1,
            academicSemester: 1,
            electiveGroup,
            electiveSelectCount: electiveGroup ? 1 : null,
            sourceOrder,
          })),
        });
      }
    }
    await prisma.prerequisite.createMany({
      data: [
        { courseId: courses.B, prerequisiteId: courses.D },
        { courseId: courses.C, prerequisiteId: courses.B },
        { courseId: courses.D, prerequisiteId: courses.A },
      ],
    });
  });
  beforeEach(async () => {
    await prisma.studentRecord.deleteMany({ where: { userId: { in: users } } });
    await prisma.gradeAttempt.deleteMany({ where: { userId: { in: users } } });
    await prisma.courseRating.deleteMany({ where: { userId: { in: users } } });
    await prisma.curriculumPrerequisite.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.curriculumPrerequisite.createMany({
      data: [
        {
          curriculumId: contexts[0],
          courseId: courses.B,
          prerequisiteId: courses.A,
          isStrict: false,
          isCorequisite: true,
        },
        { curriculumId: contexts[0], courseId: courses.C, prerequisiteId: courses.B },
        { curriculumId: contexts[1], courseId: courses.B, prerequisiteId: courses.D },
      ],
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: Object.values(courses) } } });
    await prisma.$disconnect();
  });

  it('uses the cookie owner context and mandatory context edges instead of global prerequisites', async () => {
    expect((await complete('B')).status).toBe(409);
    expect((await complete('A')).status).toBe(200);
    const response = await complete(
      'B',
      'COMPLETED',
      null,
      0,
      `?curriculumId=${contexts[1]}&userId=${users[1]}`,
    );
    expect(response.status).toBe(200);
    expect(response.body.data.completedIds).toEqual({ [courses.A]: null, [courses.B]: null });
    expect(await records(1)).toEqual([]);
  });

  it('requires the other curriculum parent for the same global course', async () => {
    await seedCompletion('A', 1);
    expect((await complete('B', 'COMPLETED', null, 1)).status).toBe(409);
    expect((await complete('D', 'COMPLETED', null, 1)).status).toBe(200);
    expect((await complete('B', 'COMPLETED', null, 1)).status).toBe(200);
  });

  it.each(['COMPLETED', 'PLANNED', 'DROPPED'])(
    'rejects nonmember %s changes without altering history',
    async (status) => {
      const historical = await seedCompletion('D');
      expect((await complete('D', status)).status).toBe(409);
      expect(await saved('D')).toEqual(historical);
    },
  );

  it('rejects unplaced membership rather than guessing a legacy placement', async () => {
    expect((await complete('G')).status).toBe(409);
    expect(await records()).toEqual([]);
  });

  it.each([null, 'Wrong legacy group', 'Other group'])(
    'rejects invalid elective claim %s atomically',
    async (claim) => {
      expect((await complete('E', 'COMPLETED', claim)).status).toBe(409);
      expect(await records()).toEqual([]);
    },
  );

  it('accepts either repeated context group and retains an existing claim when omitted on retry', async () => {
    expect((await complete('E', 'COMPLETED', 'Group 1')).status).toBe(200);
    expect((await complete('E')).status).toBe(200);
    expect((await saved('E'))?.electiveGroup).toBe('Group 1');
    expect((await complete('E', 'COMPLETED', 'Group 2')).status).toBe(200);
    expect((await saved('E'))?.electiveGroup).toBe('Group 2');
  });

  it('allows null for a required appearance and a valid group for its repeated elective placement', async () => {
    expect((await complete('F', 'COMPLETED', null)).status).toBe(200);
    expect((await complete('F', 'COMPLETED', 'Group 1')).status).toBe(200);
    expect((await complete('A', 'COMPLETED', 'Group 1')).status).toBe(409);
  });

  it('cascades only through the assigned curriculum while preserving nonmember evidence', async () => {
    for (const key of ['A', 'B', 'C', 'D', 'F']) await seedCompletion(key);
    const nonmember = await saved('D');
    const response = await complete('A', 'DROPPED');
    expect(response.status).toBe(200);
    expect(response.body.data.uncompletedCourseIds.sort()).toEqual([courses.B, courses.C].sort());
    expect(response.body.data.completedIds).toEqual({ [courses.F]: null });
    expect(await saved('D')).toEqual(nonmember);
  });

  it('context progress hides nonmember history without deleting it or remapping claims', async () => {
    const historical = await seedCompletion('D');
    await complete('E', 'COMPLETED', 'Group 2');
    await complete('F', 'PLANNED');
    const response = await request(app).get('/api/users/me/progress').set('Cookie', cookie());
    expect(response.body.data).toEqual({
      completedIds: { [courses.E]: 'Group 2' },
      plannedIds: [courses.F],
    });
    expect(await saved('D')).toEqual(historical);
  });

  it('imports a reversed context chain with valid repeated elective claims atomically', async () => {
    const response = await importProgress(
      { [courses.C]: null, [courses.B]: null, [courses.A]: null, [courses.E]: 'Group 2' },
      [courses.F],
    );
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      completedIds: {
        [courses.A]: null,
        [courses.B]: null,
        [courses.C]: null,
        [courses.E]: 'Group 2',
      },
      plannedIds: [courses.F],
    });
  });

  it.each(['completed', 'planned'])(
    'rejects a nonmember %s import together with otherwise valid changes',
    async (kind) => {
      const response = await importProgress(
        { [courses.A]: null, ...(kind === 'completed' ? { [courses.D]: null } : {}) },
        kind === 'planned' ? [courses.D] : [courses.F],
      );
      expect(response.status).toBe(409);
      expect(await records()).toEqual([]);
    },
  );

  it('rejects an invalid imported claim without saving other completed or planned courses', async () => {
    expect(
      (await importProgress({ [courses.A]: null, [courses.E]: 'Other group' }, [courses.F])).status,
    ).toBe(409);
    expect(await records()).toEqual([]);
  });

  it('retains existing completion metadata when ignored archive claims differ', async () => {
    const existing = await prisma.studentRecord.create({
      data: {
        userId: users[0],
        courseId: courses.E,
        status: 'COMPLETED',
        electiveGroup: 'Group 1',
        grade: 'A',
        gradePoints: 4,
      },
    });
    const response = await importProgress({ [courses.E]: 'Other group' }, [courses.F]);
    expect(response.status).toBe(200);
    expect(response.body.data.completedIds[courses.E]).toBe('Group 1');
    expect(await saved('E')).toEqual(existing);
  });

  it('rejects newly imported context cycles instead of mutually unlocking their courses', async () => {
    await prisma.curriculumPrerequisite.create({
      data: { curriculumId: contexts[0], courseId: courses.A, prerequisiteId: courses.C },
    });
    expect(
      (
        await importProgress({ [courses.A]: null, [courses.B]: null, [courses.C]: null }, [
          courses.F,
        ])
      ).status,
    ).toBe(409);
    expect(await records()).toEqual([]);
  });

  it('preserves numeric retake and rating history when completion cascades in context', async () => {
    await seedCompletion('A');
    await seedCompletion('B');
    const grade = await prisma.gradeAttempt.create({
      data: { userId: users[0], courseId: courses.B, requestId: randomUUID(), score: 91 },
    });
    const rating = await prisma.courseRating.create({
      data: { userId: users[0], courseId: courses.B, rating: 4 },
    });
    expect((await complete('A', 'DROPPED')).status).toBe(200);
    expect(await prisma.gradeAttempt.findUniqueOrThrow({ where: { id: grade.id } })).toEqual(grade);
    expect(await prisma.courseRating.findUniqueOrThrow({ where: { id: rating.id } })).toEqual(
      rating,
    );
  });

  it('keeps context prerequisites valid when import races with uncompletion', async () => {
    await seedCompletion('A');
    const [importResponse, removal] = await Promise.all([
      importProgress({ [courses.B]: null }),
      complete('A', 'DROPPED'),
    ]);
    expect([200, 409]).toContain(importResponse.status);
    expect(removal.status).toBe(200);
    expect((await saved('A'))?.status).toBe('DROPPED');
    expect((await saved('B'))?.status).not.toBe('COMPLETED');
  });

  it('retains global legacy rules and arbitrary historical claims for unassigned accounts', async () => {
    await seedCompletion('A', 2);
    expect((await complete('B', 'COMPLETED', null, 2)).status).toBe(409);
    expect((await complete('D', 'COMPLETED', null, 2)).status).toBe(200);
    expect((await complete('B', 'COMPLETED', null, 2)).status).toBe(200);
    expect((await complete('E', 'COMPLETED', 'Legacy claim', 2)).status).toBe(200);
  });
});
