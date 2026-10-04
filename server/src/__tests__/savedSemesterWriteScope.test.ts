import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import type { AccountWriteScopeDTO, CreateSemesterDTO } from '@iu-study-planner/shared';
import { prisma } from '../db';
import router from '../routes/studyPlans';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { createPlannedSemester, updatePlannedSemester } from '../services/plannedSemesters';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/study-plans', router);

describe('saved-semester owner/context write preconditions (PostgreSQL)', () => {
  const prefix = `semester-scope-${randomUUID()}`;
  const users = [randomUUID(), randomUUID(), randomUUID()];
  const contexts = [randomUUID(), randomUUID()];
  const courses = [randomUUID(), randomUUID()];
  let planId: string;
  let semesterId: string;
  let foreignPlanId: string;
  let foreignSemesterId: string;
  const scope = (
    curriculumId: string | null = contexts[0],
    userId = users[0],
  ): AccountWriteScopeDTO => ({ userId, curriculumId });
  const entries = (courseId = courses[0]) => [{ courseId, position: 7 }];
  const body = (expectedScope?: AccountWriteScopeDTO): CreateSemesterDTO => ({
    semester: 'SPRING',
    year: 2027,
    courses: entries(),
    ...(expectedScope === undefined ? {} : { expectedScope }),
  });
  const create = (data: unknown, userId = users[0], targetPlan = planId) =>
    request(app)
      .post(`/api/study-plans/${targetPlan}/semesters`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(userId)}`)
      .send(data as Record<string, unknown>);
  const update = (
    data: unknown,
    userId = users[0],
    targetPlan = planId,
    targetSemester = semesterId,
  ) =>
    request(app)
      .put(`/api/study-plans/${targetPlan}/semesters/${targetSemester}`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(userId)}`)
      .send(data as Record<string, unknown>);
  const assign = (curriculumId: string | null) =>
    prisma.user.update({ where: { id: users[0] }, data: { curriculumId } });
  const evidence = async () => ({
    semesters: await prisma.plannedSemester.findMany({
      where: { studyPlan: { userId: { in: users } } },
      orderBy: { id: 'asc' },
    }),
    plans: await prisma.studyPlan.findMany({
      where: { userId: { in: users } },
      orderBy: { id: 'asc' },
    }),
    users: await prisma.user.findMany({ where: { id: { in: users } }, orderBy: { id: 'asc' } }),
    courses: await prisma.course.findMany({
      where: { id: { in: courses } },
      orderBy: { id: 'asc' },
    }),
    records: await prisma.studentRecord.findMany({
      where: { userId: { in: users } },
      orderBy: { id: 'asc' },
    }),
    attempts: await prisma.gradeAttempt.findMany({
      where: { userId: { in: users } },
      orderBy: { id: 'asc' },
    }),
  });
  beforeAll(async () => {
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated saved-semester course',
        credits: index === 0 ? 3 : 4,
        difficultyLevel: index === 0 ? 1 : 5,
      })),
    });
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated semester context',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
      })),
    });
    for (const [contextId, courseId] of [
      [contexts[0], courses[0]],
      [contexts[1], courses[0]],
      [contexts[0], courses[1]],
    ]) {
      await prisma.curriculumCourse.create({
        data: {
          curriculumId: contextId,
          courseId,
          placements: { create: { sourceOrder: 0, academicYear: 1, academicSemester: 1 } },
        },
      });
    }
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        email: `${id}@example.test`,
        name: 'Simulated semester owner',
        role: index === 2 ? 'ADMIN' : 'STUDENT',
        curriculumId: index === 0 ? contexts[0] : contexts[1],
      })),
    });
    await prisma.studentRecord.create({
      data: {
        userId: users[0],
        courseId: courses[1],
        status: 'COMPLETED',
        grade: 'B+',
        gradePoints: 3.5,
        electiveGroup: 'Preserved claim',
      },
    });
    await prisma.gradeAttempt.create({
      data: { userId: users[0], courseId: courses[1], requestId: randomUUID(), score: 81 },
    });
  });
  beforeEach(async () => {
    await assign(contexts[0]);
    await prisma.studyPlan.deleteMany({ where: { userId: { in: users } } });
    const plan = await prisma.studyPlan.create({
      data: {
        userId: users[0],
        name: 'Simulated owned plan',
        description: 'Preserve metadata',
        semesters: {
          create: {
            semester: 'FALL',
            year: 2026,
            courses: entries(courses[1]),
            totalCredits: 4,
            difficultyScore: 5,
          },
        },
      },
      include: { semesters: true },
    });
    planId = plan.id;
    semesterId = plan.semesters[0].id;
    const foreign = await prisma.studyPlan.create({
      data: {
        userId: users[1],
        name: 'Simulated foreign plan',
        semesters: {
          create: {
            semester: 'FALL',
            year: 2026,
            courses: [],
            totalCredits: 0,
            difficultyScore: 0,
          },
        },
      },
      include: { semesters: true },
    });
    foreignPlanId = foreign.id;
    foreignSemesterId = foreign.semesters[0].id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
    await prisma.$disconnect();
  });

  it.each([
    ['null to assigned', null, contexts[0]],
    ['A to B', contexts[0], contexts[1]],
    ['A to null', contexts[0], null],
  ] as const)(
    'rejects stale create and course-list update after %s even for a shared placed course',
    async (_label, previous, current) => {
      await assign(current);
      const before = await evidence();
      expect((await create(body(scope(previous)))).status).toBe(409);
      expect((await update({ courses: entries(), expectedScope: scope(previous) })).status).toBe(
        409,
      );
      expect(await evidence()).toEqual(before);
    },
  );

  it('guards explicitly empty lists and metadata-only edits before any cache or timestamp rewrite', async () => {
    await assign(contexts[1]);
    const before = await evidence();
    expect((await create({ ...body(scope()), courses: [] })).status).toBe(409);
    expect((await update({ courses: [], expectedScope: scope() })).status).toBe(409);
    expect((await update({ year: 2030, expectedScope: scope() })).status).toBe(409);
    expect(await evidence()).toEqual(before);
  });

  it('accepts uppercase matched owner/context while stripping scope from persisted rows and course JSON', async () => {
    const uppercase = { userId: users[0].toUpperCase(), curriculumId: contexts[0].toUpperCase() };
    const created = await create(body(uppercase));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ courses: entries(), totalCredits: 3 });
    expect(created.body.data).not.toHaveProperty('expectedScope');
    const updated = await update({ courses: entries(), expectedScope: uppercase });
    expect(updated.status).toBe(200);
    expect(updated.body.data).not.toHaveProperty('expectedScope');
    const persisted = await prisma.plannedSemester.findUniqueOrThrow({
      where: { id: created.body.data.id },
    });
    expect(persisted.courses).toEqual(entries());
    expect(JSON.stringify(persisted)).not.toContain('expectedScope');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: users[0] } })).curriculumId).toBe(
      contexts[0],
    );
  });

  it('accepts explicit null for an unassigned plan and preserves global legacy compatibility', async () => {
    await assign(null);
    expect((await create(body(scope(null)))).status).toBe(201);
    expect((await update({ courses: entries(), expectedScope: scope(null) })).status).toBe(200);
    expect((await update({ year: 2030 })).status).toBe(200);
    const legacy = await create({ ...body(), semester: 'SUMMER' });
    expect(legacy.status).toBe(201);
    expect(legacy.body.data).not.toHaveProperty('expectedScope');
  });

  it('uses plan owner scope for admin writes and rejects actor scope without assigning or impersonating', async () => {
    const before = await evidence();
    expect((await create(body(scope(contexts[1], users[2])), users[2])).status).toBe(409);
    expect(
      (await update({ year: 2030, expectedScope: scope(contexts[1], users[2]) }, users[2])).status,
    ).toBe(409);
    expect((await create(body(scope(contexts[1])), users[2])).status).toBe(409);
    expect(await evidence()).toEqual(before);
    expect((await create(body(scope()), users[2])).status).toBe(201);
    expect((await update({ courses: entries(), expectedScope: scope() }, users[2])).status).toBe(
      200,
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: users[2] } })).curriculumId).toBe(
      contexts[1],
    );
  });

  it('retains auth, foreign plan and nested-resource precedence over a valid stale scope', async () => {
    const before = await evidence();
    expect(
      (
        await request(app)
          .post(`/api/study-plans/${planId}/semesters`)
          .send(body(scope(null)))
      ).status,
    ).toBe(401);
    expect((await create(body(scope(null)), users[1])).status).toBe(403);
    expect((await update({ year: 2030, expectedScope: scope(null) }, users[1])).status).toBe(403);
    expect((await create(body(scope(null)), users[0], randomUUID())).status).toBe(404);
    expect(
      (
        await update(
          { year: 2030, expectedScope: scope(null) },
          users[2],
          planId,
          foreignSemesterId,
        )
      ).status,
    ).toBe(404);
    expect(
      (await update({ year: 2030, expectedScope: scope(null) }, users[0], planId, randomUUID()))
        .status,
    ).toBe(404);
    expect(
      (
        await update(
          { year: 2030, expectedScope: scope(null) },
          users[0],
          foreignPlanId,
          foreignSemesterId,
        )
      ).status,
    ).toBe(403);
    expect(await evidence()).toEqual(before);
  });

  it.each([
    null,
    {},
    { userId: users[0] },
    { curriculumId: null },
    { userId: 'invalid', curriculumId: null },
    { userId: users[0], curriculumId: 'invalid' },
    { userId: users[0], curriculumId: 42 },
    { userId: users[0], curriculumId: contexts[0], role: 'ADMIN' },
  ])(
    'rejects malformed nested scope %j on create and update without writes',
    async (expectedScope) => {
      const before = await evidence();
      expect((await create({ ...body(), expectedScope })).status).toBe(400);
      expect((await update({ year: 2030, expectedScope })).status).toBe(400);
      expect(await evidence()).toEqual(before);
    },
  );

  it('rejects scope-only updates rather than performing an empty write', async () => {
    const before = await evidence();
    expect((await update({ expectedScope: scope() })).status).toBe(400);
    await expect(
      updatePlannedSemester(planId, semesterId, users[0], { expectedScope: scope() }),
    ).rejects.toBeInstanceOf(z.ZodError);
    await expect(
      updatePlannedSemester(planId, semesterId, users[0], {
        expectedScope: scope(),
        year: undefined,
        courses: undefined,
        semester: undefined,
      }),
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(await evidence()).toEqual(before);
  });

  it('checks direct-service owner scope before totals and metadata writes', async () => {
    await assign(contexts[1]);
    const before = await evidence();
    await expect(createPlannedSemester(planId, users[0], body(scope()))).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      updatePlannedSemester(planId, semesterId, users[0], {
        courses: entries(),
        expectedScope: scope(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      updatePlannedSemester(planId, semesterId, users[0], { year: 2030, expectedScope: scope() }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await evidence()).toEqual(before);
  });

  it('validates malformed scope in direct-service calls without spreading it to Prisma', async () => {
    const before = await evidence();
    const invalid = {
      userId: users[0],
      curriculumId: contexts[0],
      role: 'ADMIN',
    } as unknown as AccountWriteScopeDTO;
    await expect(createPlannedSemester(planId, users[0], body(invalid))).rejects.toBeInstanceOf(
      z.ZodError,
    );
    await expect(
      updatePlannedSemester(planId, semesterId, users[0], { year: 2030, expectedScope: invalid }),
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(await evidence()).toEqual(before);
  });

  it('keeps direct-service access/resource checks authoritative for stale scopes', async () => {
    const before = await evidence();
    await expect(
      createPlannedSemester(planId, randomUUID(), body(scope(null))),
    ).rejects.toMatchObject({ status: 401 });
    await expect(createPlannedSemester(planId, users[1], body(scope(null)))).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      createPlannedSemester(randomUUID(), users[2], body(scope(null))),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      updatePlannedSemester(planId, foreignSemesterId, users[2], {
        year: 2030,
        expectedScope: scope(null),
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await evidence()).toEqual(before);
  });

  it('retains historical cached courses and totals for matching metadata-only edits after assignment changes', async () => {
    await assign(contexts[1]);
    const previous = await prisma.plannedSemester.findUniqueOrThrow({ where: { id: semesterId } });
    const response = await update({ year: 2030, expectedScope: scope(contexts[1]) });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      year: 2030,
      courses: previous.courses,
      totalCredits: previous.totalCredits,
      difficultyScore: previous.difficultyScore,
    });
    expect(response.body.data).not.toHaveProperty('expectedScope');
    const before = await evidence();
    expect(
      (await update({ courses: entries(courses[1]), expectedScope: scope(contexts[1]) })).status,
    ).toBe(409);
    expect(await evidence()).toEqual(before);
  });
});
