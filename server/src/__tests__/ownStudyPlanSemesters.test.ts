import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  ListOwnStudyPlanSemestersSchema,
  OwnStudyPlanSemestersParamsSchema,
  OwnStudyPlanSemestersSchema,
} from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { listOwnStudyPlanSemesters } from '../services/ownStudyPlanSemesters';

describe('cookie-owned saved semester metadata (PostgreSQL)', () => {
  const prefix = `own-plan-semesters-${randomUUID()}`;
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const adminId = randomUUID();
  const curriculumId = randomUUID();
  const users = [ownerId, otherId, adminId];
  let planId: string;
  let otherPlanId: string;
  let secondOwnPlanId: string;
  let afterOwnerRead: (() => Promise<void>) | undefined;
  let tracing = false;
  const reads: { take: unknown; select: unknown }[] = [];
  const cookie = (id = ownerId) => `${AUTH_COOKIE_NAME}=${issueToken(id)}`;
  const get = (query: object = {}, id = ownerId, selected = planId) =>
    request(app)
      .get(`/api/users/me/study-plans/${selected}/semesters`)
      .set('Cookie', cookie(id))
      .query(query);
  const page = async (query: object = {}, id = ownerId, selected = planId) => {
    const response = await get(query, id, selected);
    expect(response.status).toBe(200);
    return OwnStudyPlanSemestersSchema.parse(response.body.data);
  };
  const insert = (index = 0, selected = planId, tied = false) =>
    prisma.plannedSemester.create({
      data: {
        studyPlanId: selected,
        semester: index % 2 ? 'FALL' : 'SPRING',
        year: 2026 + index,
        courses: { historicalPrivateFormat: ['do not expose this JSON'] },
        totalCredits: index === 0 ? -17 : 999 + index,
        difficultyScore: 88,
        createdAt: new Date(Date.UTC(2026, 9, 15, 0, 0, tied ? 0 : index)),
      },
    });
  const clean = async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: curriculumId } });
  };
  beforeAll(() => {
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (tracing && params.model === 'PlannedSemester' && params.action === 'findMany')
        reads.push({ take: params.args?.take, select: params.args?.select });
      if (
        afterOwnerRead &&
        params.runInTransaction &&
        params.model === 'User' &&
        params.action === 'findUnique' &&
        params.args?.where?.id === ownerId
      ) {
        const hook = afterOwnerRead;
        afterOwnerRead = undefined;
        await hook();
      }
      return result;
    });
  });
  beforeEach(async () => {
    afterOwnerRead = undefined;
    tracing = false;
    reads.length = 0;
    await clean();
    await prisma.curriculum.create({
      data: {
        id: curriculumId,
        code: prefix,
        name: 'Reference',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/own-semesters',
      },
    });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        email: `${id}@example.test`,
        name: 'Private owner',
        role: id === adminId ? 'ADMIN' : 'STUDENT',
      })),
    });
    planId = (
      await prisma.studyPlan.create({
        data: { userId: ownerId, name: 'Selected saved plan', description: null },
      })
    ).id;
    secondOwnPlanId = (
      await prisma.studyPlan.create({ data: { userId: ownerId, name: 'Second own plan' } })
    ).id;
    otherPlanId = (
      await prisma.studyPlan.create({ data: { userId: otherId, name: 'Other private plan' } })
    ).id;
  });
  afterEach(async () => {
    afterOwnerRead = undefined;
    tracing = false;
    await clean();
  });
  afterAll(async () => prisma.$disconnect());

  it('requires a live account and returns a valid empty selected plan without assigning it a curriculum', async () => {
    expect((await request(app).get(`/api/users/me/study-plans/${planId}/semesters`)).status).toBe(
      401,
    );
    expect((await get({}, randomUUID())).status).toBe(401);
    await expect(listOwnStudyPlanSemesters(randomUUID(), planId)).rejects.toMatchObject({
      status: 401,
    });
    const received = await page();
    expect(received).toMatchObject({
      scope: { userId: ownerId, curriculumId: null, studyPlansValidated: false },
      plan: { id: planId, semesterCount: 0 },
      semesters: [],
      after: null,
      nextAfter: null,
    });
  });
  it('coexists with own plan metadata and existing authorized plan and account routes', async () => {
    expect(
      (await request(app).get('/api/users/me/study-plans').set('Cookie', cookie())).status,
    ).toBe(200);
    expect(
      (await request(app).get(`/api/study-plans/${planId}`).set('Cookie', cookie())).status,
    ).toBe(200);
    expect((await request(app).get(`/api/users/${ownerId}`).set('Cookie', cookie())).status).toBe(
      200,
    );
    expect((await page()).plan.id).toBe(planId);
  });
  it('returns only selected owned metadata and preserves unusual saved credits without interpreting JSON', async () => {
    const saved = await insert();
    await insert(1, secondOwnPlanId);
    const other = await insert(2, otherPlanId);
    tracing = true;
    const received = await page();
    tracing = false;
    expect(received.semesters).toEqual([
      {
        id: saved.id,
        semester: saved.semester,
        year: saved.year,
        createdAt: saved.createdAt.toISOString(),
        updatedAt: saved.updatedAt.toISOString(),
        storedTotalCredits: -17,
      },
    ]);
    expect(received.plan.semesterCount).toBe(1);
    const serialized = JSON.stringify(received);
    for (const hidden of [
      other.id,
      otherId,
      'Other private plan',
      'do not expose this JSON',
      'courses',
      'difficultyScore',
      'email',
      'Private owner',
    ])
      expect(serialized).not.toContain(hidden);
    expect(reads).toEqual([
      {
        take: 6,
        select: {
          id: true,
          semester: true,
          year: true,
          createdAt: true,
          updatedAt: true,
          totalCredits: true,
        },
      },
    ]);
  });
  it('returns indistinguishable missing/nonowned plan errors even for administrators', async () => {
    const unavailable = await get({}, ownerId, randomUUID());
    const foreign = await get({}, ownerId, otherPlanId);
    const admin = await get({}, adminId, planId);
    expect(unavailable.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(admin.status).toBe(404);
    expect(unavailable.body).toEqual(foreign.body);
    expect(admin.body).toEqual(foreign.body);
  });
  it.each([
    { userId: otherId },
    { curriculumId },
    { limit: '100' },
    { semester: 'FALL' },
    { after: 'bad' },
    { after: [randomUUID(), randomUUID()] },
  ])('rejects unsupported query %j', async (query) => {
    expect((await get(query)).status).toBe(400);
  });
  it('rejects malformed plan identifiers and GET bodies', async () => {
    expect((await get({}, ownerId, 'bad')).status).toBe(400);
    expect(
      (
        await request(app)
          .get(`/api/users/me/study-plans/${planId}/semesters`)
          .set('Cookie', cookie())
          .send({ userId: otherId })
      ).status,
    ).toBe(400);
  });
  it('paginates twelve rows by storage time rather than academic chronology', async () => {
    const saved = [];
    for (let index = 0; index < 12; index++) saved.push(await insert(index));
    const first = await page();
    const second = await page(
      { after: first.nextAfter?.toUpperCase() },
      ownerId,
      planId.toUpperCase(),
    );
    const third = await page({ after: second.nextAfter });
    expect(first.semesters).toHaveLength(5);
    expect(second.semesters).toHaveLength(5);
    expect(second.after).toBe(first.nextAfter);
    expect(third.semesters).toHaveLength(2);
    expect(third.nextAfter).toBeNull();
    expect(
      [...first.semesters, ...second.semesters, ...third.semesters].map(({ id }) => id),
    ).toEqual(saved.reverse().map(({ id }) => id));
    expect(first.plan.semesterCount).toBe(12);
  });
  it('uses identifiers for tied timestamps and retains the original boundary after a new semester', async () => {
    const saved = [];
    for (let index = 0; index < 7; index++) saved.push(await insert(index, planId, true));
    const first = await page();
    await insert(60);
    const second = await page({ after: first.nextAfter });
    expect([...first.semesters, ...second.semesters].map(({ id }) => id)).toEqual(
      saved
        .map(({ id }) => id)
        .sort()
        .reverse(),
    );
  });
  it('returns one continuation error for missing, deleted, foreign and different-own-plan cursors', async () => {
    const foreign = await insert(0, otherPlanId);
    const different = await insert(0, secondOwnPlanId);
    const deleted = await insert();
    await prisma.plannedSemester.delete({ where: { id: deleted.id } });
    const outcomes: unknown[] = [];
    for (const after of [foreign.id, different.id, deleted.id, randomUUID()]) {
      const response = await get({ after });
      expect(response.status).toBe(409);
      outcomes.push(response.body);
    }
    expect(
      outcomes.every((outcome) => JSON.stringify(outcome) === JSON.stringify(outcomes[0])),
    ).toBe(true);
  });
  it('reads plan/count/rows and live curriculum scope coherently during concurrent changes', async () => {
    const old = await insert();
    let newerId = '';
    afterOwnerRead = async () => {
      await prisma.user.update({ where: { id: ownerId }, data: { curriculumId } });
      await prisma.studyPlan.update({
        where: { id: planId },
        data: { name: 'Changed metadata', isActive: false },
      });
      newerId = (await insert(60)).id;
    };
    const consistent = await page();
    expect(consistent.scope.curriculumId).toBeNull();
    expect(consistent.plan).toMatchObject({
      name: 'Selected saved plan',
      isActive: true,
      semesterCount: 1,
    });
    expect(consistent.semesters.map(({ id }) => id)).toEqual([old.id]);
    const fresh = await page();
    expect(fresh.scope).toEqual({ userId: ownerId, curriculumId, studyPlansValidated: false });
    expect(fresh.plan).toMatchObject({
      name: 'Changed metadata',
      isActive: false,
      semesterCount: 2,
    });
    expect(fresh.semesters.map(({ id }) => id)).toEqual([newerId, old.id]);
  });
  it('does not rewrite historic semester content, cached totals or the selected plan', async () => {
    await insert();
    const before = await prisma.studyPlan.findUnique({
      where: { id: planId },
      include: { semesters: true },
    });
    await page();
    expect(
      await prisma.studyPlan.findUnique({ where: { id: planId }, include: { semesters: true } }),
    ).toEqual(before);
  });
});

