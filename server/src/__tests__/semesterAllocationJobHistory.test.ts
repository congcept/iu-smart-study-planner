import { randomUUID } from 'node:crypto';
import { Prisma, type SimulationSemesterAllocationJob } from '@prisma/client';
import request from 'supertest';
import {
  SemesterAllocationJobHistorySchema,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import config from '../config';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { enqueueAllocationJob } from '../services/allocationJobs';
import { listSemesterAllocationJobs } from '../services/semesterAllocationJobHistory';
import { runOneSemesterAllocationJob } from '../services/semesterAllocationJobExecution';
import * as preview from '../services/semesterAllocationPreview';

describe('bounded semester simulation request history (PostgreSQL)', () => {
  const prefix = `semester-history-${randomUUID()}`;
  const actors = Array.from({ length: 4 }, () => randomUUID());
  const contexts = [randomUUID(), randomUUID()];
  const courses = [randomUUID(), randomUUID()];
  const jobPrefix = randomUUID().slice(0, 24);
  const jobId = (index: number) => `${jobPrefix}${index.toString(16).padStart(12, '0')}`;
  const scope = (
    curriculumId = contexts[0],
    semester: ResourceScopeDTO['semester'] = 'FALL',
    year = 2026,
  ): ResourceScopeDTO => ({ curriculumId, semester, year });
  const queuedAt = new Date('2026-10-06T01:00:00.000Z');
  const older = new Date('2026-10-05T01:00:00.000Z');
  const original = {
    demand: config.cohortDemandPolicy,
    envelope: config.simulationResourcePolicy,
    allocation: config.simulationAllocationPolicy,
    utility: config.allocationUtilityPolicy,
  };
  let afterMiddlewareRead: (() => Promise<void>) | undefined;
  let afterAuthorizationRead: (() => Promise<void>) | undefined;
  let afterPageRead: (() => Promise<void>) | undefined;
  let pageTake: number | undefined;
  let participantTake: number | undefined;
  let historyReads = 0;
  const clearHooks = () => {
    afterMiddlewareRead = undefined;
    afterAuthorizationRead = undefined;
    afterPageRead = undefined;
    pageTake = undefined;
    participantTake = undefined;
    historyReads = 0;
  };
  const get = (query: Record<string, unknown> = scope(), actorId = actors[0]) =>
    request(app)
      .get('/api/admin/semester-allocation-jobs')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(actorId)}`)
      .query(query);
  const insert = (index: number, createdAt = queuedAt, scenario = scope()) =>
    prisma.simulationSemesterAllocationJob.create({
      data: {
        id: jobId(index),
        ...scenario,
        createdAt,
        createdById: actors[1],
        requestId: randomUUID(),
      },
    });
  const insertMany = (count: number, start = 1, createdAt = queuedAt) =>
    prisma.simulationSemesterAllocationJob.createMany({
      data: Array.from({ length: count }, (_, offset) => ({
        id: jobId(start + offset),
        ...scope(),
        createdAt,
        createdById: actors[1],
        requestId: randomUUID(),
      })),
    });
  const fail = (job: SimulationSemesterAllocationJob) =>
    prisma.simulationSemesterAllocationExecution.create({
      data: {
        jobId: job.id,
        status: 'FAILED',
        failureCode: 'PREVIEW_UNAVAILABLE',
        completedAt: new Date(job.createdAt.getTime() + 1000),
      },
    });
  const succeed = async (
    job: SimulationSemesterAllocationJob,
    corruption: 'none' | 'result' | 'participants' | 'orphan' = 'none',
  ) => {
    const { result } = await preview.produceSemesterAllocationPreview(actors[1], scope());
    const capturedAt = new Date(Math.max(Date.now(), job.createdAt.getTime()));
    // Initially inserted UUID fixtures obey all immutable metadata/provenance SQL gates.
    const run = await prisma.simulationSemesterRun.create({
      data: {
        curriculumId: job.curriculumId,
        semester: job.semester,
        year: job.year,
        jobId: job.id,
        createdById: job.createdById,
        requestId: randomUUID(),
        formatVersion: 1,
        capturedAt,
        createdAt: capturedAt,
        result: (corruption === 'result' ? {} : result) as unknown as Prisma.InputJsonValue,
      },
    });
    const students = corruption === 'participants' ? result.students.slice(1) : result.students;
    if (students.length)
      await prisma.simulationSemesterParticipant.createMany({
        data: students.map((student) => ({
          runId: run.id,
          capturedStudentId: student.studentId,
          userId: student.studentId,
          result: student as unknown as Prisma.InputJsonValue,
        })),
      });
    if (corruption !== 'orphan')
      await prisma.simulationSemesterAllocationExecution.create({
        data: {
          jobId: job.id,
          status: 'SUCCEEDED',
          runId: run.id,
          completedAt: new Date(Math.max(Date.now(), capturedAt.getTime())),
        },
      });
    return run;
  };
  const clean = async () => {
    await prisma.simulationSemesterAllocationExecution.deleteMany({
      where: { job: { curriculumId: { in: contexts } } },
    });
    await prisma.simulationSemesterParticipant.deleteMany({
      where: { run: { curriculumId: { in: contexts } } },
    });
    await prisma.simulationSemesterRun.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.simulationSemesterAllocationJob.deleteMany({
      where: { curriculumId: { in: contexts } },
    });
    await prisma.simulationAllocationJob.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.user.deleteMany({ where: { id: { in: actors } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
  };
  const evidence = async () => ({
    users: await prisma.user.findMany({ where: { id: { in: actors } }, orderBy: { id: 'asc' } }),
    contexts: await prisma.curriculum.findMany({
      where: { id: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    courses: await prisma.course.findMany({
      where: { id: { in: courses } },
      orderBy: { id: 'asc' },
    }),
    members: await prisma.curriculumCourse.findMany({
      where: { curriculumId: { in: contexts } },
      include: { placements: true },
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
    jobs: await prisma.simulationSemesterAllocationJob.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    runs: await prisma.simulationSemesterRun.findMany({
      where: { curriculumId: { in: contexts } },
      include: { participants: true },
      orderBy: { id: 'asc' },
    }),
    executions: await prisma.simulationSemesterAllocationExecution.findMany({
      where: { job: { curriculumId: { in: contexts } } },
      orderBy: { jobId: 'asc' },
    }),
    oldJobs: await prisma.simulationAllocationJob.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
  });
  const verifiedPage = async (query: Record<string, unknown> = scope()) => {
    const response = await get(query);
    expect(response.status).toBe(200);
    return SemesterAllocationJobHistorySchema.parse(response.body.data);
  };
  const failsClosed = async (query: Record<string, unknown> = scope()) => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const before = await evidence();
    const response = await get(query);
    expect(response.status).toBe(500);
    expect(response.body).not.toHaveProperty('data');
    for (const id of actors) expect(JSON.stringify(response.body)).not.toContain(id);
    expect(JSON.stringify(response.body)).not.toContain('Private');
    expect(await evidence()).toEqual(before);
  };

  beforeAll(() => {
    // Query hooks observe real PostgreSQL results; no query/transaction is substituted.
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (
        params.model === 'User' &&
        params.action === 'findUnique' &&
        params.args?.where?.id === actors[0] &&
        !params.runInTransaction &&
        afterMiddlewareRead
      ) {
        const writer = afterMiddlewareRead;
        afterMiddlewareRead = undefined;
        await writer();
      }
      if (
        params.action === 'queryRaw' &&
        params.runInTransaction &&
        afterAuthorizationRead &&
        Array.isArray(result) &&
        result.length === 1 &&
        typeof result[0] === 'object' &&
        result[0] !== null &&
        'role' in result[0] &&
        result[0].role === 'ADMIN'
      ) {
        const writer = afterAuthorizationRead;
        afterAuthorizationRead = undefined;
        await writer();
      }
      if (params.model === 'SimulationSemesterAllocationJob' && params.runInTransaction) {
        if (params.action === 'findMany' && params.args?.where?.curriculumId === contexts[0]) {
          historyReads++;
          pageTake = params.args.take;
          participantTake =
            params.args.include?.execution?.include?.run?.include?.participants?.take;
          if (afterPageRead) {
            const writer = afterPageRead;
            afterPageRead = undefined;
            await writer();
          }
        } else if (
          params.action === 'findUnique' &&
          typeof params.args?.where?.id === 'string' &&
          params.args.where.id.startsWith(jobPrefix)
        )
          historyReads++;
      }
      return result;
    });
  });
  beforeEach(async () => {
    clearHooks();
    config.cohortDemandPolicy = Object.freeze({ maxCredits: 6, maxDifficulty: 5 });
    config.simulationResourcePolicy = Object.freeze({
      ...original.envelope,
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
        name: 'Semester history reference',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/semester-history',
        isGpaPath: false,
      })),
    });
    await prisma.user.createMany({
      data: actors.map((id, index) => ({
        id,
        studentId: `${prefix}-actor-${index}`,
        email: `${id}@example.test`,
        name: `Private history actor ${index}`,
        passwordHash: 'Private history unused hash',
        role: index < 2 ? 'ADMIN' : 'STUDENT',
        curriculumId: contexts[0],
      })),
    });
    for (const [index, id] of courses.entries()) {
      await prisma.course.create({
        data: {
          id,
          code: `${prefix}-course-${index}`,
          name: 'History reference course',
          credits: 3,
          difficultyLevel: 2,
          semesterOffered: [],
        },
      });
      await prisma.curriculumCourse.create({
        data: {
          courseId: id,
          curriculumId: contexts[0],
          placements: { create: { academicYear: 1, academicSemester: 1, sourceOrder: index } },
        },
      });
    }
    await prisma.studentRecord.createMany({
      data: actors.slice(2).flatMap((userId) =>
        courses.map((courseId) => ({
          userId,
          courseId,
          status: 'PLANNED' as const,
          grade: 'Private legacy history grade',
          gradePoints: 3.5,
        })),
      ),
    });
    await prisma.gradeAttempt.createMany({
      data: [56, 89].map((score) => ({
        userId: actors[2],
        courseId: courses[0],
        score,
        requestId: randomUUID(),
      })),
    });
    await prisma.studyPlan.create({
      data: {
        userId: actors[2],
        name: 'Private prior history plan',
        semesters: {
          create: {
            semester: 'FALL',
            year: 2001,
            courses: [{ courseId: courses[0] }],
            totalCredits: 3,
          },
        },
      },
    });
    await prisma.schoolResource.create({
      data: {
        ...scope(),
        professors: 2,
        classrooms: 2,
        maxStudentsPerSection: 2,
        updatedBy: actors[1],
        revision: 1,
      },
    });
  });
  afterEach(async () => {
    clearHooks();
    jest.restoreAllMocks();
    await clean();
  });
  afterAll(() => {
    config.cohortDemandPolicy = original.demand;
    config.simulationResourcePolicy = original.envelope;
    config.simulationAllocationPolicy = original.allocation;
    config.allocationUtilityPolicy = original.utility;
  });

  it.each([0, 1, 5, 6])(
    'bounds the visible page and continuation for %i requests',
    async (count) => {
      if (count) await insertMany(count);
      const page = await verifiedPage();
      expect(page).toMatchObject({
        kind: 'SIMULATION',
        usage: 'REFERENCE_ONLY',
        model: 'SEMESTER_CREDIT_BUDGET_V1',
        scope: scope(),
        order: 'QUEUED_NEWEST_FIRST',
        pageSize: 5,
        after: null,
      });
      expect(page.requests.map(({ job }) => job.id)).toEqual(
        Array.from({ length: Math.min(count, 5) }, (_, offset) => jobId(count - offset)),
      );
      expect(page.nextAfter).toBe(count > 5 ? jobId(2) : null);
      expect(pageTake).toBe(6);
      expect(participantTake).toBe(501);
    },
  );

  it('paginates enqueue timestamp ties once and echoes the exact excluded boundary', async () => {
    await insertMany(7);
    const first = await verifiedPage();
    const second = await verifiedPage({ ...scope(), after: first.nextAfter });
    expect(first.nextAfter).toBe(jobId(3));
    expect(second.after).toBe(jobId(3));
    expect(second.nextAfter).toBeNull();
    expect([...first.requests, ...second.requests].map(({ job }) => job.id)).toEqual(
      Array.from({ length: 7 }, (_, offset) => jobId(7 - offset)),
    );
  });

  it('orders by enqueue time before ID and keeps older pages stable after a newest insertion', async () => {
    await insertMany(2, 20, older);
    await insertMany(4, 1);
    const first = await verifiedPage();
    expect(first.requests.map(({ job }) => job.id)).toEqual([
      jobId(4),
      jobId(3),
      jobId(2),
      jobId(1),
      jobId(21),
    ]);
    await insert(30, new Date(queuedAt.getTime() + 1000));
    const second = await verifiedPage({ ...scope(), after: first.nextAfter });
    expect(second.requests.map(({ job }) => job.id)).toEqual([jobId(20)]);
    expect(second.nextAfter).toBeNull();
    expect((await verifiedPage()).requests[0].job.id).toBe(jobId(30));
  });

  it('returns original receipts and coherent mixed current outcomes without private data or any source writes', async () => {
    const pending = await insert(1);
    const successful = await insert(2);
    const failed = await insert(3);
    const execution = await runOneSemesterAllocationJob(successful.id);
    expect(execution.processed).toBe(true);
    if (execution.outcome?.status !== 'SUCCEEDED' || execution.outcome.runId === null)
      throw new Error('The valid history fixture did not execute');
    await fail(failed);
    const before = await evidence();
    const producer = jest.spyOn(preview, 'produceSemesterAllocationPreview');
    const page = await verifiedPage();
    expect(
      page.requests.map(({ job, outcome }) => ({
        id: job.id,
        status: outcome.status,
        runId: outcome.runId,
      })),
    ).toEqual([
      { id: failed.id, status: 'FAILED', runId: null },
      { id: successful.id, status: 'SUCCEEDED', runId: execution.outcome.runId },
      { id: pending.id, status: 'PENDING', runId: null },
    ]);
    for (const { job, outcome } of page.requests) {
      expect(job.status).toBe('QUEUED');
      expect(job.inputsCaptured).toBe(false);
      expect(outcome.jobId).toBe(job.id);
      expect(outcome.queuedAt).toBe(job.queuedAt);
    }
    expect(producer).not.toHaveBeenCalled();
    expect(await evidence()).toEqual(before);
    const serialized = JSON.stringify(page);
    for (const id of actors) expect(serialized).not.toContain(id);
    for (const row of [...before.jobs, ...before.runs])
      expect(serialized).not.toContain(row.requestId);
    for (const value of [
      'Private',
      'createdById',
      'requestId',
      'participants',
      '"students":',
      '"result":',
      'passwordHash',
      'gradePoints',
    ])
      expect(serialized).not.toContain(value);
  });

  it('normalizes the current actor, scope and exact cursor UUID without relaxing identity checks', async () => {
    await insertMany(2);
    const input = {
      ...scope(),
      curriculumId: contexts[0].toUpperCase(),
      after: jobId(2).toUpperCase(),
    };
    const page = await verifiedPage(input);
    expect(page.after).toBe(jobId(2));
    expect(page.scope).toEqual(scope());
    expect(page.requests.map(({ job }) => job.id)).toEqual([jobId(1)]);
    expect(await listSemesterAllocationJobs(actors[0].toUpperCase(), input)).toEqual(page);
  });

  it('isolates all curriculum, semester and year scenarios', async () => {
    await insert(1);
    for (const [offset, scenario] of [
      scope(contexts[1]),
      scope(contexts[0], 'SPRING'),
      scope(contexts[0], 'FALL', 2027),
    ].entries()) {
      await insert(offset + 2, queuedAt, scenario);
      expect((await verifiedPage(scenario)).requests.map(({ job }) => job.id)).toEqual([
        jobId(offset + 2),
      ]);
    }
    expect((await verifiedPage()).requests.map(({ job }) => job.id)).toEqual([jobId(1)]);
  });

  it('reports outcome changes while leaving enqueue ordering and continuation immutable', async () => {
    await insertMany(6);
    const first = await verifiedPage();
    const cursor = await prisma.simulationSemesterAllocationJob.findUniqueOrThrow({
      where: { id: first.nextAfter! },
    });
    const oldest = await prisma.simulationSemesterAllocationJob.findUniqueOrThrow({
      where: { id: jobId(1) },
    });
    await succeed(cursor);
    await fail(oldest);
    const second = await verifiedPage({ ...scope(), after: first.nextAfter });
    expect(
      second.requests.map(({ job, outcome }) => ({ id: job.id, status: outcome.status })),
    ).toEqual([{ id: jobId(1), status: 'FAILED' }]);
    const refreshed = await verifiedPage();
    expect(refreshed.nextAfter).toBe(first.nextAfter);
    expect(refreshed.requests.at(-1)?.outcome.status).toBe('SUCCEEDED');
    expect(first.requests.at(-1)?.outcome.status).toBe('PENDING');
  });

  it('captures one repeatable snapshot beginning at the real role SELECT before independent enqueue/terminal commits', async () => {
    const existing = await insert(1);
    let writes = 0;
    afterAuthorizationRead = async () => {
      await insert(2);
      const completed = await runOneSemesterAllocationJob(existing.id);
      expect(completed).toMatchObject({ processed: true, outcome: { status: 'SUCCEEDED' } });
      writes++;
    };
    const during = await verifiedPage();
    expect(writes).toBe(1);
    expect(
      during.requests.map(({ job, outcome }) => ({ id: job.id, status: outcome.status })),
    ).toEqual([{ id: jobId(1), status: 'PENDING' }]);
    const latest = await verifiedPage();
    expect(
      latest.requests.map(({ job, outcome }) => ({ id: job.id, status: outcome.status })),
    ).toEqual([
      { id: jobId(2), status: 'PENDING' },
      { id: jobId(1), status: 'SUCCEEDED' },
    ]);
    expect(latest.requests[1].outcome.runId).not.toBeNull();
  });

  it('uses pinned private history after original-author deletion and invalid live deployment policies', async () => {
    const job = await insert(1);
    const run = await succeed(job);
    const expected = await verifiedPage();
    await prisma.user.delete({ where: { id: actors[1] } });
    config.allocationUtilityPolicy = { difficultyFitWeight: NaN, immediateUnlockWeight: 0 };
    config.cohortDemandPolicy = { maxCredits: -1, maxDifficulty: -1 };
    await prisma.schoolResource.update({
      where: { curriculumId_semester_year: scope() },
      data: { professors: 0, revision: 2 },
    });
    const before = await evidence();
    const producer = jest.spyOn(preview, 'produceSemesterAllocationPreview');
    expect(await verifiedPage()).toEqual(expected);
    expect(producer).not.toHaveBeenCalled();
    expect(await evidence()).toEqual(before);
    expect(
      (await prisma.simulationSemesterRun.findUniqueOrThrow({ where: { id: run.id } })).createdById,
    ).toBeNull();
  });

  it('requires current ADMIN before context and cursor reads for route and direct service calls', async () => {
    expect(
      (await request(app).get('/api/admin/semester-allocation-jobs').query(scope())).status,
    ).toBe(401);
    expect((await get(scope(), actors[2])).status).toBe(403);
    expect((await get(scope(), randomUUID())).status).toBe(401);
    await expect(
      listSemesterAllocationJobs(actors[2], { ...scope(randomUUID()), after: randomUUID() }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(listSemesterAllocationJobs(randomUUID(), scope())).rejects.toMatchObject({
      status: 401,
    });
    expect(historyReads).toBe(0);
  });

  it('rejects a demotion committed after middleware authorization without reading request history', async () => {
    await insert(1);
    afterMiddlewareRead = async () => {
      await prisma.user.update({ where: { id: actors[0] }, data: { role: 'STUDENT' } });
    };
    expect((await get()).status).toBe(403);
    expect(historyReads).toBe(0);
  });

  it('retries a real role SELECT blocked behind uncommitted demotion before rejecting the history read', async () => {
    await insert(1);
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalReady: (pid: number) => void = () => undefined;
    let failReady: (failure: unknown) => void = () => undefined;
    const ready = new Promise<number>((resolve, reject) => {
      signalReady = resolve;
      failReady = reject;
    });
    let writerFailure: unknown;
    const writer = prisma
      .$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          await tx.user.update({ where: { id: actors[0] }, data: { role: 'STUDENT' } });
          signalReady(row.pid);
          await released;
        },
        { maxWait: 3000, timeout: 10000 },
      )
      .then(
        () => undefined,
        (failure: unknown) => {
          writerFailure = failure;
          failReady(failure);
        },
      );
    let responseStatus: number | undefined;
    let requestFailure: unknown;
    let submission: Promise<void> | undefined;
    try {
      const writerPid = await ready;
      submission = get().then(
        (response) => {
          responseStatus = response.status;
        },
        (failure: unknown) => {
          requestFailure = failure;
        },
      );
      let blocked = false;
      for (let attempt = 0; attempt < 40 && !blocked; attempt++) {
        const waiting = await prisma.$queryRaw<
          { wait: string | null; blockers: number[] }[]
        >`SELECT wait_event_type AS wait, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid <> ${writerPid} AND ${writerPid} = ANY(pg_blocking_pids(pid)) AND query LIKE '%users%' AND query LIKE '%FOR SHARE%'`;
        blocked = waiting.some((row) => row.wait === 'Lock' && row.blockers.includes(writerPid));
        if (!blocked) await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      expect(blocked).toBe(true);
    } finally {
      release();
      await writer;
      if (submission) await submission;
    }
    if (writerFailure) throw writerFailure;
    if (requestFailure) throw requestFailure;
    expect(responseStatus).toBe(403);
    expect(historyReads).toBe(0);
    await prisma.user.update({ where: { id: actors[0] }, data: { role: 'ADMIN' } });
    expect((await verifiedPage()).requests).toHaveLength(1);
  });

  it('holds the acting role through read commit while a real demotion waits', async () => {
    await insert(1);
    let writer: Promise<void> | undefined;
    let writerFailure: unknown;
    let committed = false;
    afterPageRead = async () => {
      let signalPid: (pid: number) => void = () => undefined;
      let failPid: (failure: unknown) => void = () => undefined;
      const ready = new Promise<number>((resolve, reject) => {
        signalPid = resolve;
        failPid = reject;
      });
      writer = prisma
        .$transaction(
          async (tx) => {
            const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
            signalPid(row.pid);
            await tx.user.update({ where: { id: actors[0] }, data: { role: 'STUDENT' } });
          },
          { maxWait: 3000, timeout: 10000 },
        )
        .then(
          () => {
            committed = true;
          },
          (failure: unknown) => {
            writerFailure = failure;
            failPid(failure);
          },
        );
      const pid = await ready;
      let blocked = false;
      for (let attempt = 0; attempt < 40 && !blocked; attempt++) {
        const [row] = await prisma.$queryRaw<
          { wait: string | null; blockers: number[] }[]
        >`SELECT wait_event_type AS wait, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid = ${pid}`;
        blocked = row?.wait === 'Lock' && row.blockers.length > 0;
        if (!blocked) await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      expect(blocked).toBe(true);
      expect(committed).toBe(false);
    };
    try {
      expect((await verifiedPage()).requests).toHaveLength(1);
    } finally {
      afterPageRead = undefined;
      if (writer) await writer;
    }
    if (writerFailure) throw writerFailure;
    expect(committed).toBe(true);
    expect((await get()).status).toBe(403);
  });

  it('rejects malformed/expanded queries and bodies before history reads', async () => {
    for (const fields of [
      { after: '' },
      { after: `${jobId(1)}\n` },
      { curriculumId: `${contexts[0]}\n` },
      { year: '02026' },
      { year: '2e3' },
      { year: '2026\n' },
      { year: ['2026', '2027'] },
      { semester: 'WINTER' },
      { pageSize: 6 },
      { status: 'FAILED' },
      { ownerId: actors[0] },
      { model: 'SEMESTER_CREDIT_BUDGET_V1' },
    ])
      expect((await get({ ...scope(), ...fields })).status).toBe(400);
    expect((await get().send({ after: jobId(1) })).status).toBe(400);
    expect((await get({ semester: 'FALL', year: 2026 })).status).toBe(400);
    expect(historyReads).toBe(0);
  });

  it('reports absent curriculum before resolving an arbitrary cursor', async () => {
    expect((await get({ ...scope(randomUUID()), after: randomUUID() })).status).toBe(404);
    expect(historyReads).toBe(0);
  });

  it('uses one uniform reload conflict for missing, foreign-scenario, older-queue and deleted cursors', async () => {
    const valid = await insert(1);
    const old = (
      await enqueueAllocationJob(actors[1], {
        ...scope(),
        expectedActorId: actors[1],
        requestId: randomUUID(),
      })
    ).job;
    const failures = [];
    for (const query of [
      { ...scope(), after: randomUUID() },
      { ...scope(contexts[1]), after: valid.id },
      { ...scope(contexts[0], 'SPRING'), after: valid.id },
      { ...scope(contexts[0], 'FALL', 2027), after: valid.id },
      { ...scope(), after: old.id },
    ]) {
      const response = await get(query);
      expect(response.status).toBe(409);
      expect(response.body).not.toHaveProperty('data');
      failures.push(response.body);
    }
    await prisma.simulationSemesterAllocationJob.delete({ where: { id: valid.id } });
    const deleted = await get({ ...scope(), after: valid.id });
    expect(deleted.status).toBe(409);
    for (const failure of failures) expect(deleted.body).toEqual(failure);
  });

  it('rejects corrupt private results in displayed rows without publishing a partial page', async () => {
    await insert(1);
    await succeed(await insert(2), 'result');
    await failsClosed();
  });

  it('verifies a corrupt exact cursor even when no older results would be displayed', async () => {
    const cursor = await insert(1);
    await succeed(cursor, 'result');
    await failsClosed({ ...scope(), after: cursor.id });
  });

  it('verifies the sixth lookahead private result instead of silently truncating past corruption', async () => {
    await insertMany(5, 2);
    await succeed(await insert(1), 'result');
    await failsClosed();
  });

  it('rejects a linked orphan capture rather than reporting a false pending history item', async () => {
    await succeed(await insert(1), 'orphan');
    await failsClosed();
  });

  it('verifies every stored participant before exposing aggregate terminal history', async () => {
    await succeed(await insert(1), 'participants');
    await failsClosed();
  });
});
