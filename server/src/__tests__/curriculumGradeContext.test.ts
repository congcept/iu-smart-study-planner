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
  const choices = (index = 0) => request(app).get(`${path}/courses`).set('Cookie', cookie(index));
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

  it('returns the cookie owner and stored fork context on both read and append', async () => {
    const expected = { userId: users[0], curriculumId: contexts[0], isGpaPath: true };
    expect((await read()).body.data.scope).toEqual(expected);
    expect((await append('A', 90)).body.data.scope).toEqual(expected);
  });

  it('reports a nonfork context with numeric scores and a null path', async () => {
    const saved = await append('A', 90, randomUUID(), 1);
    const refreshed = await read(1);
    for (const response of [saved, refreshed]) {
      expect(response.body.data.scope).toEqual({
        userId: users[1],
        curriculumId: contexts[1],
        isGpaPath: false,
      });
      expect(response.body.data.summary).toMatchObject({ gpa100: 90, gpaPath: null });
    }
  });

  it('retains the explicit legacy policy for an unassigned account', async () => {
    const response = await append('A', 90, randomUUID(), 2);
    expect(response.body.data.scope).toEqual({
      userId: users[2],
      curriculumId: null,
      isGpaPath: true,
    });
    expect(response.body.data.summary.gpaPath).toBe('THESIS');
  });

  it('refreshes scope and eligible summary together after a stored context change', async () => {
    await append('A', 90);
    const outside = await historical('OUTSIDE', 40);
    const previous = await history();
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[1] } });
    const response = await read();
    expect(response.body.data.scope).toEqual({
      userId: users[0],
      curriculumId: contexts[1],
      isGpaPath: false,
    });
    expect(response.body.data.summary).toMatchObject({
      gpa100: 65,
      gpaPath: null,
      gradedCourseCount: 2,
    });
    expect(response.body.data.attempts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: outside.id })]),
    );
    expect(await history()).toEqual(previous);
  });

  it('does not accept body scope claims or mutate a grade on rejected claims', async () => {
    const response = await request(app)
      .post(path)
      .set('Cookie', cookie())
      .send({
        courseId: courses.A,
        requestId: randomUUID(),
        score: 90,
        scope: { userId: users[1], curriculumId: contexts[1], isGpaPath: false },
      });
    expect(response.status).toBe(400);
    expect(await history()).toEqual([]);
    expect((await read()).body.data.scope).toEqual({
      userId: users[0],
      curriculumId: contexts[0],
      isGpaPath: true,
    });
  });

  it('offers only placed curriculum members, once, with no global placement/category metadata', async () => {
    const member = await prisma.curriculumCourse.findUniqueOrThrow({
      where: { curriculumId_courseId: { curriculumId: contexts[0], courseId: courses.A } },
    });
    const extra = await prisma.curriculumPlacement.create({
      data: { curriculumCourseId: member.id, sourceOrder: 99 },
    });
    try {
      const response = await choices();
      expect(response.status).toBe(200);
      expect(response.body.data.scope).toEqual({
        userId: users[0],
        curriculumId: contexts[0],
        isGpaPath: true,
      });
      expect(response.body.data.courses.map((course: { id: string }) => course.id).sort()).toEqual(
        [courses.A, courses.B, courses.PT, courses.ZERO].sort(),
      );
      for (const course of response.body.data.courses)
        expect(Object.keys(course).sort()).toEqual(['code', 'id', 'name']);
      expect(response.body.data.courses.map((course: { code: string }) => course.code)).toEqual(
        [...response.body.data.courses.map((course: { code: string }) => course.code)].sort(),
      );
    } finally {
      await prisma.curriculumPlacement.delete({ where: { id: extra.id } });
    }
  });

  it('retains the basic global course choices only for a confirmed unassigned account', async () => {
    const response = await choices(2);
    expect(response.body.data.scope).toEqual({
      userId: users[2],
      curriculumId: null,
      isGpaPath: true,
    });
    expect(response.body.data.courses).toEqual(
      await prisma.course.findMany({
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      }),
    );
  });

  it('uses the other account context without the first account courses or fork policy', async () => {
    const response = await choices(1);
    expect(response.body.data.scope).toEqual({
      userId: users[1],
      curriculumId: contexts[1],
      isGpaPath: false,
    });
    expect(response.body.data.courses.map((course: { id: string }) => course.id).sort()).toEqual(
      [courses.A, courses.OUTSIDE].sort(),
    );
  });

  it('returns no choices for an empty assigned curriculum instead of global fallback', async () => {
    const empty = await prisma.curriculum.create({
      data: {
        code: `${prefix}-empty`,
        name: 'Empty simulated reference',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/empty',
      },
    });
    try {
      await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: empty.id } });
      const response = await choices();
      expect(response.body.data).toEqual({
        scope: { userId: users[0], curriculumId: empty.id, isGpaPath: false },
        courses: [],
      });
    } finally {
      await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[0] } });
      await prisma.curriculum.delete({ where: { id: empty.id } });
    }
  });

  it('refreshes choices after stored context changes without changing numeric attempts or progress', async () => {
    await append('A', 90);
    const attempts = await history();
    const records = await prisma.studentRecord.findMany({
      where: { userId: users[0] },
      orderBy: { id: 'asc' },
    });
    await choices();
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[1] } });
    const response = await choices();
    expect(response.body.data.scope.curriculumId).toBe(contexts[1]);
    expect(response.body.data.courses.map((course: { id: string }) => course.id).sort()).toEqual(
      [courses.A, courses.OUTSIDE].sort(),
    );
    expect(await history()).toEqual(attempts);
    expect(
      await prisma.studentRecord.findMany({ where: { userId: users[0] }, orderBy: { id: 'asc' } }),
    ).toEqual(records);
  });

  it('requires cookie authentication for grade-entry choices', async () => {
    expect((await request(app).get(`${path}/courses`)).status).toBe(401);
  });

  it.each(['userId', 'curriculumId'])(
    'rejects a %s query override instead of changing choice scope',
    async (key) => {
      const response = await request(app)
        .get(`${path}/courses`)
        .query({ [key]: key === 'userId' ? users[1] : contexts[1] })
        .set('Cookie', cookie());
      expect(response.status).toBe(400);
      expect((await choices()).body.data.scope.curriculumId).toBe(contexts[0]);
    },
  );

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

  const scopedAppend = (
    curriculumId: string | null,
    userId = users[0],
    requestId = randomUUID(),
    score = 80,
    cookieIndex = 0,
  ) =>
    request(app).post(path).set('Cookie', cookie(cookieIndex)).send({
      courseId: courses.A,
      requestId,
      score,
      expectedScope: { userId, curriculumId },
    });

  it('saves with a matching explicit context and leaves legacy progress unchanged', async () => {
    const before = await prisma.studentRecord.findMany({
      where: { userId: users[0] },
      orderBy: { id: 'asc' },
    });
    expect((await scopedAppend(contexts[0])).status).toBe(200);
    expect(await history()).toHaveLength(1);
    expect(
      await prisma.studentRecord.findMany({ where: { userId: users[0] }, orderBy: { id: 'asc' } }),
    ).toEqual(before);
  });

  it('accepts explicit null only for an unassigned owner', async () => {
    expect((await scopedAppend(null, users[2], randomUUID(), 80, 2)).status).toBe(200);
    expect(await prisma.gradeAttempt.count({ where: { userId: users[2] } })).toBe(1);
  });

  it.each(['null-to-assigned', 'assigned-to-null', 'assigned-to-other'])(
    'rejects a new stale context write (%s) even for a course common to both contexts',
    async (change) => {
      const expected = change === 'null-to-assigned' ? null : contexts[0];
      const current = change === 'assigned-to-null' ? null : contexts[1];
      await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: current } });
      const before = await prisma.studentRecord.findMany({
        where: { userId: users[0] },
        orderBy: { id: 'asc' },
      });
      const response = await scopedAppend(expected);
      expect(response.status).toBe(409);
      expect(response.body.error).toMatch(/curriculum changed/);
      expect(await history()).toEqual([]);
      expect(
        await prisma.studentRecord.findMany({
          where: { userId: users[0] },
          orderBy: { id: 'asc' },
        }),
      ).toEqual(before);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: users[0] } })).curriculumId).toBe(
        current,
      );
    },
  );

  it('cannot redirect a write to the claimed owner when the cookie account changed', async () => {
    const response = await scopedAppend(contexts[0], users[0], randomUUID(), 80, 1);
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/account changed/);
    expect(await prisma.gradeAttempt.count({ where: { userId: { in: users } } })).toBe(0);
  });

  it('normalizes equivalent uppercase scope UUIDs', async () => {
    expect((await scopedAppend(contexts[0].toUpperCase(), users[0].toUpperCase())).status).toBe(
      200,
    );
    expect(await history()).toHaveLength(1);
  });

  it('recovers the exact committed request before testing changed curriculum preconditions', async () => {
    const requestId = randomUUID();
    expect((await scopedAppend(contexts[0], users[0], requestId)).status).toBe(200);
    const before = await history();
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[1] } });
    const retry = await scopedAppend(contexts[0], users[0], requestId);
    expect(retry.status).toBe(200);
    expect(retry.body.data.scope.curriculumId).toBe(contexts[1]);
    expect((await scopedAppend(contexts[0], users[0], requestId, 81)).status).toBe(409);
    expect(await history()).toEqual(before);
  });

  it('checks cookie ownership even when that cookie already has the same request key', async () => {
    const requestId = randomUUID();
    expect((await scopedAppend(contexts[1], users[1], requestId, 80, 1)).status).toBe(200);
    const before = await prisma.gradeAttempt.findMany({ where: { userId: users[1] } });
    expect((await scopedAppend(contexts[0], users[0], requestId, 80, 1)).status).toBe(409);
    expect(await prisma.gradeAttempt.findMany({ where: { userId: users[1] } })).toEqual(before);
    expect(await history()).toEqual([]);
  });

  it('deduplicates concurrent scoped retries without storing client scope claims', async () => {
    const requestId = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => scopedAppend(contexts[0], users[0], requestId)),
    );
    expect(responses.every(({ status }) => status === 200)).toBe(true);
    expect(await history()).toHaveLength(1);
    expect((await history())[0]).not.toHaveProperty('expectedScope');
  });

  it.each([
    null,
    {},
    { userId: users[0] },
    { curriculumId: contexts[0] },
    { userId: 'invalid', curriculumId: contexts[0] },
    { userId: users[0], curriculumId: 'CS' },
    { userId: users[0], curriculumId: contexts[0], role: 'ADMIN' },
  ])('rejects malformed scope preconditions %j without new history', async (expectedScope) => {
    const response = await request(app).post(path).set('Cookie', cookie()).send({
      courseId: courses.A,
      requestId: randomUUID(),
      score: 80,
      expectedScope,
    });
    expect(response.status).toBe(400);
    expect(await history()).toEqual([]);
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
