import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  AllocationRunHistorySchema,
  type AllocationRunSummaryV1DTO,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import config from '../config';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { readAllocationPreview } from '../services/allocationPreview';
import { projectAllocationRunSummary } from '../services/allocationRunProjection';
import { listAllocationRuns } from '../services/allocationRuns';

describe('scoped immutable simulation-run history (PostgreSQL)', () => {
  const prefix = `run-history-${randomUUID()}`;
  const actors = Array.from({ length: 3 }, () => randomUUID());
  const contexts = Array.from({ length: 2 }, () => randomUUID());
  const courseId = randomUUID();
  const memberId = randomUUID();
  const runPrefix = randomUUID().slice(0, 24);
  const runId = (index: number) => `${runPrefix}${index.toString(16).padStart(12, '0')}`;
  const scope = (
    curriculumId = contexts[0],
    semester: ResourceScopeDTO['semester'] = 'FALL',
    year = 2026,
  ): ResourceScopeDTO => ({ curriculumId, semester, year });
  const time = new Date('2026-10-05T01:00:00.000Z');
  const older = new Date('2026-10-04T01:00:00.000Z');
  const originalPolicies = {
    demand: config.cohortDemandPolicy,
    envelope: config.simulationResourcePolicy,
    allocation: config.simulationAllocationPolicy,
    utility: config.allocationUtilityPolicy,
  };
  let summary: AllocationRunSummaryV1DTO;
  let afterMiddlewareRead: (() => Promise<void>) | undefined;
  let afterTransactionalRead: (() => Promise<void>) | undefined;
  const get = (query: Record<string, unknown> = scope(), actorId = actors[0]) =>
    request(app)
      .get('/api/admin/allocation-runs')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(actorId)}`)
      .query(query);
  const clearHooks = () => {
    afterMiddlewareRead = undefined;
    afterTransactionalRead = undefined;
  };
  const clean = async () => {
    await prisma.simulationAllocationRun.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.user.deleteMany({ where: { id: { in: actors } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: courseId } });
  };
  const insert = (index: number, createdAt = time, result = summary, actorId = actors[0]) =>
    prisma.simulationAllocationRun.create({
      data: {
        id: runId(index),
        ...result.scope,
        requestId: randomUUID(),
        createdById: actorId,
        formatVersion: 1,
        capturedAt: createdAt,
        createdAt,
        result,
      },
    });
  const insertMany = (count: number, start = 1, createdAt = time) =>
    prisma.simulationAllocationRun.createMany({
      data: Array.from({ length: count }, (_, offset) => ({
        id: runId(start + offset),
        ...summary.scope,
        requestId: randomUUID(),
        createdById: actors[0],
        formatVersion: 1,
        capturedAt: createdAt,
        createdAt,
        result: summary,
      })),
    });
  const rawInsert = (
    index: number,
    result: unknown,
    version = 1,
    resultScope = scope(),
    createdAt = time,
  ) => prisma.$executeRaw`
    INSERT INTO "simulation_allocation_runs" ("id", "curriculum_id", "semester", "year", "request_id", "created_by_id", "format_version", "captured_at", "created_at", "result")
    VALUES (${runId(index)}, ${resultScope.curriculumId}, ${resultScope.semester}::"Semester", ${resultScope.year}, ${randomUUID()}, ${actors[0]}, ${version}, ${createdAt}, ${createdAt}, ${JSON.stringify(result)}::jsonb)
  `;
  const evidence = async () => ({
    actors: await prisma.user.findMany({ where: { id: { in: actors } }, orderBy: { id: 'asc' } }),
    contexts: await prisma.curriculum.findMany({
      where: { id: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    course: await prisma.course.findUnique({ where: { id: courseId } }),
    records: await prisma.studentRecord.findMany({
      where: { userId: { in: actors } },
      orderBy: { id: 'asc' },
    }),
    grades: await prisma.gradeAttempt.findMany({
      where: { userId: { in: actors } },
      orderBy: { id: 'asc' },
    }),
    resources: await prisma.schoolResource.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    plans: await prisma.studyPlan.findMany({
      where: { userId: { in: actors } },
      include: { semesters: true },
      orderBy: { id: 'asc' },
    }),
    runs: await prisma.simulationAllocationRun.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
  });

  beforeAll(() => {
    // Real SELECTs establish snapshots. Independent fixture writers run afterward;
    // no transaction implementation or returned database row is replaced.
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (
        params.model === 'User' &&
        params.action === 'findUnique' &&
        params.args?.where?.id === actors[0]
      ) {
        if (!params.runInTransaction && afterMiddlewareRead) {
          const writer = afterMiddlewareRead;
          afterMiddlewareRead = undefined;
          await writer();
        } else if (params.runInTransaction && afterTransactionalRead) {
          const writer = afterTransactionalRead;
          afterTransactionalRead = undefined;
          await writer();
        }
      }
      return result;
    });
  });
  beforeEach(async () => {
    clearHooks();
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
    await clean();
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: `Saved historical context ${index}`,
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/run-history',
      })),
    });
    await prisma.course.create({
      data: {
        id: courseId,
        code: `${prefix}-course`,
        name: 'Saved historical course',
        credits: 3,
        difficultyLevel: 2,
        semesterOffered: [],
      },
    });
    await prisma.curriculumCourse.create({
      data: {
        id: memberId,
        courseId,
        curriculumId: contexts[0],
        placements: { create: { academicYear: 1, academicSemester: 1, sourceOrder: 1 } },
      },
    });
    await prisma.user.createMany({
      data: actors.map((id, index) => ({
        id,
        studentId: `${prefix}-actor-${index}`,
        email: `${id}@example.test`,
        name: 'Private history actor',
        passwordHash: 'Private history hash',
        role: index < 2 ? 'ADMIN' : 'STUDENT',
        curriculumId: contexts[0],
      })),
    });
    await prisma.studentRecord.create({
      data: {
        userId: actors[2],
        courseId,
        status: 'PLANNED',
        grade: 'Historical B+',
        gradePoints: 3.5,
      },
    });
    await prisma.gradeAttempt.create({
      data: { userId: actors[2], courseId, requestId: randomUUID(), score: 80 },
    });
    await prisma.studyPlan.create({
      data: {
        userId: actors[2],
        name: 'Private historical plan',
        semesters: {
          create: {
            semester: 'FALL',
            year: 2001,
            courses: [{ courseId, position: 0 }],
            totalCredits: 31,
          },
        },
      },
    });
    await prisma.schoolResource.create({
      data: {
        ...scope(),
        professors: 1,
        classrooms: 1,
        maxStudentsPerSection: 20,
        revision: 1,
        updatedBy: actors[0],
      },
    });
    summary = projectAllocationRunSummary(await readAllocationPreview(actors[0], scope()));
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

  it.each([0, 1, 20, 21])(
    'returns a fixed page with correct continuation for %s stored rows',
    async (count) => {
      if (count) await insertMany(count);
      const before = await evidence();
      const response = await get();
      expect(response.status).toBe(200);
      const history = AllocationRunHistorySchema.parse(response.body.data);
      expect(history).toMatchObject({
        kind: 'SIMULATION',
        usage: 'REFERENCE_ONLY',
        scope: scope(),
        order: 'STORED_NEWEST_FIRST',
        pageSize: 20,
      });
      expect(history.runs.map(({ id }) => id)).toEqual(
        Array.from({ length: Math.min(20, count) }, (_, index) => runId(count - index)),
      );
      expect(history.nextAfter).toBe(count > 20 ? runId(2) : null);
      expect(await evidence()).toEqual(before);
    },
  );

  it('orders tied timestamps by descending ID and pages older timestamps without skips or duplicates', async () => {
    await insertMany(2, 1, older);
    await insertMany(21, 3, time);
    const first = AllocationRunHistorySchema.parse((await get()).body.data);
    expect(first.runs.map(({ id }) => id)).toEqual(
      Array.from({ length: 20 }, (_, index) => runId(23 - index)),
    );
    expect(first.nextAfter).toBe(runId(4));
    const second = AllocationRunHistorySchema.parse(
      (await get({ ...scope(), after: first.nextAfter })).body.data,
    );
    expect(second.runs.map(({ id }) => id)).toEqual([runId(3), runId(2), runId(1)]);
    expect(second.nextAfter).toBeNull();
    expect(new Set([...first.runs, ...second.runs].map(({ id }) => id)).size).toBe(23);
  });

  it('does not duplicate or shift older rows when a newer run is inserted between pages', async () => {
    await insertMany(23);
    const first = AllocationRunHistorySchema.parse((await get()).body.data);
    await insert(30, new Date(time.getTime() + 1000));
    const second = AllocationRunHistorySchema.parse(
      (await get({ ...scope(), after: first.nextAfter })).body.data,
    );
    expect(second.runs.map(({ id }) => id)).toEqual([runId(3), runId(2), runId(1)]);
    expect(second.runs.some(({ id }) => id === runId(30))).toBe(false);
    expect(AllocationRunHistorySchema.parse((await get()).body.data).runs[0].id).toBe(runId(30));
  });

  it('normalizes uppercase scope/cursor IDs and direct-service actor IDs', async () => {
    await insertMany(2);
    const query = {
      ...scope(),
      curriculumId: contexts[0].toUpperCase(),
      after: runId(2).toUpperCase(),
    };
    const response = await get(query);
    expect(response.status).toBe(200);
    const history = AllocationRunHistorySchema.parse(response.body.data);
    expect(history.scope).toEqual(scope());
    expect(history.runs.map(({ id }) => id)).toEqual([runId(1)]);
    expect(await listAllocationRuns(actors[0].toUpperCase(), query)).toEqual(history);
  });

  it('accepts ADMIN-wide history after creator removal without exposing actor identities', async () => {
    await insert(1);
    await insert(2, time, summary, actors[1]);
    const before = AllocationRunHistorySchema.parse(
      (await get({}, actors[1]).query(scope())).body.data,
    );
    await prisma.user.delete({ where: { id: actors[0] } });
    const after = AllocationRunHistorySchema.parse((await get(scope(), actors[1])).body.data);
    expect(after).toEqual(before);
    expect(
      (await prisma.simulationAllocationRun.findUniqueOrThrow({ where: { id: runId(1) } }))
        .createdById,
    ).toBeNull();
    for (const actor of actors) expect(JSON.stringify(after)).not.toContain(actor);
    expect(JSON.stringify(after)).not.toContain('Private history');
  });

  it('requires a current ADMIN for cookie and direct-service listing', async () => {
    expect((await request(app).get('/api/admin/allocation-runs').query(scope())).status).toBe(401);
    expect((await get(scope(), actors[2])).status).toBe(403);
    expect((await get(scope(), randomUUID())).status).toBe(401);
    await expect(listAllocationRuns(actors[2], scope())).rejects.toMatchObject({ status: 403 });
    await expect(listAllocationRuns(randomUUID(), scope())).rejects.toMatchObject({ status: 401 });
  });

  it.each([
    { after: 'not-a-uuid' },
    { after: '' },
    { year: '02026' },
    { year: '2e3' },
    { year: '2026\n' },
    { year: 1999 },
    { curriculumId: 'invalid' },
    { semester: 'WINTER' },
    { limit: 10 },
    { pageSize: 10 },
    { page: 2 },
    { order: 'OLDEST_FIRST' },
    { expectedActorId: actors[0] },
    { utilityPolicy: '{}' },
  ])('rejects malformed or overriding history query %#', async (override) => {
    expect((await get({ ...scope(), ...override })).status).toBe(400);
  });

  it('requires a complete scope and reports missing curriculum before examining cursors', async () => {
    expect((await get({ year: 2026, semester: 'FALL' })).status).toBe(400);
    expect((await get({ ...scope(randomUUID()), after: randomUUID() })).status).toBe(404);
  });

  it.each(['missing', 'curriculum', 'semester', 'year'] as const)(
    'rejects a %s cursor instead of silently restarting history',
    async (mismatch) => {
      await insert(1);
      const query =
        mismatch === 'missing'
          ? { ...scope(), after: randomUUID() }
          : mismatch === 'curriculum'
            ? { ...scope(contexts[1]), after: runId(1) }
            : mismatch === 'semester'
              ? { ...scope(contexts[0], 'SPRING'), after: runId(1) }
              : { ...scope(contexts[0], 'FALL', 2027), after: runId(1) };
      const response = await get(query);
      expect(response.status).toBe(409);
      expect(response.body.error).toContain('reload history');
    },
  );

  it('never mixes histories from other curricula, semesters or years', async () => {
    await insert(1);
    for (const [index, otherScope] of [
      scope(contexts[1]),
      scope(contexts[0], 'SPRING'),
      scope(contexts[0], 'FALL', 2027),
    ].entries()) {
      await insert(index + 2, time, {
        ...summary,
        scope: otherScope,
        curriculum: { ...summary.curriculum, id: otherScope.curriculumId },
      });
    }
    expect(
      AllocationRunHistorySchema.parse((await get()).body.data).runs.map(({ id }) => id),
    ).toEqual([runId(1)]);
  });

  it('uses stored pinned results despite invalid live policies and changed resources, labels and records', async () => {
    await insert(1);
    const initial = AllocationRunHistorySchema.parse((await get()).body.data);
    await prisma.curriculum.update({
      where: { id: contexts[0] },
      data: { name: 'Changed current name' },
    });
    await prisma.course.update({
      where: { id: courseId },
      data: { name: 'Changed current course' },
    });
    await prisma.schoolResource.update({
      where: { curriculumId_semester_year: scope() },
      data: { professors: 0, revision: 2 },
    });
    await prisma.studentRecord.update({
      where: { userId_courseId: { userId: actors[2], courseId } },
      data: { status: 'COMPLETED' },
    });
    config.allocationUtilityPolicy = { difficultyFitWeight: 0, immediateUnlockWeight: 0 };
    config.cohortDemandPolicy = { maxCredits: 0, maxDifficulty: 0 };
    config.simulationResourcePolicy = { ...originalPolicies.envelope, classroomTimeBlocks: -1 };
    config.simulationAllocationPolicy = {
      studentUtilityWeight: 0,
      resourceFitWeight: 0,
      fairnessWeight: 0,
      congestionThreshold: 0.85,
    };
    const before = await evidence();
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(initial);
    expect(await evidence()).toEqual(before);
  });

  it.each(['result', 'scope', 'version'] as const)(
    'rejects a corrupt %s row atomically rather than dropping it',
    async (corruption) => {
      await insert(1);
      const corrupt = corruption === 'result' ? { ...summary, assignedStudentCount: 99 } : summary;
      await rawInsert(
        2,
        corrupt,
        corruption === 'version' ? 2 : 1,
        corruption === 'scope' ? scope(contexts[0], 'FALL', 2027) : scope(),
      );
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const query = corruption === 'scope' ? scope(contexts[0], 'FALL', 2027) : scope();
      const response = await get(query);
      expect(response.status).toBe(500);
      expect(response.body.data).toBeUndefined();
      expect(
        await prisma.simulationAllocationRun.count({ where: { curriculumId: contexts[0] } }),
      ).toBe(2);
    },
  );

  it('validates the 21st lookahead row before returning a history page', async () => {
    await insertMany(20, 2);
    await rawInsert(1, summary, 2);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await get()).status).toBe(500);
  });

  it('validates pinned cursor data even when the cursor itself is not returned', async () => {
    await insert(1, older);
    await rawInsert(2, { ...summary, assignedStudentCount: 99 });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await get({ ...scope(), after: runId(2) })).status).toBe(500);
  });

  it('rejects a cursor removed between page requests', async () => {
    await insertMany(21);
    const first = AllocationRunHistorySchema.parse((await get()).body.data);
    await prisma.simulationAllocationRun.delete({ where: { id: first.nextAfter ?? '' } });
    expect((await get({ ...scope(), after: first.nextAfter })).status).toBe(409);
  });

  it('rechecks current ADMIN after the middleware actor SELECT', async () => {
    await insert(1);
    afterMiddlewareRead = async () => {
      await prisma.user.update({ where: { id: actors[0] }, data: { role: 'STUDENT' } });
    };
    try {
      expect((await get()).status).toBe(403);
    } finally {
      clearHooks();
    }
    expect(
      await prisma.simulationAllocationRun.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(1);
  });

  it('keeps actor, cursor and page in one default PostgreSQL snapshot during a concurrent insertion', async () => {
    await insertMany(2);
    afterTransactionalRead = async () => {
      await insert(3, new Date(time.getTime() + 1000));
    };
    try {
      const during = AllocationRunHistorySchema.parse((await get()).body.data);
      expect(during.runs.map(({ id }) => id)).toEqual([runId(2), runId(1)]);
    } finally {
      clearHooks();
    }
    const latest = AllocationRunHistorySchema.parse((await get()).body.data);
    expect(latest.runs.map(({ id }) => id)).toEqual([runId(3), runId(2), runId(1)]);
  });
});
