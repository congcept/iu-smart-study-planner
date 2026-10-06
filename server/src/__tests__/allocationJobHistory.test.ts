import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { SimulationAllocationJob } from '@prisma/client';
import {
  AllocationJobHistorySchema,
  type AllocationRunSummaryV1DTO,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import config from '../config';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import * as preview from '../services/allocationPreview';
import { projectAllocationRunSummary } from '../services/allocationRunProjection';
import { listAllocationJobs } from '../services/allocationJobHistory';

describe('bounded simulation request history (PostgreSQL)', () => {
  const prefix = `job-history-${randomUUID()}`;
  const actors = Array.from({ length: 3 }, () => randomUUID());
  const contexts = Array.from({ length: 2 }, () => randomUUID());
  const courseId = randomUUID();
  const jobPrefix = randomUUID().slice(0, 24);
  const jobId = (index: number) => `${jobPrefix}${index.toString(16).padStart(12, '0')}`;
  const scope = (
    curriculumId = contexts[0],
    semester: ResourceScopeDTO['semester'] = 'FALL',
    year = 2026,
  ): ResourceScopeDTO => ({ curriculumId, semester, year });
  const queuedAt = new Date('2026-10-06T01:00:00.000Z');
  const older = new Date('2026-10-05T01:00:00.000Z');
  const originalPolicies = {
    demand: config.cohortDemandPolicy,
    envelope: config.simulationResourcePolicy,
    allocation: config.simulationAllocationPolicy,
    utility: config.allocationUtilityPolicy,
  };
  let summary: AllocationRunSummaryV1DTO;
  let afterMiddlewareRead: (() => Promise<void>) | undefined;
  let afterTransactionalRead: (() => Promise<void>) | undefined;
  let lastPageTake: number | undefined;
  let historyReads = 0;
  const clearHooks = () => {
    afterMiddlewareRead = undefined;
    afterTransactionalRead = undefined;
    lastPageTake = undefined;
    historyReads = 0;
  };
  const get = (query: Record<string, unknown> = scope(), actorId = actors[0]) =>
    request(app)
      .get('/api/admin/allocation-jobs')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(actorId)}`)
      .query(query);
  const clean = async () => {
    await prisma.simulationAllocationExecution.deleteMany({
      where: { job: { curriculumId: { in: contexts } } },
    });
    await prisma.simulationAllocationRun.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.simulationAllocationJob.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.user.deleteMany({ where: { id: { in: actors } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: courseId } });
  };
  const insert = (index: number, createdAt = queuedAt, scenario = scope()) =>
    prisma.simulationAllocationJob.create({
      data: {
        id: jobId(index),
        ...scenario,
        createdAt,
        createdById: actors[1],
        requestId: randomUUID(),
      },
    });
  const insertMany = (count: number, start = 1, createdAt = queuedAt) =>
    prisma.simulationAllocationJob.createMany({
      data: Array.from({ length: count }, (_, offset) => ({
        id: jobId(start + offset),
        ...scope(),
        createdAt,
        createdById: actors[1],
        requestId: randomUUID(),
      })),
    });
  const fail = (job: SimulationAllocationJob) =>
    prisma.simulationAllocationExecution.create({
      data: {
        jobId: job.id,
        status: 'FAILED',
        failureCode: 'AUTHOR_UNAVAILABLE',
        completedAt: new Date(job.createdAt.getTime() + 1000),
      },
    });
  const succeed = async (
    job: SimulationAllocationJob,
    options: {
      linkedJobId?: string | null;
      creatorId?: string;
      result?: unknown;
      version?: number;
      capturedAt?: Date;
      completedAt?: Date;
    } = {},
  ) => {
    const id = randomUUID();
    const storedAt = new Date(job.createdAt.getTime() + 1000);
    const capturedAt = options.capturedAt ?? storedAt;
    const linkedJobId = options.linkedJobId === undefined ? job.id : options.linkedJobId;
    // Insert invalid fixtures initially; protected immutable rows are never altered for a test.
    await prisma.$executeRaw`
      INSERT INTO simulation_allocation_runs
        (id, curriculum_id, semester, year, job_id, request_id, created_by_id, format_version, captured_at, created_at, result)
      VALUES (${id}, ${job.curriculumId}, ${job.semester}::"Semester", ${job.year}, ${linkedJobId},
        ${randomUUID()}, ${options.creatorId ?? job.createdById}, ${options.version ?? 1},
        ${capturedAt}, ${storedAt}, ${JSON.stringify(options.result ?? summary)}::jsonb)
    `;
    await prisma.simulationAllocationExecution.create({
      data: {
        jobId: job.id,
        status: 'SUCCEEDED',
        runId: id,
        completedAt: options.completedAt ?? new Date(storedAt.getTime() + 1000),
      },
    });
    return id;
  };
  const evidence = async () => ({
    users: await prisma.user.findMany({ where: { id: { in: actors } }, orderBy: { id: 'asc' } }),
    contexts: await prisma.curriculum.findMany({
      where: { id: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    courses: await prisma.course.findMany({ where: { id: courseId } }),
    members: await prisma.curriculumCourse.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    placements: await prisma.curriculumPlacement.findMany({
      where: { curriculumCourse: { curriculumId: { in: contexts } } },
      orderBy: { id: 'asc' },
    }),
    records: await prisma.studentRecord.findMany({
      where: { userId: { in: actors } },
      orderBy: { id: 'asc' },
    }),
    grades: await prisma.gradeAttempt.findMany({
      where: { userId: { in: actors } },
      orderBy: { id: 'asc' },
    }),
    plans: await prisma.studyPlan.findMany({
      where: { userId: { in: actors } },
      include: { semesters: true },
      orderBy: { id: 'asc' },
    }),
    resources: await prisma.schoolResource.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    jobs: await prisma.simulationAllocationJob.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    runs: await prisma.simulationAllocationRun.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    executions: await prisma.simulationAllocationExecution.findMany({
      where: { job: { curriculumId: { in: contexts } } },
      orderBy: { jobId: 'asc' },
    }),
  });

  beforeAll(() => {
    // Observe actual PostgreSQL reads; independent writers commit after the real SELECT.
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (params.model === 'SimulationAllocationJob' && params.runInTransaction) {
        historyReads++;
        if (params.action === 'findMany') lastPageTake = params.args?.take;
      }
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
        code: `${prefix}-context-${index}`,
        name: 'Historical reference',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/job-history',
      })),
    });
    await prisma.user.createMany({
      data: actors.map((id, index) => ({
        id,
        studentId: `${prefix}-actor-${index}`,
        email: `${id}@example.test`,
        name: `Private history actor ${index}`,
        passwordHash: 'Private unused hash',
        role: index < 2 ? 'ADMIN' : 'STUDENT',
        curriculumId: contexts[0],
      })),
    });
    await prisma.course.create({
      data: {
        id: courseId,
        code: `${prefix}-course`,
        name: 'Reference course',
        credits: 3,
        difficultyLevel: 2,
        semesterOffered: [],
      },
    });
    await prisma.curriculumCourse.create({
      data: {
        courseId,
        curriculumId: contexts[0],
        placements: { create: { academicYear: 1, academicSemester: 1, sourceOrder: 1 } },
      },
    });
    await prisma.studentRecord.create({
      data: {
        userId: actors[2],
        courseId,
        status: 'PLANNED',
        grade: 'Private legacy B+',
        gradePoints: 3.5,
      },
    });
    await prisma.gradeAttempt.createMany({
      data: [56, 89].map((score) => ({
        userId: actors[2],
        courseId,
        score,
        requestId: randomUUID(),
      })),
    });
    await prisma.studyPlan.create({
      data: {
        userId: actors[2],
        name: 'Private history plan',
        semesters: {
          create: {
            semester: 'FALL',
            year: 2026,
            courses: [{ courseId, position: 0 }],
            totalCredits: 3,
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
        updatedBy: actors[1],
      },
    });
    summary = projectAllocationRunSummary(await preview.readAllocationPreview(actors[0], scope()));
    clearHooks();
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
    'returns at most twenty rows with correct continuation for %i requests',
    async (count) => {
      if (count) await insertMany(count);
      const response = await get();
      expect(response.status).toBe(200);
      const page = AllocationJobHistorySchema.parse(response.body.data);
      expect(page).toMatchObject({ scope: scope(), order: 'QUEUED_NEWEST_FIRST', pageSize: 20 });
      expect(page.jobs.map((job) => job.jobId)).toEqual(
        Array.from({ length: Math.min(count, 20) }, (_, offset) => jobId(count - offset)),
      );
      expect(page.nextAfter).toBe(count > 20 ? jobId(2) : null);
      expect(lastPageTake).toBe(21);
    },
  );

  it('pages forty timestamp ties exactly once with no unnecessary third page', async () => {
    await insertMany(40);
    const first = AllocationJobHistorySchema.parse((await get()).body.data);
    const second = AllocationJobHistorySchema.parse(
      (await get({ ...scope(), after: first.nextAfter })).body.data,
    );
    expect(first.nextAfter).toBe(jobId(21));
    expect(second.nextAfter).toBeNull();
    expect([...first.jobs, ...second.jobs].map((job) => job.jobId)).toEqual(
      Array.from({ length: 40 }, (_, offset) => jobId(40 - offset)),
    );
  });

  it('uses enqueue time before UUID and ignores newer insertions between page requests', async () => {
    await insertMany(2, 1, older);
    await insertMany(21, 3);
    const first = AllocationJobHistorySchema.parse((await get()).body.data);
    expect(first.jobs.map((job) => job.jobId)).toEqual(
      Array.from({ length: 20 }, (_, offset) => jobId(23 - offset)),
    );
    await insert(30, new Date(queuedAt.getTime() + 1000));
    const second = AllocationJobHistorySchema.parse(
      (await get({ ...scope(), after: first.nextAfter })).body.data,
    );
    expect(second.jobs.map((job) => job.jobId)).toEqual([jobId(3), jobId(2), jobId(1)]);
    expect(second.nextAfter).toBeNull();
    expect(AllocationJobHistorySchema.parse((await get()).body.data).jobs[0].jobId).toBe(jobId(30));
  });

  it('shows mixed terminal/current outcomes without private requests or any source/history writes', async () => {
    const pending = await insert(1);
    const successful = await insert(2);
    const failed = await insert(3);
    const runId = await succeed(successful);
    await fail(failed);
    const before = await evidence();
    const livePreview = jest.spyOn(preview, 'readAllocationPreview');
    const response = await get();
    expect(response.status).toBe(200);
    const page = AllocationJobHistorySchema.parse(response.body.data);
    expect(page.jobs.map(({ jobId, status, runId }) => ({ jobId, status, runId }))).toEqual([
      { jobId: failed.id, status: 'FAILED', runId: null },
      { jobId: successful.id, status: 'SUCCEEDED', runId },
      { jobId: pending.id, status: 'PENDING', runId: null },
    ]);
    expect(livePreview).not.toHaveBeenCalled();
    expect(await evidence()).toEqual(before);
    const serialized = JSON.stringify(response.body);
    for (const actor of actors) expect(serialized).not.toContain(actor);
    for (const job of before.jobs) expect(serialized).not.toContain(job.requestId);
    for (const run of before.runs) expect(serialized).not.toContain(run.requestId);
    expect(serialized).not.toContain('Private');
    expect(serialized).not.toContain('createdById');
    expect(serialized).not.toContain('result');
  });

  it('normalizes actor, selected context and cursor UUIDs in route and direct service reads', async () => {
    await insertMany(2);
    const input = {
      ...scope(),
      curriculumId: contexts[0].toUpperCase(),
      after: jobId(2).toUpperCase(),
    };
    const response = await get(input);
    expect(response.status).toBe(200);
    const page = AllocationJobHistorySchema.parse(response.body.data);
    expect(page.scope).toEqual(scope());
    expect(page.jobs.map((job) => job.jobId)).toEqual([jobId(1)]);
    expect(await listAllocationJobs(actors[0].toUpperCase(), input)).toEqual(page);
  });

  it('keeps chosen curriculum, semester and year histories separate', async () => {
    await insert(1);
    for (const [offset, scenario] of [
      scope(contexts[1]),
      scope(contexts[0], 'SPRING'),
      scope(contexts[0], 'FALL', 2027),
    ].entries()) {
      await insert(offset + 2, queuedAt, scenario);
      expect(
        AllocationJobHistorySchema.parse((await get(scenario)).body.data).jobs.map(
          (job) => job.jobId,
        ),
      ).toEqual([jobId(offset + 2)]);
    }
    expect(
      AllocationJobHistorySchema.parse((await get()).body.data).jobs.map((job) => job.jobId),
    ).toEqual([jobId(1)]);
  });

  it('reports outcome changes without shifting the immutable cursor boundary', async () => {
    await insertMany(21);
    const first = AllocationJobHistorySchema.parse((await get()).body.data);
    const cursor = await prisma.simulationAllocationJob.findUniqueOrThrow({
      where: { id: first.nextAfter! },
    });
    const oldest = await prisma.simulationAllocationJob.findUniqueOrThrow({
      where: { id: jobId(1) },
    });
    await succeed(cursor);
    await fail(oldest);
    const second = AllocationJobHistorySchema.parse(
      (await get({ ...scope(), after: first.nextAfter })).body.data,
    );
    expect(second.jobs.map(({ jobId, status }) => ({ jobId, status }))).toEqual([
      { jobId: jobId(1), status: 'FAILED' },
    ]);
    const refreshed = AllocationJobHistorySchema.parse((await get()).body.data);
    expect(refreshed.nextAfter).toBe(first.nextAfter);
    expect(refreshed.jobs.at(-1)?.status).toBe('SUCCEEDED');
    expect(first.jobs.at(-1)?.status).toBe('PENDING');
  });

  it('reads one repeatable snapshot of enqueue and execution during committed concurrent writes', async () => {
    const existing = await insert(1);
    afterTransactionalRead = async () => {
      await insert(2);
      await fail(existing);
    };
    const during = AllocationJobHistorySchema.parse((await get()).body.data);
    expect(during.jobs.map(({ jobId, status }) => ({ jobId, status }))).toEqual([
      { jobId: jobId(1), status: 'PENDING' },
    ]);
    const latest = AllocationJobHistorySchema.parse((await get()).body.data);
    expect(latest.jobs.map(({ jobId, status }) => ({ jobId, status }))).toEqual([
      { jobId: jobId(2), status: 'PENDING' },
      { jobId: jobId(1), status: 'FAILED' },
    ]);
  });

  it('retains private-safe successful history after original-author anonymization', async () => {
    const job = await insert(1);
    const runId = await succeed(job);
    const before = AllocationJobHistorySchema.parse((await get()).body.data);
    await prisma.user.delete({ where: { id: actors[1] } });
    expect(AllocationJobHistorySchema.parse((await get()).body.data)).toEqual(before);
    expect(
      (await prisma.simulationAllocationJob.findUniqueOrThrow({ where: { id: job.id } }))
        .createdById,
    ).toBeNull();
    expect(
      (await prisma.simulationAllocationRun.findUniqueOrThrow({ where: { id: runId } }))
        .createdById,
    ).toBeNull();
  });

  it('uses pinned history despite unavailable authors and invalid current policies/resources', async () => {
    await succeed(await insert(1));
    const initial = AllocationJobHistorySchema.parse((await get()).body.data);
    await prisma.user.update({ where: { id: actors[1] }, data: { role: 'STUDENT' } });
    await prisma.schoolResource.update({
      where: { curriculumId_semester_year: scope() },
      data: { professors: 0, revision: 2 },
    });
    config.allocationUtilityPolicy = { difficultyFitWeight: NaN, immediateUnlockWeight: 0 };
    config.cohortDemandPolicy = { maxCredits: 0, maxDifficulty: 0 };
    config.simulationResourcePolicy = { ...originalPolicies.envelope, classroomTimeBlocks: -1 };
    config.simulationAllocationPolicy = {
      studentUtilityWeight: 0,
      resourceFitWeight: 0,
      fairnessWeight: 0,
      congestionThreshold: 0.85,
    };
    const before = await evidence();
    const livePreview = jest.spyOn(preview, 'readAllocationPreview');
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(initial);
    expect(livePreview).not.toHaveBeenCalled();
    expect(await evidence()).toEqual(before);
  });

  it('requires fresh ADMIN authorization before context or cursor lookup', async () => {
    expect((await request(app).get('/api/admin/allocation-jobs').query(scope())).status).toBe(401);
    expect((await get(scope(), actors[2])).status).toBe(403);
    expect((await get(scope(), randomUUID())).status).toBe(401);
    await expect(
      listAllocationJobs(actors[2], { ...scope(randomUUID()), after: randomUUID() }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(listAllocationJobs(randomUUID(), scope())).rejects.toMatchObject({ status: 401 });
    expect(historyReads).toBe(0);
  });

  it('rejects role demotion committed after the real middleware account read', async () => {
    await insert(1);
    afterMiddlewareRead = async () => {
      await prisma.user.update({ where: { id: actors[0] }, data: { role: 'STUDENT' } });
    };
    expect((await get()).status).toBe(403);
    expect(historyReads).toBe(0);
    expect(
      await prisma.simulationAllocationExecution.count({
        where: { job: { curriculumId: contexts[0] } },
      }),
    ).toBe(0);
  });

  it.each([
    { after: '' },
    { after: `${jobId(1)}\n` },
    { curriculumId: `${contexts[0]}\n` },
    { year: '02026' },
    { year: '2e3' },
    { year: '2026\n' },
    { year: ['2026', '2027'] },
    { semester: 'WINTER' },
    { limit: 10 },
    { status: 'PENDING' },
    { createdById: actors[0] },
  ])('rejects malformed or overriding HTTP query %# without history reads', async (fields) => {
    expect((await get({ ...scope(), ...fields })).status).toBe(400);
    expect(historyReads).toBe(0);
  });

  it('rejects incomplete scope and body overrides, and reports missing context before cursor', async () => {
    expect((await get({ semester: 'FALL', year: '2026' })).status).toBe(400);
    expect((await get().send({ year: 2027 })).status).toBe(400);
    expect((await get({ ...scope(randomUUID()), after: randomUUID() })).status).toBe(404);
    expect(historyReads).toBe(0);
  });

  it.each(['missing', 'curriculum', 'semester', 'year'] as const)(
    'rejects a %s continuation with a reload conflict',
    async (mismatch) => {
      await insert(1);
      const scenario =
        mismatch === 'curriculum'
          ? scope(contexts[1])
          : mismatch === 'semester'
            ? scope(contexts[0], 'SPRING')
            : mismatch === 'year'
              ? scope(contexts[0], 'FALL', 2027)
              : scope();
      const response = await get({
        ...scenario,
        after: mismatch === 'missing' ? randomUUID() : jobId(1),
      });
      expect(response.status).toBe(409);
      expect(response.body.error).toContain('reload history');
      expect(response.body.data).toBeUndefined();
    },
  );

  it('rejects a cursor removed between page requests instead of silently restarting', async () => {
    await insertMany(21);
    const first = AllocationJobHistorySchema.parse((await get()).body.data);
    await prisma.simulationAllocationJob.delete({ where: { id: first.nextAfter! } });
    expect((await get({ ...scope(), after: first.nextAfter })).status).toBe(409);
  });

  it.each([
    'manualLink',
    'creator',
    'scope',
    'version',
    'privateResult',
    'captureTime',
    'completionTime',
  ] as const)(
    'fails closed on corrupt %s provenance without returning partial or private data',
    async (corruption) => {
      await insert(1);
      const job = await insert(2);
      await succeed(job, {
        ...(corruption === 'manualLink' ? { linkedJobId: null } : {}),
        ...(corruption === 'creator' ? { creatorId: actors[0] } : {}),
        ...(corruption === 'scope'
          ? { result: { ...summary, scope: scope(contexts[0], 'FALL', 2027) } }
          : {}),
        ...(corruption === 'version' ? { version: 2 } : {}),
        ...(corruption === 'privateResult'
          ? { result: { ...summary, studentIds: [actors[2]], secret: 'Private corrupt payload' } }
          : {}),
        ...(corruption === 'captureTime'
          ? { capturedAt: new Date(job.createdAt.getTime() - 1) }
          : {}),
        ...(corruption === 'completionTime'
          ? { completedAt: new Date(job.createdAt.getTime() - 1) }
          : {}),
      });
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const before = await evidence();
      const response = await get();
      expect(response.status).toBe(500);
      expect(response.body.data).toBeUndefined();
      expect(response.body.error).toBe('Could not load simulation request history');
      for (const actor of actors) expect(JSON.stringify(response.body)).not.toContain(actor);
      expect(JSON.stringify(response.body)).not.toContain('Private');
      expect(await evidence()).toEqual(before);
    },
  );

  it.each(['cursor', 'lookahead'] as const)(
    'validates corrupt %s outcome even when it is not displayed',
    async (position) => {
      await insertMany(20, 2);
      const corrupt = await insert(1);
      await succeed(corrupt, { linkedJobId: null });
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const response = await get(
        position === 'cursor' ? { ...scope(), after: corrupt.id } : scope(),
      );
      expect(response.status).toBe(500);
      expect(response.body.data).toBeUndefined();
      expect(response.body.error).toBe('Could not load simulation request history');
    },
  );
});