describe('strict saved semester metadata contract', () => {
  const fixture = () => ({
    visibility: 'CURRENT_ACCOUNT_ONLY',
    order: 'STORED_NEWEST_FIRST',
    scope: { userId: randomUUID(), curriculumId: null, studyPlansValidated: false },
    plan: {
      id: randomUUID(),
      name: 'Saved plan',
      description: null,
      isActive: true,
      createdAt: '2026-10-15T00:00:00.000Z',
      updatedAt: '2026-10-15T00:00:00.000Z',
      semesterCount: 1,
    },
    pageSize: 5,
    after: null,
    semesters: [
      {
        id: randomUUID(),
        semester: 'FALL',
        year: 1900,
        createdAt: '2026-10-15T00:00:00.000Z',
        updatedAt: '2026-10-15T00:00:00.000Z',
        storedTotalCredits: -17,
      },
    ],
    nextAfter: null,
  });
  it('normalizes requested identifiers and rejects alternate identity or scope fields', () => {
    const id = randomUUID();
    expect(OwnStudyPlanSemestersParamsSchema.parse({ planId: id.toUpperCase() })).toEqual({
      planId: id,
    });
    expect(ListOwnStudyPlanSemestersSchema.parse({ after: id.toUpperCase() })).toEqual({
      after: id,
    });
    expect(ListOwnStudyPlanSemestersSchema.safeParse({ userId: id }).success).toBe(false);
    expect(
      OwnStudyPlanSemestersParamsSchema.safeParse({ planId: id, curriculumId: id }).success,
    ).toBe(false);
  });
  it('preserves historical signed integers without claiming current planning eligibility', () => {
    const value = fixture();
    expect(OwnStudyPlanSemestersSchema.parse(value).semesters[0].storedTotalCredits).toBe(-17);
    expect(
      OwnStudyPlanSemestersSchema.parse({
        ...value,
        semesters: [{ ...value.semesters[0], storedTotalCredits: 2147483647 }],
      }).scope.studyPlansValidated,
    ).toBe(false);
  });
  it('rejects unexpected JSON, difficulty or validation claims', () => {
    const value = fixture();
    expect(
      OwnStudyPlanSemestersSchema.safeParse({
        ...value,
        semesters: [{ ...value.semesters[0], courses: [] }],
      }).success,
    ).toBe(false);
    expect(
      OwnStudyPlanSemestersSchema.safeParse({
        ...value,
        semesters: [{ ...value.semesters[0], difficultyScore: 3 }],
      }).success,
    ).toBe(false);
    expect(
      OwnStudyPlanSemestersSchema.safeParse({
        ...value,
        scope: { ...value.scope, studyPlansValidated: true },
      }).success,
    ).toBe(false);
  });
  it('rejects duplicate or out-of-order semesters and invalid page boundaries', () => {
    const value = fixture();
    expect(
      OwnStudyPlanSemestersSchema.safeParse({
        ...value,
        plan: { ...value.plan, semesterCount: 2 },
        semesters: [...value.semesters, ...value.semesters],
      }).success,
    ).toBe(false);
    expect(
      OwnStudyPlanSemestersSchema.safeParse({ ...value, after: value.semesters[0].id }).success,
    ).toBe(false);
    expect(
      OwnStudyPlanSemestersSchema.safeParse({ ...value, nextAfter: value.semesters[0].id }).success,
    ).toBe(false);
    expect(
      OwnStudyPlanSemestersSchema.safeParse({
        ...value,
        plan: { ...value.plan, semesterCount: 2 },
        semesters: [
          value.semesters[0],
          { ...value.semesters[0], id: randomUUID(), createdAt: '2026-10-16T00:00:00.000Z' },
        ],
      }).success,
    ).toBe(false);
  });
  it('rejects unsupported semester labels and noninteger saved totals', () => {
    const value = fixture();
    expect(
      OwnStudyPlanSemestersSchema.safeParse({
        ...value,
        semesters: [{ ...value.semesters[0], semester: 'WINTER' }],
      }).success,
    ).toBe(false);
    expect(
      OwnStudyPlanSemestersSchema.safeParse({
        ...value,
        semesters: [{ ...value.semesters[0], storedTotalCredits: 0.5 }],
      }).success,
    ).toBe(false);
    expect(
      OwnStudyPlanSemestersSchema.safeParse({
        ...value,
        semesters: [{ ...value.semesters[0], storedTotalCredits: Infinity }],
      }).success,
    ).toBe(false);
    expect(
      OwnStudyPlanSemestersSchema.safeParse({ ...value, plan: { ...value.plan, semesterCount: 0 } })
        .success,
    ).toBe(false);
  });
});
