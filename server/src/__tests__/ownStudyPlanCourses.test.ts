import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import {
  OwnStudyPlanCoursesSchema,
  OwnStudyPlanCourseReferencesSchema,
} from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { readOwnStudyPlanCourses } from '../services/ownStudyPlanCourses';

describe('cookie-owned saved course references (PostgreSQL)', () => {
  const prefix = `saved-courses-${randomUUID()}`;
  const owner = randomUUID();
  const admin = randomUUID();
  const course = randomUUID();
  const missing = randomUUID();
  const curriculum = randomUUID();
  let plan: string;
  let otherPlan: string;
  let semester: string;
  let afterOwnerRead: (() => Promise<void>) | undefined;
  let tracing = false;
  const selects: unknown[] = [];
  const catalogReads: { where: unknown; select: unknown }[] = [];
  const cookie = (id = owner) => `${AUTH_COOKIE_NAME}=${issueToken(id)}`;
  const get = (id = owner, selectedPlan = plan, selectedSemester = semester) =>
    request(app)
      .get(`/api/users/me/study-plans/${selectedPlan}/semesters/${selectedSemester}/courses`)
      .set('Cookie', cookie(id));
  const save = (courses: Prisma.InputJsonValue) =>
    prisma.plannedSemester.update({ where: { id: semester }, data: { courses } });
  const read = async () => {
    const response = await get();
    expect(response.status).toBe(200);
    return OwnStudyPlanCoursesSchema.parse(response.body.data);
  };
  beforeAll(async () => {
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (tracing && params.model === 'PlannedSemester' && params.action === 'findFirst')
        selects.push(params.args?.select);
      if (tracing && params.model === 'Course' && params.action === 'findMany')
        catalogReads.push({ where: params.args?.where, select: params.args?.select });
      if (
        afterOwnerRead &&
        params.runInTransaction &&
        params.model === 'User' &&
        params.action === 'findUnique' &&
        params.args?.where?.id === owner
      ) {
        const hook = afterOwnerRead;
        afterOwnerRead = undefined;
        await hook();
      }
      return result;
    });
    await prisma.curriculum.create({
      data: {
        id: curriculum,
        code: prefix,
        name: 'Current context',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
      },
    });
    await prisma.user.createMany({
      data: [owner, admin].map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        email: `${id}@example.test`,
        name: 'Private account',
        role: index ? 'ADMIN' : 'STUDENT',
      })),
    });
    await prisma.course.create({
      data: { id: course, code: prefix, name: 'Original label', credits: 9, difficultyLevel: 5 },
    });
  });
  beforeEach(async () => {
    tracing = false;
    selects.length = 0;
    catalogReads.length = 0;
    afterOwnerRead = undefined;
    await prisma.studyPlan.deleteMany({ where: { userId: { in: [owner, admin] } } });
    await prisma.user.update({ where: { id: owner }, data: { curriculumId: null } });
    await prisma.course.update({ where: { id: course }, data: { name: 'Original label' } });
    const row = await prisma.studyPlan.create({
      data: {
        userId: owner,
        name: 'Saved reference',
        semesters: {
          create: {
            semester: 'FALL',
            year: 2026,
            courses: [{ courseId: course, position: 0 }],
            totalCredits: -17,
            difficultyScore: 88,
          },
        },
      },
      include: { semesters: true },
    });
    plan = row.id;
    semester = row.semesters[0].id;
    otherPlan = (
      await prisma.studyPlan.create({ data: { userId: admin, name: 'Private foreign plan' } })
    ).id;
  });
  afterAll(async () => {
    afterOwnerRead = undefined;
    await prisma.user.deleteMany({ where: { id: { in: [owner, admin] } } });
    await prisma.course.delete({ where: { id: course } });
    await prisma.curriculum.delete({ where: { id: curriculum } });
    await prisma.$disconnect();
  });
  it('requires a live cookie account including direct service calls', async () => {
    expect(
      (await request(app).get(`/api/users/me/study-plans/${plan}/semesters/${semester}/courses`))
        .status,
    ).toBe(401);
    expect((await get(randomUUID())).status).toBe(401);
    await expect(readOwnStudyPlanCourses(randomUUID(), plan, semester)).rejects.toMatchObject({
      status: 401,
    });
  });
  it('uses uniform 404s for foreign/missing plans and mismatched/missing semesters even for admins', async () => {
    const responses = await Promise.all([
      get(owner, randomUUID()),
      get(owner, otherPlan),
      get(admin),
      get(owner, plan, randomUUID()),
      get(owner, otherPlan, semester),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual(responses[0].body);
    }
  });
  it('normalizes IDs, preserves signed duplicate positions and stored array order with missing current catalog labels', async () => {
    await save([
      { courseId: missing.toUpperCase(), position: -8 },
      { courseId: course.toUpperCase(), position: -8 },
    ]);
    const response = await get(owner, plan.toUpperCase(), semester.toUpperCase());
    expect(response.status).toBe(200);
    expect(response.body.data.courseReferences).toEqual({
      status: 'RECOGNIZED',
      order: 'STORED_ARRAY_ORDER',
      entries: [
        { courseId: missing, storedPosition: -8, catalog: null },
        { courseId: course, storedPosition: -8, catalog: { code: prefix, name: 'Original label' } },
      ],
    });
  });
  it('recognizes an empty saved array', async () => {
    await save([]);
    expect((await read()).courseReferences).toEqual({
      status: 'RECOGNIZED',
      order: 'STORED_ARRAY_ORDER',
      entries: [],
    });
  });
  it.each([
    '1.00000000000000000001',
    '9007199254740990.5',
    '-9007199254740990.5',
    '9007199254740991.00000000000000000001',
    '-9007199254740991.00000000000000000001',
    '9007199254740992',
    '-9007199254740992',
  ])('withholds exact JSONB position %s before JavaScript can round it', async (position) => {
    const exactJson = `[{"courseId":"${course}","position":${position}}]`;
    await prisma.$executeRaw`UPDATE planned_semesters SET courses = ${exactJson}::jsonb WHERE id = ${semester}`;
    tracing = true;
    expect((await read()).courseReferences).toEqual({
      status: 'UNAVAILABLE',
      reason: 'UNSUPPORTED_FORMAT',
    });
    expect(catalogReads).toHaveLength(0);
    tracing = false;
  });
  it.each(['1.0', '9007199254740991.0', '-9007199254740991.0'])(
    'recognizes mathematically integral JSONB position %s within the safe range',
    async (position) => {
      const exactJson = `[{"courseId":"${course}","position":${position}}]`;
      await prisma.$executeRaw`UPDATE planned_semesters SET courses = ${exactJson}::jsonb WHERE id = ${semester}`;
      expect((await read()).courseReferences).toMatchObject({
        status: 'RECOGNIZED',
        entries: [{ courseId: course, storedPosition: Number(position) }],
      });
    },
  );
  it.each(
    (
      [
        { privateHistory: ['secret'] },
        'secret',
        [{ courseId: 'bad', position: 0 }],
        [{ courseId: course, position: 0, privateGrade: 90 }],
        [{ courseId: course, position: 0.5 }],
        [{ courseId: course, position: Number.MAX_SAFE_INTEGER + 1 }],
        [
          { courseId: course, position: 0 },
          { courseId: course.toUpperCase(), position: 9 },
        ],
      ] satisfies Prisma.InputJsonValue[]
    ).map((value) => ({ value })),
  )('withholds unsupported content completely: %j', async ({ value }) => {
    await save(value);
    tracing = true;
    expect((await read()).courseReferences).toEqual({
      status: 'UNAVAILABLE',
      reason: 'UNSUPPORTED_FORMAT',
    });
    expect(catalogReads).toHaveLength(0);
    tracing = false;
  });
  it.each(
    (
      [
        Array.from({ length: 101 }, (_, position) => ({ courseId: randomUUID(), position })),
        [{ courseId: course, position: 0, private: '界'.repeat(23000) }],
      ] satisfies Prisma.InputJsonValue[]
    ).map((value) => ({ value })),
  )('withholds arrays exceeding transfer limits before catalog lookup', async ({ value }) => {
    await save(value);
    tracing = true;
    expect((await read()).courseReferences).toEqual({
      status: 'UNAVAILABLE',
      reason: 'READER_LIMIT',
    });
    expect(catalogReads).toHaveLength(0);
    tracing = false;
  });
  it('does not select arbitrary JSON through Prisma and looks up only bounded id/code/name references', async () => {
    tracing = true;
    const received = await read();
    tracing = false;
    expect(selects).toEqual([
      {
        id: true,
        semester: true,
        year: true,
        totalCredits: true,
        createdAt: true,
        updatedAt: true,
      },
    ]);
    expect(catalogReads).toEqual([
      { where: { id: { in: [course] } }, select: { id: true, code: true, name: true } },
    ]);
    expect(received.semester.storedTotalCredits).toBe(-17);
    for (const field of [
      'difficultyScore',
      'privateGrade',
      'email',
      'Private account',
      'ratingCount',
      'credits',
      'progress',
    ])
      expect(JSON.stringify(received)).not.toContain(field);
  });
  it('rejects alternate scope, unsupported query/body and malformed identifiers', async () => {
    expect((await get().query({ userId: admin })).status).toBe(400);
    expect((await get().query({ after: semester })).status).toBe(400);
    expect((await get().send({ courses: [] })).status).toBe(400);
    expect((await get(owner, 'bad')).status).toBe(400);
    expect((await get(owner, plan, 'bad')).status).toBe(400);
  });
  it('keeps scope, plan, saved JSON and catalog in one snapshot during concurrent changes', async () => {
    afterOwnerRead = async () => {
      await prisma.$transaction([
        prisma.user.update({ where: { id: owner }, data: { curriculumId: curriculum } }),
        prisma.studyPlan.update({ where: { id: plan }, data: { name: 'Changed plan' } }),
        prisma.plannedSemester.update({
          where: { id: semester },
          data: { courses: [{ courseId: missing, position: 5 }], year: 2030 },
        }),
        prisma.course.update({ where: { id: course }, data: { name: 'Changed label' } }),
      ]);
    };
    const previous = await read();
    expect(previous.scope.curriculumId).toBeNull();
    expect(previous.plan.name).toBe('Saved reference');
    expect(previous.semester.year).toBe(2026);
    expect(previous.courseReferences).toMatchObject({
      entries: [{ courseId: course, catalog: { name: 'Original label' } }],
    });
    const fresh = await read();
    expect(fresh.scope.curriculumId).toBe(curriculum);
    expect(fresh.plan.name).toBe('Changed plan');
    expect(fresh.semester.year).toBe(2030);
    expect(fresh.courseReferences).toMatchObject({
      entries: [{ courseId: missing, catalog: null }],
    });
  });
  it('coexists with plan and semester lists and never rewrites saved history', async () => {
    const before = await prisma.studyPlan.findUnique({
      where: { id: plan },
      include: { semesters: true },
    });
    await read();
    for (const path of [
      '/api/users/me/study-plans',
      `/api/users/me/study-plans/${plan}/semesters`,
      `/api/study-plans/${plan}`,
    ])
      expect((await request(app).get(path).set('Cookie', cookie())).status).toBe(200);
    expect(
      await prisma.studyPlan.findUnique({ where: { id: plan }, include: { semesters: true } }),
    ).toEqual(before);
  });
});

describe('saved course reference contract', () => {
  it('rejects extra private fields and invalid unavailable combinations', () => {
    const entry = {
      courseId: randomUUID(),
      storedPosition: -3,
      catalog: { code: 'CS', name: 'Current label' },
    };
    expect(
      OwnStudyPlanCourseReferencesSchema.safeParse({
        status: 'RECOGNIZED',
        order: 'STORED_ARRAY_ORDER',
        entries: [{ ...entry, catalog: { ...entry.catalog, credits: 3 } }],
      }).success,
    ).toBe(false);
    expect(
      OwnStudyPlanCourseReferencesSchema.safeParse({
        status: 'UNAVAILABLE',
        reason: 'READER_LIMIT',
        entries: [],
      }).success,
    ).toBe(false);
    expect(
      OwnStudyPlanCourseReferencesSchema.safeParse({
        status: 'RECOGNIZED',
        order: 'STORED_ARRAY_ORDER',
        entries: [entry, { ...entry, courseId: entry.courseId.toUpperCase() }],
      }).success,
    ).toBe(false);
  });
});
