import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ListOwnStudyPlansSchema, OwnStudyPlansSchema } from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { listOwnStudyPlans } from '../services/ownStudyPlans';

describe('cookie-owned saved study plan metadata (PostgreSQL)', () => {
  const prefix = `own-study-plans-${randomUUID()}`;
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const adminId = randomUUID();
  const curriculumId = randomUUID();
  const users = [ownerId, otherId, adminId];
  let afterOwnerRead: (() => Promise<void>) | undefined;
  let trace = false;
  const reads: { take: unknown; select: unknown }[] = [];
  const cookie = (id = ownerId) => `${AUTH_COOKIE_NAME}=${issueToken(id)}`;
  const get = (query: object = {}, id = ownerId) =>
    request(app).get('/api/users/me/study-plans').set('Cookie', cookie(id)).query(query);
  const page = async (query: object = {}, id = ownerId) => {
    const response = await get(query, id);
    expect(response.status).toBe(200);
    return OwnStudyPlansSchema.parse(response.body.data);
  };
  const insert = (index = 0, userId = ownerId) =>
    prisma.studyPlan.create({
      data: {
        userId,
        name: `${prefix}-plan-${index}`,
        description: index % 2 === 0 ? null : 'Saved description',
        isActive: index % 2 === 0,
        createdAt: new Date(Date.UTC(2026, 9, 14, 0, 0, index)),
      },
    });
  const clean = async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: curriculumId } });
  };
  beforeAll(() => {
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (trace && params.model === 'StudyPlan' && params.action === 'findMany')
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
    trace = false;
    reads.length = 0;
    await clean();
    await prisma.curriculum.create({
      data: {
        id: curriculumId,
        code: prefix,
        name: 'Reference curriculum',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/own-study-plans',
      },
    });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-user-${index}`,
        email: `${id}@example.test`,
        name: 'Private account name',
        role: id === adminId ? 'ADMIN' : 'STUDENT',
      })),
    });
  });
  afterEach(async () => {
    afterOwnerRead = undefined;
    trace = false;
    await clean();
  });
  afterAll(async () => prisma.$disconnect());

  it('requires a live cookie account and reports an honest empty unassigned scope', async () => {
    expect((await request(app).get('/api/users/me/study-plans')).status).toBe(401);
    expect((await get({}, randomUUID())).status).toBe(401);
    expect(await page()).toEqual({
      visibility: 'CURRENT_ACCOUNT_ONLY',
      order: 'STORED_NEWEST_FIRST',
      scope: { userId: ownerId, curriculumId: null, studyPlansValidated: false },
      pageSize: 5,
      after: null,
      plans: [],
      nextAfter: null,
    });
    await expect(listOwnStudyPlans(randomUUID())).rejects.toMatchObject({ status: 401 });
  });
  it('projects only own metadata and counts without exposing or interpreting historical semester JSON', async () => {
    const own = await insert();
    const other = await insert(1, otherId);
    await prisma.plannedSemester.create({
      data: {
        studyPlanId: own.id,
        semester: 'FALL',
        year: 2026,
        courses: { legacyPrivateShape: ['private course JSON'] },
        totalCredits: 999,
        difficultyScore: 99,
      },
    });
    trace = true;
    const received = await page();
    trace = false;
    expect(received.plans).toEqual([
      {
        id: own.id,
        name: own.name,
        description: null,
        isActive: true,
        createdAt: own.createdAt.toISOString(),
        updatedAt: own.updatedAt.toISOString(),
        semesterCount: 1,
      },
    ]);
    const serialized = JSON.stringify(received);
    for (const hidden of [
      other.id,
      otherId,
      'private course JSON',
      'courses',
      'totalCredits',
      'difficultyScore',
      'email',
      'Private account name',
    ])
      expect(serialized).not.toContain(hidden);
    expect(reads).toHaveLength(1);
    expect(reads[0].take).toBe(6);
    expect(reads[0].select).toEqual({
      id: true,
      name: true,
      description: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { semesters: true } },
    });
  });
  it('administrators receive only their own plans with no cross-account override', async () => {
    await insert();
    const admin = await insert(2, adminId);
    expect((await page({}, adminId)).plans.map(({ id }) => id)).toEqual([admin.id]);
    expect((await get({ userId: ownerId }, adminId)).status).toBe(400);
  });
  it.each([
    { userId: otherId },
    { curriculumId },
    { isActive: 'true' },
    { limit: '100' },
    { page: '2' },
    { after: 'invalid' },
    { after: [randomUUID(), randomUUID()] },
  ])('rejects unsupported query %j', async (query) => {
    expect((await get(query)).status).toBe(400);
  });
  it('rejects a GET body that could supply an alternative identity', async () => {
    expect(
      (
        await request(app)
          .get('/api/users/me/study-plans')
          .set('Cookie', cookie())
          .send({ userId: otherId })
      ).status,
    ).toBe(400);
  });
  it('paginates all plans with a normalized UUID boundary and no skips or repeats', async () => {
    const saved = [];
    for (let index = 0; index < 12; index++) saved.push(await insert(index));
    const first = await page();
    const second = await page({ after: first.nextAfter?.toUpperCase() });
    const third = await page({ after: second.nextAfter });
    expect(first.plans).toHaveLength(5);
    expect(second.after).toBe(first.nextAfter);
    expect(second.plans).toHaveLength(5);
    expect(third.plans).toHaveLength(2);
    expect(third.nextAfter).toBeNull();
    expect([...first.plans, ...second.plans, ...third.plans].map(({ id }) => id)).toEqual(
      saved.reverse().map(({ id }) => id),
    );
  });
  it('uses identifier descending for ties and retains the earlier boundary after a new plan', async () => {
    const rows = [];
    for (let index = 0; index < 7; index++) rows.push(await insert());
    const expected = rows
      .map(({ id }) => id)
      .sort()
      .reverse();
    const first = await page();
    await insert(60);
    const second = await page({ after: first.nextAfter });
    expect([...first.plans, ...second.plans].map(({ id }) => id)).toEqual(expected);
  });
  it('returns one indistinguishable continuation error for foreign, missing and deleted boundaries', async () => {
    const foreign = await insert(0, otherId);
    const deleted = await insert();
    await prisma.studyPlan.delete({ where: { id: deleted.id } });
    const responses = [];
    for (const after of [foreign.id, deleted.id, randomUUID()]) {
      const response = await get({ after });
      expect(response.status).toBe(409);
      responses.push(response.body);
    }
    expect(responses[0]).toEqual(responses[1]);
    expect(responses[1]).toEqual(responses[2]);
  });
  it('reads owner scope and plan metadata from the same repeatable snapshot during a concurrent change', async () => {
    const older = await insert();
    let newerId = '';
    afterOwnerRead = async () => {
      await prisma.user.update({ where: { id: ownerId }, data: { curriculumId } });
      newerId = (await insert(60)).id;
    };
    const snapshot = await page();
    expect(snapshot.scope.curriculumId).toBeNull();
    expect(snapshot.plans.map(({ id }) => id)).toEqual([older.id]);
    const current = await page();
    expect(current.scope).toEqual({ userId: ownerId, curriculumId, studyPlansValidated: false });
    expect(current.plans.map(({ id }) => id)).toEqual([newerId, older.id]);
  });
  it('keeps old plans visible after assignment while explicitly leaving them unvalidated', async () => {
    const plan = await insert();
    await prisma.user.update({ where: { id: ownerId }, data: { curriculumId } });
    const received = await page();
    expect(received.scope).toEqual({ userId: ownerId, curriculumId, studyPlansValidated: false });
    expect(received.plans[0].id).toBe(plan.id);
    expect(received.plans[0]).not.toHaveProperty('curriculumId');
  });
  it('does not mutate the plan, its historical JSON or current course selections', async () => {
    const plan = await insert();
    const before = await prisma.studyPlan.findUnique({
      where: { id: plan.id },
      include: { semesters: true },
    });
    const records = await prisma.studentRecord.findMany({ where: { userId: ownerId } });
    await page();
    expect(
      await prisma.studyPlan.findUnique({ where: { id: plan.id }, include: { semesters: true } }),
    ).toEqual(before);
    expect(await prisma.studentRecord.findMany({ where: { userId: ownerId } })).toEqual(records);
  });
});

describe('strict own saved plan metadata contract', () => {
  const fixture = () => ({
    visibility: 'CURRENT_ACCOUNT_ONLY',
    order: 'STORED_NEWEST_FIRST',
    scope: { userId: randomUUID(), curriculumId: null, studyPlansValidated: false },
    pageSize: 5,
    after: null,
    plans: [
      {
        id: randomUUID(),
        name: 'Plan',
        description: null,
        isActive: true,
        createdAt: '2026-10-14T00:00:00.000Z',
        updatedAt: '2026-10-14T00:00:00.000Z',
        semesterCount: 0,
      },
    ],
    nextAfter: null,
  });
  it('normalizes query UUIDs and rejects alternative identity fields', () => {
    const id = randomUUID();
    expect(ListOwnStudyPlansSchema.parse({ after: id.toUpperCase() })).toEqual({ after: id });
    expect(ListOwnStudyPlansSchema.safeParse({ userId: id }).success).toBe(false);
  });
  it('accepts metadata without claiming that saved plan contents are validated', () => {
    expect(OwnStudyPlansSchema.parse(fixture()).scope.studyPlansValidated).toBe(false);
  });
  it('rejects extra fields at each private metadata boundary', () => {
    const value = fixture();
    expect(OwnStudyPlansSchema.safeParse({ ...value, user: { email: 'secret' } }).success).toBe(
      false,
    );
    expect(
      OwnStudyPlansSchema.safeParse({
        ...value,
        scope: { ...value.scope, studyPlansValidated: true },
      }).success,
    ).toBe(false);
    expect(
      OwnStudyPlansSchema.safeParse({ ...value, plans: [{ ...value.plans[0], courses: [] }] })
        .success,
    ).toBe(false);
  });
  it('rejects duplicate plans, an included cursor and unsupported continuation', () => {
    const value = fixture();
    expect(
      OwnStudyPlansSchema.safeParse({ ...value, plans: [...value.plans, ...value.plans] }).success,
    ).toBe(false);
    expect(OwnStudyPlansSchema.safeParse({ ...value, after: value.plans[0].id }).success).toBe(
      false,
    );
    expect(OwnStudyPlansSchema.safeParse({ ...value, nextAfter: value.plans[0].id }).success).toBe(
      false,
    );
  });
  it('rejects invalid counts, invalid times and ascending storage ordering', () => {
    const value = fixture();
    for (const semesterCount of [-1, 0.5, Infinity])
      expect(
        OwnStudyPlansSchema.safeParse({ ...value, plans: [{ ...value.plans[0], semesterCount }] })
          .success,
      ).toBe(false);
    expect(
      OwnStudyPlansSchema.safeParse({
        ...value,
        plans: [{ ...value.plans[0], createdAt: 'yesterday' }],
      }).success,
    ).toBe(false);
    expect(
      OwnStudyPlansSchema.safeParse({
        ...value,
        plans: [
          value.plans[0],
          { ...value.plans[0], id: randomUUID(), createdAt: '2026-10-15T00:00:00Z' },
        ],
      }).success,
    ).toBe(false);
  });
});
