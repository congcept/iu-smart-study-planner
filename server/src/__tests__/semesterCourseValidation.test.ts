import { randomUUID } from 'crypto';
import request from 'supertest';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';

describe('semester course validation (PostgreSQL)', () => {
  const prefix = `semester-validation-${randomUUID()}`;
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const adminId = randomUUID();
  const courseA = randomUUID();
  const courseB = randomUUID();
  let planId: string;
  let semesterId: string;
  const cookie = (id: string) => `${AUTH_COOKIE_NAME}=${issueToken(id)}`;
  const entries = [
    { courseId: courseB, position: 7 },
    { courseId: courseA, position: 2 },
  ];
  const create = (body: Record<string, unknown>, userId = ownerId) =>
    request(app)
      .post(`/api/study-plans/${planId}/semesters`)
      .set('Cookie', cookie(userId))
      .send(body);
  const update = (body: Record<string, unknown>, userId = ownerId, id = semesterId) =>
    request(app)
      .put(`/api/study-plans/${planId}/semesters/${id}`)
      .set('Cookie', cookie(userId))
      .send(body);
  const saved = () =>
    prisma.plannedSemester.findMany({ where: { studyPlanId: planId }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [ownerId, otherId, adminId].map((id) => ({
        id,
        studentId: `${prefix}-${id}`,
        name: 'Semester validation test',
        email: `${prefix}-${id}@example.test`,
        role: id === adminId ? 'ADMIN' : 'STUDENT',
      })),
    });
    await prisma.course.createMany({
      data: [
        { id: courseA, code: `${prefix}-A`, name: 'Course A', credits: 3, difficultyLevel: 2 },
        { id: courseB, code: `${prefix}-B`, name: 'Course B', credits: 4, difficultyLevel: 4 },
      ],
    });
  });

  beforeEach(async () => {
    await prisma.studyPlan.deleteMany({ where: { userId: { in: [ownerId, otherId, adminId] } } });
    const plan = await prisma.studyPlan.create({
      data: {
        userId: ownerId,
        name: 'Validation plan',
        description: 'Keep plan metadata',
        semesters: {
          create: {
            semester: 'FALL',
            year: 2026,
            courses: [{ courseId: courseA, position: 5 }],
            totalCredits: 3,
            difficultyScore: 2,
          },
        },
      },
      include: { semesters: true },
    });
    planId = plan.id;
    semesterId = plan.semesters[0].id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { studentId: { startsWith: prefix } } });
    await prisma.course.deleteMany({ where: { code: { startsWith: prefix } } });
    await prisma.$disconnect();
  });

  it('creates valid lists with accurate totals and submitted order/positions', async () => {
    const response = await create({ semester: 'SPRING', year: 2027, courses: entries });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      courses: entries,
      totalCredits: 7,
      difficultyScore: 3,
    });
    expect(
      (await saved()).find((semester) => semester.id === response.body.data.id)?.courses,
    ).toEqual(entries);
  });

  it('updates valid lists while keeping semester metadata and recalculating totals', async () => {
    const response = await update({ courses: entries });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      courses: entries,
      totalCredits: 7,
      difficultyScore: 3,
      semester: 'FALL',
      year: 2026,
    });
  });

  it.each(['create', 'update'])('rejects unknown IDs atomically on %s', async (operation) => {
    const before = await saved();
    const courses = [entries[0], { courseId: randomUUID(), position: 1 }];
    const response =
      operation === 'create'
        ? await create({ semester: 'SPRING', year: 2027, courses })
        : await update({ semester: 'SPRING', year: 2027, courses });
    expect(response.status).toBe(400);
    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['courses', 1, 'courseId'], message: 'Course not found' }),
      ]),
    );
    expect(await saved()).toEqual(before);
  });

  it.each(['create', 'update'])(
    'rejects duplicate IDs including uppercase UUIDs atomically on %s',
    async (operation) => {
      const before = await saved();
      const courses = [
        { courseId: courseA, position: 0 },
        { courseId: courseA.toUpperCase(), position: 1 },
      ];
      const response =
        operation === 'create'
          ? await create({ semester: 'SPRING', year: 2027, courses })
          : await update({ courses });
      expect(response.status).toBe(400);
      expect(await saved()).toEqual(before);
    },
  );

  it('accepts and canonicalizes a valid uppercase UUID', async () => {
    expect(
      (await update({ courses: [{ courseId: courseB.toUpperCase(), position: 9 }] })).status,
    ).toBe(200);
    expect((await saved())[0]).toMatchObject({
      courses: [{ courseId: courseB, position: 9 }],
      totalCredits: 4,
      difficultyScore: 4,
    });
  });

  it('preserves explicitly empty semesters on create and update', async () => {
    const created = await create({ semester: 'SUMMER', year: 2027, courses: [] });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ courses: [], totalCredits: 0, difficultyScore: 0 });
    const updated = await update({ courses: [] });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ courses: [], totalCredits: 0, difficultyScore: 0 });
  });

  it('changes metadata without changing courses or calculated totals', async () => {
    const response = await update({ year: 2028, semester: 'SPRING' });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      year: 2028,
      semester: 'SPRING',
      courses: [{ courseId: courseA, position: 5 }],
      totalCredits: 3,
      difficultyScore: 2,
    });
  });

  const malformed = [
    { courses: [{ courseId: 'invalid', position: 0 }] },
    { courses: [{ courseId: courseA, position: 0.5 }] },
    { courses: [{ courseId: courseA }] },
    { courses: [{ courseId: courseA, position: 0, grade: 'A' }] },
    { courses: null },
    { courses: {} },
    { year: 2026.5 },
    { semester: 'WINTER' },
    { totalCredits: 999 },
    { studyPlanId: randomUUID() },
  ];
  it.each(malformed)(
    'rejects malformed/unsupported create and update fields %# without mutation',
    async (invalid) => {
      const before = await saved();
      expect(
        (await create({ semester: 'SPRING', year: 2027, courses: entries, ...invalid })).status,
      ).toBe(400);
      expect((await update(invalid)).status).toBe(400);
      expect(await saved()).toEqual(before);
    },
  );

  it('rejects empty updates and incomplete create bodies', async () => {
    const before = await saved();
    expect((await update({})).status).toBe(400);
    expect((await create({ semester: 'SPRING', year: 2027 })).status).toBe(400);
    expect(await saved()).toEqual(before);
  });

  it('retains authentication, ownership and admin permissions for writes', async () => {
    const before = await saved();
    expect(
      (
        await request(app)
          .post(`/api/study-plans/${planId}/semesters`)
          .send({ semester: 'SPRING', year: 2027, courses: entries })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .put(`/api/study-plans/${planId}/semesters/${semesterId}`)
          .send({ courses: entries })
      ).status,
    ).toBe(401);
    expect(
      (await create({ semester: 'SPRING', year: 2027, courses: entries }, otherId)).status,
    ).toBe(403);
    expect((await update({ courses: entries }, otherId)).status).toBe(403);
    expect(await saved()).toEqual(before);
    expect(
      (await create({ semester: 'SPRING', year: 2027, courses: entries }, adminId)).status,
    ).toBe(201);
    expect((await update({ courses: entries }, adminId)).status).toBe(200);
  });

  it('cannot mutate a semester nested under a different plan, even as admin', async () => {
    const other = await prisma.studyPlan.create({
      data: {
        userId: otherId,
        name: 'Other plan',
        semesters: { create: { semester: 'FALL', year: 2026, courses: [] } },
      },
      include: { semesters: true },
    });
    const before = await prisma.plannedSemester.findUnique({
      where: { id: other.semesters[0].id },
    });
    expect((await update({ courses: entries }, adminId, other.semesters[0].id)).status).toBe(404);
    expect(
      await prisma.plannedSemester.findUnique({ where: { id: other.semesters[0].id } }),
    ).toEqual(before);
  });
});
