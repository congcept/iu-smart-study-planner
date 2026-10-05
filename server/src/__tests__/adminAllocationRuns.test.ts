import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AllocationRunV1Schema, type AllocationRunSummaryV1DTO } from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import config from '../config';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { createAllocationRun, readAllocationRun } from '../services/allocationRuns';

describe('school-admin immutable aggregate simulation runs (PostgreSQL)', () => {
  const prefix = `saved-run-${randomUUID()}`;
  const users = Array.from({ length: 3 }, () => randomUUID());
  const contexts = Array.from({ length: 2 }, () => randomUUID());
  const courses = Array.from({ length: 2 }, () => randomUUID());
  const members = Array.from({ length: 2 }, () => randomUUID());
  const originalPolicies = {
    demand: config.cohortDemandPolicy,
    envelope: config.simulationResourcePolicy,
    allocation: config.simulationAllocationPolicy,
    utility: config.allocationUtilityPolicy,
  };
  const scope = () => ({ curriculumId: contexts[0], semester: 'FALL' as const, year: 2026 });
  const body = (requestId = randomUUID()) => ({ ...scope(), requestId });
  const cookie = (userId = users[0]) => `${AUTH_COOKIE_NAME}=${issueToken(userId)}`;
  const post = (input: Record<string, unknown> = body(), userId = users[0]) =>
    request(app).post('/api/admin/allocation-runs').set('Cookie', cookie(userId)).send(input);
  const get = (id: string, userId = users[0]) =>
    request(app).get(`/api/admin/allocation-runs/${id}`).set('Cookie', cookie(userId));
  let afterMiddlewareRead: (() => Promise<void>) | undefined;
  let afterTransactionalRead: (() => Promise<void>) | undefined;
  let targetTransactionalRead = 0;
  let transactionalReadCount = 0;

  const restorePolicies = () => {
    config.cohortDemandPolicy = Object.freeze({ maxCredits: 18, maxDifficulty: 3.5 });
    config.simulationResourcePolicy = Object.freeze({
      ...originalPolicies.envelope,
      classroomTimeBlocks: 1,
      sectionsPerProfessor: 1,
    });
    config.simulationAllocationPolicy = Object.freeze({
      studentUtilityWeight: 0.6,
      resourceFitWeight: 0.25,
      fairnessWeight: 0.15,
      congestionThreshold: 0.85,
    });
    config.allocationUtilityPolicy = Object.freeze({
      difficultyFitWeight: 0.7,
      immediateUnlockWeight: 0.3,
    });
  };
  const clearHooks = () => {
    afterMiddlewareRead = undefined;
    afterTransactionalRead = undefined;
    targetTransactionalRead = 0;
    transactionalReadCount = 0;
  };
  const clean = async () => {
    await prisma.simulationAllocationRun.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
  };
  const resource = (professors = 1, classrooms = 1) =>
    prisma.schoolResource.create({
      data: {
        ...scope(),
        professors,
        classrooms,
        labRooms: 2,
        maxStudentsPerSection: 20,
        revision: 1,
        updatedBy: users[0],
      },
    });
  const evidence = async () => ({
    users: await prisma.user.findMany({ where: { id: { in: users } }, orderBy: { id: 'asc' } }),
    curricula: await prisma.curriculum.findMany({
      where: { id: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    courses: await prisma.course.findMany({
      where: { id: { in: courses } },
      orderBy: { id: 'asc' },
    }),
    members: await prisma.curriculumCourse.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    placements: await prisma.curriculumPlacement.findMany({
      where: { curriculumCourse: { curriculumId: { in: contexts } } },
      orderBy: { id: 'asc' },
    }),
    records: await prisma.studentRecord.findMany({
      where: { userId: { in: users } },
      orderBy: { id: 'asc' },
    }),
    grades: await prisma.gradeAttempt.findMany({
      where: { userId: { in: users } },
      orderBy: { id: 'asc' },
    }),
    ratings: await prisma.courseRating.findMany({
      where: { userId: { in: users } },
      orderBy: { id: 'asc' },
    }),
    plans: await prisma.studyPlan.findMany({
      where: { userId: { in: users } },
      include: { semesters: true },
      orderBy: { id: 'asc' },
    }),
    resources: await prisma.schoolResource.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
  });

  beforeAll(() => {
    // Hooks run only after a real actor SELECT and only for this suite's private actor.
    // Production transaction calls and results are never replaced.
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (
        params.model === 'User' &&
        params.action === 'findUnique' &&
        params.args?.where?.id === users[0]
      ) {
        if (!params.runInTransaction && afterMiddlewareRead) {
          const writer = afterMiddlewareRead;
          afterMiddlewareRead = undefined;
          await writer();
        } else if (params.runInTransaction && afterTransactionalRead) {
          transactionalReadCount++;
          if (transactionalReadCount === targetTransactionalRead) {
            const writer = afterTransactionalRead;
            afterTransactionalRead = undefined;
            await writer();
          }
        }
      }
      return result;
    });
  });
  beforeEach(async () => {
    clearHooks();
    restorePolicies();
    await clean();
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-context-${index}`,
        name: `Stored reference ${index}`,
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/saved-run',
      })),
    });
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-course-${index}`,
        name: `Stored course ${index}`,
        credits: 3,
        difficultyLevel: 2,
        semesterOffered: [],
      })),
    });
    await prisma.curriculumCourse.createMany({
      data: courses.map((courseId, index) => ({
        id: members[index],
        courseId,
        curriculumId: contexts[0],
      })),
    });
    await prisma.curriculumPlacement.createMany({
      data: members.map((curriculumCourseId, sourceOrder) => ({
        curriculumCourseId,
        sourceOrder,
        academicYear: 1,
        academicSemester: 1,
      })),
    });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-user-${index}`,
        email: `${id}@example.test`,
        name: `Private run actor ${index}`,
        passwordHash: 'Private run hash',
        role: index < 2 ? 'ADMIN' : 'STUDENT',
        curriculumId: contexts[0],
      })),
    });
    await prisma.studentRecord.createMany({
      data: [
        {
          userId: users[2],
          courseId: courses[0],
          status: 'PLANNED',
          grade: 'Legacy B+',
          gradePoints: 3.5,
          electiveGroup: 'Historical claim',
        },
        {
          userId: users[2],
          courseId: courses[1],
          status: 'COMPLETED',
          grade: 'Legacy A',
          gradePoints: 4,
        },
      ],
    });
    await prisma.gradeAttempt.create({
      data: { userId: users[2], courseId: courses[1], requestId: randomUUID(), score: 88 },
    });
    await prisma.courseRating.create({
      data: { userId: users[2], courseId: courses[1], rating: 4 },
    });
    await prisma.studyPlan.create({
      data: {
        userId: users[2],
        name: 'Existing historical plan',
        semesters: {
          create: {
            semester: 'FALL',
            year: 2001,
            courses: [{ courseId: courses[0], position: 0 }],
            totalCredits: 31,
            difficultyScore: 4.2,
          },
        },
      },
    });
  });
  afterEach(() => {
    clearHooks();
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    clearHooks();
    config.cohortDemandPolicy = originalPolicies.demand;
    config.simulationResourcePolicy = originalPolicies.envelope;
    config.simulationAllocationPolicy = originalPolicies.allocation;
    config.allocationUtilityPolicy = originalPolicies.utility;
    await clean();
    await prisma.$disconnect();
  });

  it('captures once, replays the immutable ID and returns history without academic/resource mutations', async () => {
    await resource();
    const before = await evidence();
    const input = body();
    const first = await post(input);
    expect(first.status).toBe(201);
    const saved = AllocationRunV1Schema.parse(first.body.data);
    expect(saved).toMatchObject({
      formatVersion: 1,
      snapshotStored: true,
      result: {
        assignmentsPersisted: false,
        assignedStudentCount: 1,
        noChoicesStudentCount: 0,
        resources: { resourceRevision: 1 },
      },
    });
    expect(saved.result.scope).toEqual(scope());
    const again = await post(input);
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual(saved);
    expect((await get(saved.id)).body.data).toEqual(saved);
    expect((await get(saved.id, users[1])).body.data).toEqual(saved);
    expect(
      await prisma.simulationAllocationRun.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(1);
    expect(await evidence()).toEqual(before);
    const serialized = JSON.stringify(saved);
    for (const id of users) expect(serialized).not.toContain(id);
    expect(serialized).not.toContain('Legacy');
    expect(serialized).not.toContain('Private run');
  });

  it('rejects a switched cookie administrator before capture or history recovery', async () => {
    const input = { ...body(), expectedActorId: users[0] };
    expect((await post(input, users[1])).status).toBe(409);
    expect(
      await prisma.simulationAllocationRun.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(0);
    const first = await post(input);
    expect(first.status).toBe(201);
    expect((await post(input, users[1])).status).toBe(409);
    expect(
      await prisma.simulationAllocationRun.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(1);
  });

  it('normalizes the expected actor without using it as authorization', async () => {
    const input = { ...body(), expectedActorId: users[0].toUpperCase() };
    const first = await post(input);
    expect(first.status).toBe(201);
    const retry = await post(input);
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect((await post({ ...body(), expectedActorId: users[0] }, users[2])).status).toBe(403);
  });

  it('rejects malformed actor preconditions without persisting a run', async () => {
    expect((await post({ ...body(), expectedActorId: 'admin' })).status).toBe(400);
    expect(
      await prisma.simulationAllocationRun.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(0);
  });

  it('normalizes uppercase request, scope and run IDs to one key', async () => {
    const input = body();
    const first = await post({
      ...input,
      curriculumId: input.curriculumId.toUpperCase(),
      requestId: input.requestId.toUpperCase(),
    });
    expect(first.status).toBe(201);
    expect((await post(input)).body.data).toEqual(first.body.data);
    expect((await get(String(first.body.data.id).toUpperCase())).body.data).toEqual(
      first.body.data,
    );
    const row = await prisma.simulationAllocationRun.findFirstOrThrow({
      where: { curriculumId: contexts[0] },
    });
    expect(row.requestId).toBe(input.requestId);
  });

  it.each([{ semester: 'SPRING' }, { year: 2027 }, { curriculumId: contexts[1] }])(
    'rejects a retry key reused for another scenario %#',
    async (change) => {
      const input = body();
      expect((await post(input)).status).toBe(201);
      const response = await post({ ...input, ...change });
      expect(response.status).toBe(409);
      expect(response.body.error).toContain('another simulation scenario');
      expect(
        await prisma.simulationAllocationRun.count({ where: { curriculumId: { in: contexts } } }),
      ).toBe(1);
    },
  );

  it('converges three concurrent requests onto one immutable row', async () => {
    await resource();
    const input = body();
    const replies = await Promise.all([post(input), post(input), post(input)]);
    expect(replies.map(({ status }) => status).sort()).toEqual([200, 200, 201]);
    expect(replies[1].body.data).toEqual(replies[0].body.data);
    expect(replies[2].body.data).toEqual(replies[0].body.data);
    expect(
      await prisma.simulationAllocationRun.count({
        where: { curriculumId: contexts[0], requestId: input.requestId },
      }),
    ).toBe(1);
  });

  it('keeps the same retry key independent between administrators', async () => {
    const input = body();
    const first = await post(input);
    const second = await post(input, users[1]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.id).not.toBe(second.body.data.id);
    expect(first.body.data.result).toEqual(second.body.data.result);
    expect((await post(input, users[1])).body.data).toEqual(second.body.data);
  });

  it('requires current ADMIN access for creation, history and direct service calls', async () => {
    const saved = await post();
    const id = String(saved.body.data.id);
    expect((await request(app).post('/api/admin/allocation-runs').send(body())).status).toBe(401);
    expect((await request(app).get(`/api/admin/allocation-runs/${id}`)).status).toBe(401);
    expect((await post(body(), users[2])).status).toBe(403);
    expect((await get(id, users[2])).status).toBe(403);
    expect((await post(body(), randomUUID())).status).toBe(401);
    await expect(createAllocationRun(users[2], body())).rejects.toMatchObject({ status: 403 });
    await expect(readAllocationRun(users[2], id)).rejects.toMatchObject({ status: 403 });
    await expect(readAllocationRun(randomUUID(), id)).rejects.toMatchObject({ status: 401 });
  });

  it.each([
    { requestId: 'not-a-uuid' },
    { curriculumId: 'not-a-uuid' },
    { year: 1999 },
    { year: '2026' },
    { semester: 'WINTER' },
    { result: {} },
    { preview: {} },
    { studentIds: [] },
    { utilityPolicy: { difficultyFitWeight: 1, immediateUnlockWeight: 0 } },
    { formatVersion: 1 },
  ])('rejects malformed or client-supplied capture fields %#', async (override) => {
    expect((await post({ ...body(), ...override })).status).toBe(400);
    expect(
      await prisma.simulationAllocationRun.count({ where: { curriculumId: { in: contexts } } }),
    ).toBe(0);
  });

  it('rejects missing keys, malformed historical IDs and historical query overrides', async () => {
    expect((await post(scope())).status).toBe(400);
    expect((await get('not-a-uuid')).status).toBe(400);
    const saved = await post();
    expect((await get(String(saved.body.data.id)).query({ year: 2027 })).status).toBe(400);
  });

  it('returns not found without creating history for missing scopes or historical IDs', async () => {
    expect((await post({ ...body(), curriculumId: randomUUID() })).status).toBe(404);
    expect((await get(randomUUID())).status).toBe(404);
    expect(
      await prisma.simulationAllocationRun.count({ where: { curriculumId: { in: contexts } } }),
    ).toBe(0);
  });

  it('replays and reads the original result after live configuration, resources and reference labels change', async () => {
    await resource();
    const input = body();
    const saved = await post(input);
    expect(saved.status).toBe(201);
    await prisma.schoolResource.update({
      where: { curriculumId_semester_year: scope() },
      data: { professors: 0, revision: 2 },
    });
    await prisma.curriculum.update({
      where: { id: contexts[0] },
      data: { name: 'Changed live curriculum', code: `${prefix}-changed-live` },
    });
    await prisma.course.update({
      where: { id: courses[0] },
      data: { name: 'Changed live course' },
    });
    await prisma.studentRecord.update({
      where: { userId_courseId: { userId: users[2], courseId: courses[0] } },
      data: { status: 'COMPLETED' },
    });
    await prisma.gradeAttempt.create({
      data: { userId: users[2], courseId: courses[0], requestId: randomUUID(), score: 22 },
    });
    config.allocationUtilityPolicy = { difficultyFitWeight: 0, immediateUnlockWeight: 0 };
    const historical = await get(String(saved.body.data.id));
    expect(historical.status).toBe(200);
    expect(historical.body.data).toEqual(saved.body.data);
    const replay = await post(input);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(saved.body.data);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await post()).status).toBe(500);
    expect(
      await prisma.simulationAllocationRun.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(1);
  });

  it('preserves unknown resources separately from configured zero capacity', async () => {
    const missing = await post();
    expect(missing.status).toBe(201);
    expect(missing.body.data.result).toMatchObject({
      resources: null,
      resourceUnknownStudentCount: 1,
      capacityExhaustedStudentCount: 0,
      assignedStudentCount: 0,
    });
    await resource(0, 0);
    const zero = await post();
    expect(zero.status).toBe(201);
    expect(zero.body.data.result).toMatchObject({
      resourceUnknownStudentCount: 0,
      capacityExhaustedStudentCount: 1,
      assignedStudentCount: 0,
      resources: { sharedSectionCeiling: 0, sharedSeatCeiling: 0 },
    });
    expect((await get(String(missing.body.data.id))).body.data).toEqual(missing.body.data);
  });

  it.each(['summary', 'scope', 'version', 'requestKey'] as const)(
    'blocks raw UPDATE of immutable %s metadata',
    async (field) => {
      const saved = await post();
      const id = String(saved.body.data.id);
      const updates = {
        summary: () =>
          prisma.$executeRaw`UPDATE "simulation_allocation_runs" SET "result" = jsonb_set("result", '{kind}', '"CHANGED"'::jsonb) WHERE "id" = ${id}`,
        scope: () =>
          prisma.$executeRaw`UPDATE "simulation_allocation_runs" SET "year" = 2027 WHERE "id" = ${id}`,
        version: () =>
          prisma.$executeRaw`UPDATE "simulation_allocation_runs" SET "format_version" = 2 WHERE "id" = ${id}`,
        requestKey: () =>
          prisma.$executeRaw`UPDATE "simulation_allocation_runs" SET "request_id" = ${randomUUID()} WHERE "id" = ${id}`,
      };
      await expect(updates[field]()).rejects.toThrow('immutable');
      expect((await get(id)).body.data).toEqual(saved.body.data);
    },
  );

  it('preserves aggregate history when its creator is deleted and restricts curriculum deletion', async () => {
    const saved = await post();
    const id = String(saved.body.data.id);
    await expect(prisma.curriculum.delete({ where: { id: contexts[0] } })).rejects.toMatchObject({
      code: 'P2003',
    });
    await prisma.user.delete({ where: { id: users[0] } });
    expect(
      (await prisma.simulationAllocationRun.findUniqueOrThrow({ where: { id } })).createdById,
    ).toBeNull();
    const response = await get(id, users[1]);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(saved.body.data);
  });

  it.each(['result', 'scope', 'version'] as const)(
    'fails closed on a newly inserted corrupt %s row',
    async (field) => {
      const saved = await post();
      const parsed = AllocationRunV1Schema.parse(saved.body.data);
      const id = randomUUID();
      const result: AllocationRunSummaryV1DTO = parsed.result;
      const rawResult = field === 'result' ? { ...result, assignedStudentCount: 99 } : result;
      const year = field === 'scope' ? 2027 : 2026;
      const version = field === 'version' ? 2 : 1;
      const requestId = randomUUID();
      const now = new Date();
      await prisma.$executeRaw`INSERT INTO "simulation_allocation_runs" ("id", "curriculum_id", "semester", "year", "request_id", "created_by_id", "format_version", "captured_at", "created_at", "result") VALUES (${id}, ${contexts[0]}, 'FALL'::"Semester", ${year}, ${requestId}, ${users[0]}, ${version}, ${now}, ${now}, ${JSON.stringify(rawResult)}::jsonb)`;
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      expect((await get(id)).status).toBe(500);
      expect((await post(body(requestId))).status).toBe(500);
      expect((await get(parsed.id)).body.data).toEqual(parsed);
    },
  );

  it('rejects actor demotion after the middleware SELECT without creating history', async () => {
    afterMiddlewareRead = async () => {
      await prisma.user.update({ where: { id: users[0] }, data: { role: 'STUDENT' } });
    };
    try {
      expect((await post()).status).toBe(403);
      expect(
        await prisma.simulationAllocationRun.count({ where: { curriculumId: contexts[0] } }),
      ).toBe(0);
    } finally {
      clearHooks();
    }
  });

  it('rechecks current ADMIN after capture before storing the aggregate', async () => {
    targetTransactionalRead = 2;
    afterTransactionalRead = async () => {
      await prisma.user.update({ where: { id: users[0] }, data: { role: 'STUDENT' } });
    };
    try {
      expect((await post()).status).toBe(403);
      expect(transactionalReadCount).toBe(2);
      expect(
        await prisma.simulationAllocationRun.count({ where: { curriculumId: contexts[0] } }),
      ).toBe(0);
    } finally {
      clearHooks();
    }
  });

  it('rechecks historical-read authorization after middleware demotion', async () => {
    const saved = await post();
    afterMiddlewareRead = async () => {
      await prisma.user.update({ where: { id: users[0] }, data: { role: 'STUDENT' } });
    };
    try {
      expect((await get(String(saved.body.data.id))).status).toBe(403);
      expect(
        await prisma.simulationAllocationRun.count({ where: { curriculumId: contexts[0] } }),
      ).toBe(1);
    } finally {
      clearHooks();
    }
  });
});
