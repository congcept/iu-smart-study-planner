import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { AdminStudentSummaryDTO } from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { assignReferenceCurriculum, listAdminStudents } from '../services/curriculumAssignment';

describe('reference curriculum assignment (PostgreSQL)', () => {
  const prefix = `ref-assign-${randomUUID()}`;
  const admin = randomUUID();
  const otherAdmin = randomUUID();
  const students = [randomUUID(), randomUUID(), randomUUID()];
  const contexts = [randomUUID(), randomUUID()];
  const studentIds = students.map((_id, index) => `${prefix}-s${index}`);
  const suffix = prefix.slice(-8);
  const cookie = (userId: string) => `${AUTH_COOKIE_NAME}=${issueToken(userId)}`;
  const assign = (userId: string, body: Record<string, unknown>, actor: string = admin) =>
    request(app)
      .post(`/api/admin/users/students/${userId}/curriculum`)
      .set('Cookie', cookie(actor))
      .send(body);
  const list = (query: Record<string, unknown> = {}, actor: string = admin) =>
    request(app).get('/api/admin/users/students').set('Cookie', cookie(actor)).query(query);
  const assignService = (curriculumId: string | null, expectedCurriculumId: string | null) =>
    assignReferenceCurriculum(admin, students[0], { curriculumId, expectedCurriculumId });

  const evidence = async () => ({
    users: await prisma.user.findMany({
      where: { id: { in: students } },
      orderBy: { id: 'asc' },
      select: { id: true, curriculumId: true, updatedAt: true },
    }),
    records: await prisma.studentRecord.findMany({
      where: { userId: { in: students } },
      orderBy: { id: 'asc' },
    }),
    attempts: await prisma.gradeAttempt.findMany({
      where: { userId: { in: students } },
      orderBy: { id: 'asc' },
    }),
    ratings: await prisma.courseRating.findMany({
      where: { userId: { in: students } },
      orderBy: { id: 'asc' },
    }),
    plans: await prisma.studyPlan.findMany({
      where: { userId: { in: students } },
      orderBy: { id: 'asc' },
    }),
  });

  beforeAll(async () => {
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${suffix}-c${index}`,
        name: 'Simulated reference curriculum',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
      })),
    });
    await prisma.user.create({
      data: {
        id: admin,
        studentId: `${prefix}-admin`,
        name: 'Reference assignment admin',
        email: `${prefix}-admin@example.test`,
        role: 'ADMIN',
      },
    });
    await prisma.user.create({
      data: {
        id: otherAdmin,
        studentId: `${prefix}-admin2`,
        name: 'Second reference assignment admin',
        email: `${prefix}-admin2@example.test`,
        role: 'ADMIN',
      },
    });
    await prisma.user.createMany({
      data: students.map((id, index) => ({
        id,
        studentId: studentIds[index],
        name: `Reference assignment student ${index}`,
        email: `${prefix}-${index}@example.test`,
        role: 'STUDENT',
      })),
    });
    const courseId = randomUUID();
    await prisma.course.create({
      data: {
        id: courseId,
        code: `${prefix}-course`,
        name: 'Preserved course',
        credits: 3,
        difficultyLevel: 2,
      },
    });
    await prisma.studentRecord.create({
      data: { userId: students[0], courseId, status: 'COMPLETED', electiveGroup: 'Group 1' },
    });
    await prisma.gradeAttempt.create({
      data: { userId: students[0], courseId, requestId: randomUUID(), score: 84.5 },
    });
    await prisma.courseRating.create({ data: { userId: students[0], courseId, rating: 4 } });
    await prisma.studyPlan.create({
      data: { userId: students[0], name: 'Preserved plan' },
    });
  });

  afterAll(async () => {
    await prisma.studyPlan.deleteMany({ where: { userId: { in: students } } });
    await prisma.courseRating.deleteMany({ where: { userId: { in: students } } });
    await prisma.gradeAttempt.deleteMany({ where: { userId: { in: students } } });
    await prisma.studentRecord.deleteMany({ where: { userId: { in: students } } });
    await prisma.user.deleteMany({ where: { id: { in: [...students, admin, otherAdmin] } } });
    await prisma.course.deleteMany({ where: { code: { startsWith: prefix } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.$disconnect();
  });

  it('requires a current administrator for reads and writes', async () => {
    const before = await evidence();
    expect((await request(app).get('/api/admin/users/students')).status).toBe(401);
    expect(
      (
        await request(app)
          .post(`/api/admin/users/students/${students[0]}/curriculum`)
          .send({ curriculumId: contexts[0], expectedCurriculumId: null })
      ).status,
    ).toBe(401);
    expect(
      (await request(app).get('/api/admin/users/students').set('Cookie', cookie(randomUUID())))
        .status,
    ).toBe(401);
    expect((await list({}, students[1])).status).toBe(403);
    expect(
      (
        await assign(
          students[0],
          { curriculumId: contexts[0], expectedCurriculumId: null },
          students[1],
        )
      ).status,
    ).toBe(403);
    expect(await evidence()).toEqual(before);
  });

  it('rejects a stripped-body attempt to set the role or another identity', async () => {
    const before = await evidence();
    const response = await assign(students[0], {
      curriculumId: contexts[0],
      expectedCurriculumId: null,
      role: 'ADMIN',
      userId: admin,
    });
    expect(response.status).toBe(400);
    expect(await evidence()).toEqual(before);
  });

  it('assigns, reports the reference usage, and appears in the student session', async () => {
    const response = await assign(students[0], {
      curriculumId: contexts[0],
      expectedCurriculumId: null,
    });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      userId: students[0],
      curriculumId: contexts[0],
      usage: 'REFERENCE_ONLY',
      changed: true,
    });

    const session = await request(app).get('/api/auth/me').set('Cookie', cookie(students[0]));
    expect(session.status).toBe(200);
    expect(session.body.data.user.curriculumId).toBe(contexts[0]);
  });

  it('is idempotent but refuses a stale precondition', async () => {
    const repeat = await assign(students[0], {
      curriculumId: contexts[0],
      expectedCurriculumId: contexts[0],
    });
    expect(repeat.status).toBe(200);
    expect(repeat.body.data.changed).toBe(false);

    const recovered = await assign(students[0], {
      curriculumId: contexts[0],
      expectedCurriculumId: null,
    });
    expect(recovered.status).toBe(200);
    expect(recovered.body.data.changed).toBe(false);

    const stale = await assign(students[0], {
      curriculumId: contexts[1],
      expectedCurriculumId: null,
    });
    expect(stale.status).toBe(409);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: students[0] } })).curriculumId).toBe(
      contexts[0],
    );
  });

  it('clears an assignment and round-trips back', async () => {
    const cleared = await assign(students[0], {
      curriculumId: null,
      expectedCurriculumId: contexts[0],
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toEqual({
      userId: students[0],
      curriculumId: null,
      usage: 'REFERENCE_ONLY',
      changed: true,
    });

    const restored = await assign(students[0], {
      curriculumId: contexts[0],
      expectedCurriculumId: null,
    });
    expect(restored.status).toBe(200);
    expect(restored.body.data.curriculumId).toBe(contexts[0]);
  });

  it('rejects unknown accounts, unknown curricula and administrator targets', async () => {
    expect(
      (await assign(randomUUID(), { curriculumId: contexts[0], expectedCurriculumId: null }))
        .status,
    ).toBe(404);
    expect(
      (await assign(students[1], { curriculumId: randomUUID(), expectedCurriculumId: null }))
        .status,
    ).toBe(404);
    const adminTarget = await assign(admin, {
      curriculumId: contexts[0],
      expectedCurriculumId: null,
    });
    expect(adminTarget.status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin } })).curriculumId).toBeNull();
  });

  it('preserves every other academic row of the assigned account', async () => {
    const before = await evidence();
    const response = await assign(students[0], {
      curriculumId: contexts[1],
      expectedCurriculumId: contexts[0],
    });
    expect(response.status).toBe(200);
    const after = await evidence();
    expect(after.records).toEqual(before.records);
    expect(after.attempts).toEqual(before.attempts);
    expect(after.ratings).toEqual(before.ratings);
    expect(after.plans).toEqual(before.plans);
    expect(after.users.map(({ curriculumId }) => curriculumId)).toEqual(
      before.users.map(({ id, curriculumId }) => (id === students[0] ? contexts[1] : curriculumId)),
    );
  });

  it('lists only student accounts with their reference curriculum', async () => {
    const response = await list();
    expect(response.status).toBe(200);
    expect(response.body.data.usage).toBe('REFERENCE_ONLY');
    expect(response.body.data.pageSize).toBe(50);
    expect(response.body.data.after).toBeNull();
    const listed = response.body.data.students as AdminStudentSummaryDTO[];
    const ids = listed.map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining([students[0], students[1], students[2]]));
    expect(ids).not.toContain(admin);
    expect(ids).not.toContain(otherAdmin);
    const assigned = listed.find(({ id }) => id === students[0])!;
    expect(assigned.curriculumId).toBe(contexts[1]);
    expect(assigned.curriculum).toEqual({
      id: contexts[1],
      code: `${suffix}-c1`,
      name: 'Simulated reference curriculum',
    });
    const unassigned = listed.find(({ id }) => id === students[1])!;
    expect(unassigned.curriculumId).toBeNull();
    expect(unassigned.curriculum).toBeNull();
  });

  it('continues after a known student and conflicts on an unknown continuation', async () => {
    const first = await list();
    const listed = first.body.data.students as AdminStudentSummaryDTO[];
    const cursor = listed.find(({ id }) => id === students[0])!.studentId;
    const continued = await list({ after: cursor });
    expect(continued.status).toBe(200);
    expect(continued.body.data.after).toBe(cursor);
    expect((continued.body.data.students as { id: string }[]).map(({ id }) => id)).not.toContain(
      students[0],
    );

    expect((await list({ after: `${prefix}-missing` })).status).toBe(409);
    expect((await list({ after: `${prefix}-admin` })).status).toBe(409);
    expect((await list({ after: '' })).status).toBe(200);
    expect((await list({ after: 'not a student id' })).status).toBe(409);
    expect((await list({ after: 'x'.repeat(65) })).status).toBe(400);
  });

  it('resolves concurrent assignments to one winner', async () => {
    const expected = await prisma.user.findUniqueOrThrow({ where: { id: students[2] } });
    expect(expected.curriculumId).toBeNull();
    const results = await Promise.all([
      assign(students[2], { curriculumId: contexts[0], expectedCurriculumId: null }),
      assign(students[2], { curriculumId: contexts[1], expectedCurriculumId: null }),
    ]);
    const statuses = results.map(({ status }) => status).sort();
    expect(statuses).toEqual([200, 409]);
    const winner = results.find(({ status }) => status === 200)!;
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: students[2] } });
    expect(stored.curriculumId).toBe(winner.body.data.curriculumId);
  });

  it('rejects an administrator demoted while the assignment is deciding', async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired!: () => void;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${otherAdmin} FOR UPDATE`;
        acquired();
        await released;
        await tx.user.update({ where: { id: otherAdmin }, data: { role: 'STUDENT' } });
      },
      { timeout: 15000 },
    );

    await locked;
    const pending = assign(
      students[1],
      { curriculumId: contexts[0], expectedCurriculumId: null },
      otherAdmin,
    );
    release();
    const response = await pending;
    await blocker;
    expect(response.status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: students[1] } })).curriculumId).toBe(
      null,
    );
    await prisma.user.update({ where: { id: otherAdmin }, data: { role: 'ADMIN' } });
  });

  it('keeps service callers on the same contract', async () => {
    await expect(assignService(contexts[1], contexts[1])).resolves.toEqual({
      userId: students[0],
      curriculumId: contexts[1],
      usage: 'REFERENCE_ONLY',
      changed: false,
    });
    await expect(listAdminStudents(admin, { after: `${prefix}-missing` })).rejects.toMatchObject({
      status: 409,
    });
  });
});
