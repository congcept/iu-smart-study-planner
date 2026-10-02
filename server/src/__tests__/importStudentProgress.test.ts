import { randomUUID } from 'crypto';
import request from 'supertest';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';

describe('archived student progress import (PostgreSQL)', () => {
  const runId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const courses = Object.fromEntries(
    ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name) => [name, randomUUID()]),
  );
  const cookie = `${AUTH_COOKIE_NAME}=${issueToken(userId)}`;
  const importProgress = (body: Record<string, unknown>, query = '') =>
    request(app).post(`/api/users/me/progress${query}`).set('Cookie', cookie).send(body);
  const progress = () => request(app).get('/api/users/me/progress').set('Cookie', cookie);
  const records = () =>
    prisma.studentRecord.findMany({ where: { userId }, orderBy: { courseId: 'asc' } });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [userId, otherUserId].map((id) => ({
        id,
        studentId: `import-test-${id}`,
        name: 'Isolated import test',
        email: `${id}@example.test`,
      })),
    });
    await prisma.course.createMany({
      data: Object.entries(courses).map(([name, id]) => ({
        id,
        code: `IMPORT-${runId}-${name}`,
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

  it('requires a cookie session before importing any record', async () => {
    const response = await request(app)
      .post('/api/users/me/progress')
      .send({ completedIds: { [courses.A]: null }, plannedIds: [] });
    expect(response.status).toBe(401);
    expect(await records()).toEqual([]);
  });

  it('uses the cookie owner even when a query attempts to select another student', async () => {
    await prisma.studentRecord.create({
      data: { userId: otherUserId, courseId: courses.E, status: 'COMPLETED' },
    });
    const response = await importProgress(
      { completedIds: { [courses.A]: null }, plannedIds: [courses.D] },
      `?userId=${otherUserId}`,
    );
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      completedIds: { [courses.A]: null },
      plannedIds: [courses.D],
    });
    expect(
      await prisma.studentRecord.findMany({
        where: { userId: otherUserId },
        select: { courseId: true, status: true },
      }),
    ).toEqual([{ courseId: courses.E, status: 'COMPLETED' }]);
  });

  it('imports a reversed prerequisite chain and trims elective claims', async () => {
    const response = await importProgress({
      completedIds: {
        [courses.C]: null,
        [courses.B]: null,
        [courses.A]: null,
        [courses.E]: ' Elective Group 2 ',
      },
      plannedIds: [courses.D],
    });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      completedIds: {
        [courses.A]: null,
        [courses.B]: null,
        [courses.C]: null,
        [courses.E]: 'Elective Group 2',
      },
      plannedIds: [courses.D],
    });
    expect((await progress()).body.data).toEqual(response.body.data);
    expect(
      await prisma.studentRecord.findUniqueOrThrow({
        where: { userId_courseId: { userId, courseId: courses.E } },
      }),
    ).toMatchObject({ electiveGroup: 'Elective Group 2', status: 'COMPLETED' });
  });

  it('merges additively and counts the account’s existing completions as prerequisites', async () => {
    await prisma.studentRecord.createMany({
      data: [
        { userId, courseId: courses.A, status: 'COMPLETED' },
        { userId, courseId: courses.D, status: 'PLANNED' },
        { userId, courseId: courses.E, status: 'COMPLETED', electiveGroup: 'Existing group' },
      ],
    });
    const response = await importProgress({
      completedIds: { [courses.C]: null, [courses.B]: null },
      plannedIds: [courses.F],
    });
    expect({ status: response.status, body: response.body }).toMatchObject({
      status: 200,
      body: { success: true },
    });
    expect(response.body.data).toEqual({
      completedIds: {
        [courses.A]: null,
        [courses.B]: null,
        [courses.C]: null,
        [courses.E]: 'Existing group',
      },
      plannedIds: [courses.D, courses.F].sort(),
    });
  });

  it('keeps existing completion metadata and claim when the archive contains conflicting values', async () => {
    const existing = await prisma.studentRecord.create({
      data: {
        userId,
        courseId: courses.E,
        status: 'COMPLETED',
        electiveGroup: 'Server group',
        grade: 'A',
        gradePoints: 4,
        semester: 'Fall 2025',
        year: 2025,
      },
    });
    const response = await importProgress({
      completedIds: { [courses.E]: 'Archive group' },
      plannedIds: [courses.D],
    });
    expect(response.status).toBe(200);
    expect(response.body.data.completedIds[courses.E]).toBe('Server group');
    expect(await prisma.studentRecord.findUniqueOrThrow({ where: { id: existing.id } })).toEqual(
      existing,
    );
  });

  it('promotes a planned record to completed without overwriting its grade metadata', async () => {
    const existing = await prisma.studentRecord.create({
      data: {
        userId,
        courseId: courses.E,
        status: 'PLANNED',
        grade: 'B+',
        gradePoints: 3.5,
        semester: 'Spring 2026',
        year: 2026,
      },
    });
    const response = await importProgress({
      completedIds: { [courses.E]: 'Imported group' },
      plannedIds: [],
    });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      completedIds: { [courses.E]: 'Imported group' },
      plannedIds: [],
    });
    expect(
      await prisma.studentRecord.findUniqueOrThrow({ where: { id: existing.id } }),
    ).toMatchObject({
      id: existing.id,
      status: 'COMPLETED',
      electiveGroup: 'Imported group',
      grade: 'B+',
      gradePoints: 3.5,
      semester: 'Spring 2026',
      year: 2026,
    });
  });

  it('creates only new plans and never replaces any existing record with an archived plan', async () => {
    await prisma.studentRecord.createMany({
      data: [
        { userId, courseId: courses.A, status: 'COMPLETED', electiveGroup: 'Keep me' },
        { userId, courseId: courses.B, status: 'PLANNED' },
        { userId, courseId: courses.C, status: 'IN_PROGRESS' },
        { userId, courseId: courses.D, status: 'FAILED', grade: 'F', gradePoints: 0 },
        { userId, courseId: courses.E, status: 'DROPPED' },
      ],
    });
    const before = await records();
    const response = await importProgress({
      completedIds: {},
      plannedIds: Object.values(courses).slice().reverse(),
    });
    expect({ status: response.status, body: response.body }).toMatchObject({
      status: 200,
      body: { success: true },
    });
    expect(response.body.data).toEqual({
      completedIds: { [courses.A]: 'Keep me' },
      plannedIds: [courses.B, courses.F, courses.G].sort(),
    });
    const after = await records();
    for (const existing of before) {
      expect(after.find((record) => record.id === existing.id)).toEqual(existing);
    }
    for (const name of ['F', 'G']) {
      expect(after.find((record) => record.courseId === courses[name])).toMatchObject({
        status: 'PLANNED',
        electiveGroup: null,
      });
    }
  });

  it('rejects unmet recommended/corequisite requirements atomically alongside valid imports', async () => {
    await prisma.studentRecord.create({
      data: { userId: otherUserId, courseId: courses.A, status: 'COMPLETED' },
    });
    const response = await importProgress({
      completedIds: { [courses.E]: null, [courses.B]: null },
      plannedIds: [courses.D],
    });
    expect(response.status).toBe(409);
    expect(await records()).toEqual([]);
  });

  it('does not count planned prerequisites as completed and preserves the pre-import snapshot', async () => {
    await prisma.studentRecord.create({
      data: { userId, courseId: courses.E, status: 'COMPLETED', electiveGroup: 'Keep me' },
    });
    const before = await records();
    const response = await importProgress({
      completedIds: { [courses.B]: null },
      plannedIds: [courses.A, courses.D],
    });
    expect(response.status).toBe(409);
    expect(await records()).toEqual(before);
  });

  it.each(['completed', 'planned'])(
    'rejects an unknown %s course without partial writes',
    async (kind) => {
      const unknownId = randomUUID();
      const response = await importProgress({
        completedIds: {
          [courses.E]: null,
          ...(kind === 'completed' ? { [unknownId]: null } : {}),
        },
        plannedIds: kind === 'planned' ? [courses.D, unknownId] : [courses.D],
      });
      expect(response.status).toBe(404);
      expect(await records()).toEqual([]);
    },
  );

  it('rejects newly completed mutual prerequisites instead of accepting a self-supporting cycle', async () => {
    await prisma.prerequisite.createMany({
      data: [
        { courseId: courses.F, prerequisiteId: courses.G },
        { courseId: courses.G, prerequisiteId: courses.F },
      ],
    });
    const response = await importProgress({
      completedIds: { [courses.F]: null, [courses.G]: null, [courses.E]: null },
      plannedIds: [courses.D],
    });
    expect(response.status).toBe(409);
    expect(await records()).toEqual([]);
  });

  it('is idempotent after a successful import, including row identities and timestamps', async () => {
    const input = {
      completedIds: { [courses.A]: null, [courses.B]: null, [courses.E]: 'Group 2' },
      plannedIds: [courses.D],
    };
    const first = await importProgress(input);
    expect(first.status).toBe(200);
    const before = await records();
    const retry = await importProgress(input);
    expect(retry.status).toBe(200);
    expect(retry.body.data).toEqual(first.body.data);
    expect(await records()).toEqual(before);
  });

  it('keeps prerequisites valid when importing a dependent races with uncompleting its prerequisite', async () => {
    await prisma.studentRecord.create({
      data: { userId, courseId: courses.A, status: 'COMPLETED' },
    });
    const [importResponse, removalResponse] = await Promise.all([
      importProgress({ completedIds: { [courses.B]: null }, plannedIds: [] }),
      request(app)
        .post('/api/users/me/complete')
        .set('Cookie', cookie)
        .send({ courseId: courses.A, status: 'DROPPED' }),
    ]);
    expect([200, 409]).toContain(importResponse.status);
    expect(removalResponse.status).toBe(200);
    const finalRecords = await records();
    expect(finalRecords.find((record) => record.courseId === courses.A)?.status).toBe('DROPPED');
    expect(
      finalRecords.some((record) => record.courseId === courses.B && record.status === 'COMPLETED'),
    ).toBe(false);
    expect((await progress()).body.data).toEqual({ completedIds: {}, plannedIds: [] });
  });

  it('makes concurrent identical plan imports idempotent without duplicate records', async () => {
    const input = { completedIds: {}, plannedIds: [courses.D, courses.E] };
    const responses = await Promise.all([importProgress(input), importProgress(input)]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({
        completedIds: {},
        plannedIds: [courses.D, courses.E].sort(),
      });
    }
    const finalRecords = await records();
    expect(finalRecords).toHaveLength(2);
    expect(finalRecords.every((record) => record.status === 'PLANNED')).toBe(true);
  });

  it('treats an empty archive as a no-op and returns course IDs in stable order', async () => {
    const completeIds = [courses.E, courses.A].sort().reverse();
    const plannedIds = [courses.F, courses.D].sort().reverse();
    await prisma.studentRecord.createMany({
      data: [
        ...completeIds.map((courseId) => ({ userId, courseId, status: 'COMPLETED' as const })),
        ...plannedIds.map((courseId) => ({ userId, courseId, status: 'PLANNED' as const })),
      ],
    });
    const before = await records();
    const response = await importProgress({ completedIds: {}, plannedIds: [] });
    expect(response.status).toBe(200);
    expect(Object.keys(response.body.data.completedIds)).toEqual(completeIds.slice().sort());
    expect(response.body.data.plannedIds).toEqual(plannedIds.slice().sort());
    expect(await records()).toEqual(before);
  });

  it.each([
    { completedIds: { [courses.A]: null }, plannedIds: [], userId: otherUserId },
    { completedIds: { [courses.A]: null }, plannedIds: [], grade: 'A' },
    { completedIds: { [courses.A]: { grade: 'A' } }, plannedIds: [] },
    { completedIds: { [courses.A]: '' }, plannedIds: [] },
    { completedIds: { [courses.A]: '   ' }, plannedIds: [] },
    { completedIds: { 'not-a-course-id': null }, plannedIds: [] },
    { completedIds: {}, plannedIds: ['not-a-course-id'] },
    { completedIds: {}, plannedIds: [courses.D, courses.D] },
    { completedIds: { [courses.A]: null }, plannedIds: [courses.A] },
    { completedIds: {}, plannedIds: Array.from({ length: 501 }, () => randomUUID()) },
    {
      completedIds: Object.fromEntries(Array.from({ length: 501 }, () => [randomUUID(), null])),
      plannedIds: [],
    },
    { completedIds: {} },
    { plannedIds: [] },
  ])('rejects malformed or unsupported import case %# atomically', async (input) => {
    expect((await importProgress(input)).status).toBe(400);
    expect(await records()).toEqual([]);
  });
});
