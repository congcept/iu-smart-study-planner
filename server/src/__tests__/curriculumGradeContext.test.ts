import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { readStudentGradeSnapshot } from '../services/studentGradeContext';

describe('account-context grades (PostgreSQL)', () => {
  const prefix = `grade-context-${randomUUID()}`;
  const contexts: string[] = [randomUUID(), randomUUID()];
  const users: string[] = [randomUUID(), randomUUID(), randomUUID()];
  const courses: Record<string, string> = Object.fromEntries(
    ['A', 'B', 'OUTSIDE', 'ZERO', 'UNPLACED'].map((key) => [key, randomUUID()]),
  );
  const ownedCourses = Object.values(courses);
  let physicalId: string;
  const cookie = (index = 0) => `${AUTH_COOKIE_NAME}=${issueToken(users[index])}`;
  const path = '/api/users/me/grades';
  const read = (index = 0) => request(app).get(path).set('Cookie', cookie(index));
  const append = (course: string, score: number, requestId = randomUUID(), index = 0) =>
    request(app)
      .post(path)
      .set('Cookie', cookie(index))
      .send({ courseId: courses[course], requestId, score });
  const historical = (course: string, score: number) =>
    prisma.gradeAttempt.create({
      data: { userId: users[0], courseId: courses[course], requestId: randomUUID(), score },
    });
  const history = () =>
    prisma.gradeAttempt.findMany({ where: { userId: users[0] }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated curriculum',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
        isGpaPath: index === 0,
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
        credits: key === 'B' ? 4 : key === 'ZERO' ? 0 : 3,
        difficultyLevel: 2,
      })),
    });
    const physical = await prisma.course.findUnique({ where: { code: 'PT001IU' } });
    if (physical) physicalId = physical.id;
    else {
      physicalId = randomUUID();
      ownedCourses.push(physicalId);
      await prisma.course.create({
        data: {
          id: physicalId,
          code: 'PT001IU',
          name: 'Physical training',
          credits: 2,
          difficultyLevel: 1,
        },
      });
    }
    courses.PT = physicalId;
    for (const [index, keys] of [
      ['A', 'B', 'ZERO', 'UNPLACED', 'PT'],
      ['A', 'OUTSIDE'],
    ].entries()) {
      for (const [sourceOrder, key] of keys.entries()) {
        const member = await prisma.curriculumCourse.create({
          data: { curriculumId: contexts[index], courseId: courses[key] },
        });
        if (key !== 'UNPLACED')
          await prisma.curriculumPlacement.create({
            data: { curriculumCourseId: member.id, sourceOrder },
          });
      }
    }
  });
  beforeEach(async () => {
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[0] } });
    await prisma.gradeAttempt.deleteMany({ where: { userId: { in: users } } });
    await prisma.studentRecord.deleteMany({ where: { userId: { in: users } } });
    await prisma.studentRecord.createMany({
      data: ['A', 'B', 'OUTSIDE', 'ZERO', 'PT'].map((key) => ({
        userId: users[0],
        courseId: courses[key],
        status: 'COMPLETED',
        grade: key === 'A' ? 'A' : null,
        gradePoints: key === 'A' ? 4 : null,
      })),
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: ownedCourses } } });
    await prisma.$disconnect();
  });

  it('preserves nonmember history but excludes it from numeric GPA and coverage', async () => {
    const old = await historical('OUTSIDE', 100);
    const response = await append('A', 50);
    expect(response.status).toBe(200);
    expect(response.body.data.attempts).toHaveLength(2);
    expect(response.body.data.attempts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: old.id })]),
    );
    expect(response.body.data.summary).toMatchObject({
      gpa100: 50,
      gpaPath: 'ALTERNATIVE',
      gradedCredits: 3,
      gradedCourseCount: 1,
    });
    expect(response.body.data.completedCoursesWithoutNumericGrades).toEqual([courses.B]);
  });

  it('uses highest retakes and member credit weights while retaining lower attempts', async () => {
    await append('A', 40);
    await append('A', 80);
    await append('A', 20);
    const response = await append('B', 60);
    expect(response.body.data.attempts).toHaveLength(4);
    expect(response.body.data.summary.gpa100).toBeCloseTo(480 / 7, 12);
    expect(response.body.data.summary).toMatchObject({
      gradedCredits: 7,
      gradedCourseCount: 2,
      gpaPath: 'ALTERNATIVE',
    });
    expect(response.body.data.completedCoursesWithoutNumericGrades).toEqual([]);
  });

  it('preserves decimal-exact GPA fork policy at 70 inside the assigned context', async () => {
    await append('A', 93.32);
    const boundary = await append('B', 52.51);
    expect(boundary.body.data.summary.gpa100).toBe(70);
    expect(boundary.body.data.summary.gpaPath).toBe('ALTERNATIVE');
    expect((await append('B', 52.511)).body.data.summary.gpaPath).toBe('THESIS');
  });

  it('does not invent a GPA fork in a context whose metadata disables it', async () => {
    const response = await append('A', 90, randomUUID(), 1);
    expect(response.status).toBe(200);
    expect(response.body.data.summary).toMatchObject({
      gpa100: 90,
      gpaPath: null,
      gradedCredits: 3,
    });
  });

  it('reports only member numeric gaps without converting legacy letters', async () => {
    await historical('OUTSIDE', 100);
    const response = await read();
    expect(response.body.data.summary.gpa100).toBeNull();
    expect(response.body.data.completedCoursesWithoutNumericGrades).toEqual(
      [courses.A, courses.B].sort(),
    );
  });

  it('retains PT and zero-credit attempts while excluding them from GPA and gaps', async () => {
    await append('PT', 100);
    const response = await append('ZERO', 100);
    expect(response.status).toBe(200);
    expect(response.body.data.attempts).toHaveLength(2);
    expect(response.body.data.summary).toMatchObject({
      gpa100: null,
      gpaPath: null,
      gradedCredits: 0,
      gradedCourseCount: 0,
    });
    expect(response.body.data.completedCoursesWithoutNumericGrades).toEqual(
      [courses.A, courses.B].sort(),
    );
  });

  it.each(['OUTSIDE', 'UNPLACED'])(
    'rejects a new %s grade atomically without changing progress or attempts',
    async (course) => {
      const before = await prisma.studentRecord.findMany({
        where: { userId: users[0] },
        orderBy: { id: 'asc' },
      });
      expect((await append(course, 80)).status).toBe(409);
      expect(await history()).toEqual([]);
      expect(
        await prisma.studentRecord.findMany({
          where: { userId: users[0] },
          orderBy: { id: 'asc' },
        }),
      ).toEqual(before);
    },
  );

  it('keeps grade entry independent of completion even in context, including score zero', async () => {
    await prisma.studentRecord.deleteMany({ where: { userId: users[0], courseId: courses.A } });
    const response = await append('A', 0);
    expect(response.status).toBe(200);
    expect(response.body.data.summary.gpa100).toBe(0);
    expect(
      await prisma.studentRecord.count({ where: { userId: users[0], courseId: courses.A } }),
    ).toBe(0);
  });

  it('recovers an immutable retry after context change and rejects a new nonmember write', async () => {
    const requestId = randomUUID();
    expect((await append('B', 91, requestId)).status).toBe(200);
    const before = await history();
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[1] } });
    const retry = await append('B', 91, requestId);
    expect(retry.status).toBe(200);
    expect(retry.body.data.summary.gpa100).toBeNull();
    expect(retry.body.data.attempts).toHaveLength(1);
    expect((await append('B', 92, requestId)).status).toBe(409);
    expect((await append('B', 91)).status).toBe(409);
    expect(await history()).toEqual(before);
  });

  it('keeps grade data scoped to the cookie account despite user/context queries', async () => {
    await append('A', 60);
    await append('A', 95, randomUUID(), 1);
    const response = await read().query({ userId: users[1], curriculumId: contexts[1] });
    expect(response.body.data.summary).toMatchObject({ gpa100: 60, gpaPath: 'ALTERNATIVE' });
    expect(response.body.data.attempts).toHaveLength(1);
  });

  it('keeps summary membership on one snapshot during a concurrent simulated context change', async () => {
    await historical('A', 50);
    await historical('OUTSIDE', 100);
    await prisma.$transaction(
      async (tx) => {
        const before = await readStudentGradeSnapshot(tx, users[0]);
        await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[1] } });
        expect(await readStudentGradeSnapshot(tx, users[0])).toEqual(before);
        expect(before.summary.gpa100).toBe(50);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    expect((await read()).body.data.summary).toMatchObject({
      gpa100: 75,
      gpaPath: null,
      gradedCredits: 6,
    });
    expect(await history()).toHaveLength(2);
  });

  it('handles concurrent identical context grade retries as one immutable attempt', async () => {
    const requestId = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => append('A', 80, requestId)),
    );
    expect(responses.every(({ status }) => status === 200)).toBe(true);
    expect(await history()).toHaveLength(1);
  });

  it('preserves legacy metadata and unknown graduation totals while recording numeric grades', async () => {
    const before = await prisma.studentRecord.findMany({
      where: { userId: users[0] },
      orderBy: { id: 'asc' },
    });
    await append('A', 80);
    expect(
      await prisma.studentRecord.findMany({ where: { userId: users[0] }, orderBy: { id: 'asc' } }),
    ).toEqual(before);
    expect(
      (await prisma.curriculum.findUniqueOrThrow({ where: { id: contexts[0] } })).totalCredits,
    ).toBeNull();
  });

  it('retains unrestricted global course history and GPA policy for an unassigned account', async () => {
    const response = await append('OUTSIDE', 100, randomUUID(), 2);
    expect(response.status).toBe(200);
    expect(response.body.data.summary).toMatchObject({
      gpa100: 100,
      gpaPath: 'THESIS',
      gradedCredits: 3,
    });
  });
});
