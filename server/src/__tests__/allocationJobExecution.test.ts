import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { AllocationJobOutcomeSchema, AllocationRunV1Schema } from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import config from '../config';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { enqueueAllocationJob, readAllocationJob } from '../services/allocationJobs';
import { readAllocationJobOutcome, runOneAllocationJob } from '../services/allocationJobExecution';
import { readAllocationPreview } from '../services/allocationPreview';
import { projectAllocationRunSummary } from '../services/allocationRunProjection';
import { readAllocationRun } from '../services/allocationRuns';
import * as allocationUtility from '../services/allocationUtility';

describe('atomic explicit simulation job execution (PostgreSQL)', () => {
  const prefix = `atomic-job-${randomUUID()}`;
  const actors = Array.from({ length: 4 }, () => randomUUID());
  const contexts = Array.from({ length: 2 }, () => randomUUID());
  const courses = Array.from({ length: 2 }, () => randomUUID());
  const members = Array.from({ length: 2 }, () => randomUUID());
  const scope = () => ({ curriculumId: contexts[0], semester: 'FALL' as const, year: 2026 });
  const originalPolicies = {
    demand: config.cohortDemandPolicy,
    envelope: config.simulationResourcePolicy,
    allocation: config.simulationAllocationPolicy,
    utility: config.allocationUtilityPolicy,
  };
  let afterCount: (() => Promise<void>) | undefined;
  let afterRunCreate: (() => Promise<void>) | undefined;
  let afterExecutionCreate: (() => Promise<void>) | undefined;
  let afterMiddlewareRead: (() => Promise<void>) | undefined;
  let sourceHistoryReads = 0;

  const restorePolicies = () => {
    config.cohortDemandPolicy = Object.freeze({ maxCredits: 18, maxDifficulty: 5 });
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
    afterCount = undefined;
    afterRunCreate = undefined;
    afterExecutionCreate = undefined;
    afterMiddlewareRead = undefined;
    sourceHistoryReads = 0;
  };
  const clean = async () => {
    await prisma.simulationAllocationExecution.deleteMany({
      where: { job: { curriculumId: { in: contexts } } },
    });
    await prisma.simulationAllocationRun.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.simulationAllocationJob.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.user.deleteMany({ where: { studentId: { startsWith: prefix } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
  };
  const queue = async (actorId = actors[0]) =>
    (
      await enqueueAllocationJob(actorId, {
        ...scope(),
        requestId: randomUUID(),
        expectedActorId: actorId,
      })
    ).job;
  const get = (id: string, actorId = actors[0]) =>
    request(app)
      .get(`/api/admin/allocation-jobs/${id}/outcome`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(actorId)}`);
  const counts = async () => ({
    executions: await prisma.simulationAllocationExecution.count({
      where: { job: { curriculumId: { in: contexts } } },
    }),
    runs: await prisma.simulationAllocationRun.count({ where: { curriculumId: { in: contexts } } }),
  });
  const evidence = async () => ({
    users: await prisma.user.findMany({
      where: { studentId: { startsWith: prefix } },
      orderBy: { id: 'asc' },
    }),
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
      orderBy: { id: 'asc' },
    }),
    placements: await prisma.curriculumPlacement.findMany({
      where: { curriculumCourse: { curriculumId: { in: contexts } } },
      orderBy: { id: 'asc' },
    }),
    prerequisites: await prisma.curriculumPrerequisite.findMany({
      where: { curriculumId: { in: contexts } },
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
    ratings: await prisma.courseRating.findMany({
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
  });
  const execute = async (id: string) => {
    const result = await runOneAllocationJob(id);
    if (!result.processed) throw new Error('Fixture job was not processed');
    return AllocationJobOutcomeSchema.parse(result.outcome);
  };
  const savedRun = async (id: string) => {
    const result = await execute(id);
    if (result.status !== 'SUCCEEDED' || result.runId === null)
      throw new Error('Fixture job did not succeed');
    return {
      outcome: result,
      run: AllocationRunV1Schema.parse(await readAllocationRun(actors[1], result.runId)),
    };
  };
  const addStudents = async (count: number) => {
    await prisma.user.createMany({
      data: Array.from({ length: count }, (_, index) => {
        const id = randomUUID();
        return {
          id,
          studentId: `${prefix}-extra-${index}`,
          email: `${id}@example.test`,
          name: 'Private extra simulated student',
          role: 'STUDENT' as const,
          curriculumId: contexts[0],
        };
      }),
    });
  };

  beforeAll(() => {
    // Hooks observe or fail after actual PostgreSQL operations. No query/transaction is mocked.
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (
        params.runInTransaction &&
        params.action === 'findMany' &&
        (params.model === 'StudentRecord' || params.model === 'GradeAttempt')
      )
        sourceHistoryReads++;
      if (
        params.model === 'User' &&
        params.action === 'count' &&
        params.runInTransaction &&
        params.args?.where?.curriculumId === contexts[0] &&
        afterCount
      ) {
        const hook = afterCount;
        afterCount = undefined;
        await hook();
      }
      if (
        params.model === 'SimulationAllocationRun' &&
        params.action === 'create' &&
        params.args?.data?.curriculumId === contexts[0] &&
        afterRunCreate
      ) {
        const hook = afterRunCreate;
        afterRunCreate = undefined;
        await hook();
      }
      if (
        params.model === 'SimulationAllocationExecution' &&
        params.action === 'create' &&
        afterExecutionCreate
      ) {
        const hook = afterExecutionCreate;
        afterExecutionCreate = undefined;
        await hook();
      }
      if (
        params.model === 'User' &&
        params.action === 'findUnique' &&
        params.args?.where?.id === actors[0] &&
        !params.runInTransaction &&
        afterMiddlewareRead
      ) {
        const hook = afterMiddlewareRead;
        afterMiddlewareRead = undefined;
        await hook();
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
        name: 'Atomic simulation reference',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/atomic-worker',
      })),
    });
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-course-${index}`,
        name: `Atomic course ${index}`,
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
    await prisma.curriculumPrerequisite.create({
      data: {
        curriculumId: contexts[0],
        courseId: courses[1],
        prerequisiteId: courses[0],
        isStrict: false,
        isCorequisite: true,
      },
    });
    await prisma.user.createMany({
      data: actors.map((id, index) => ({
        id,
        studentId: `${prefix}-actor-${index}`,
        email: `${id}@example.test`,
        name: `Private atomic actor ${index}`,
        passwordHash: 'Private test hash',
        role: index < 2 ? 'ADMIN' : 'STUDENT',
        curriculumId: contexts[0],
      })),
    });
    await prisma.studentRecord.createMany({
      data: [
        {
          userId: actors[2],
          courseId: courses[0],
          status: 'COMPLETED',
          grade: 'Legacy private A',
          gradePoints: 4,
        },
        { userId: actors[2], courseId: courses[1], status: 'PLANNED' },
        { userId: actors[3], courseId: courses[1], status: 'PLANNED' },
      ],
    });
    await prisma.gradeAttempt.createMany({
      data: [88, 52].map((score) => ({
        userId: actors[2],
        courseId: courses[0],
        requestId: randomUUID(),
        score,
      })),
    });
    await prisma.courseRating.create({
      data: { userId: actors[2], courseId: courses[0], rating: 4 },
    });
    await prisma.studyPlan.create({
      data: {
        userId: actors[2],
        name: 'Private historical study plan',
        semesters: {
          create: {
            semester: 'SPRING',
            year: 2001,
            courses: [{ courseId: courses[1], position: 0 }],
            totalCredits: 3,
            difficultyScore: 2,
          },
        },
      },
    });
    await prisma.schoolResource.create({
      data: {
        ...scope(),
        professors: 2,
        classrooms: 2,
        labRooms: 1,
        maxStudentsPerSection: 40,
        revision: 1,
        updatedBy: actors[0],
      },
    });
  });
  afterEach(async () => {
    clearHooks();
    restorePolicies();
    jest.restoreAllMocks();
    await clean();
  });
  afterAll(() => {
    config.cohortDemandPolicy = originalPolicies.demand;
    config.simulationResourcePolicy = originalPolicies.envelope;
    config.simulationAllocationPolicy = originalPolicies.allocation;
    config.allocationUtilityPolicy = originalPolicies.utility;
  });

  it('atomically saves the live preview summary and terminal outcome without academic/resource writes', async () => {
    const job = await queue();
    const before = await evidence();
    const expected = projectAllocationRunSummary(await readAllocationPreview(actors[0], scope()));
    const { outcome, run } = await savedRun(job.id.toUpperCase());
    expect(outcome).toMatchObject({ jobId: job.id, status: 'SUCCEEDED', runId: run.id });
    expect(run.result).toEqual(expected);
    expect(run.result.assignedStudentCount).toBe(2);
    expect(run.result.courses.find(({ id }) => id === courses[1])?.demandStudentCount).toBe(1);
    expect(await evidence()).toEqual(before);
    expect(await counts()).toEqual({ executions: 1, runs: 1 });
    expect(await readAllocationJob(actors[0], job.id)).toEqual(job);
    expect((await get(job.id, actors[1])).body.data).toEqual(outcome);
    const row = await prisma.simulationAllocationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(row.jobId).toBe(job.id);
    expect(row.requestId).not.toBe(job.id);
    expect(row.requestId).not.toBe(
      (await prisma.simulationAllocationJob.findUniqueOrThrow({ where: { id: job.id } })).requestId,
    );
    const serialized = JSON.stringify({ outcome, run });
    for (const actor of actors) expect(serialized).not.toContain(actor);
    expect(serialized).not.toContain(row.requestId);
    expect(serialized).not.toContain('Legacy private');
    expect(serialized).not.toContain('Private test hash');
    expect(serialized).not.toContain('score');
  });

  it('captures saved resources and current policies when explicitly executed, after enqueue', async () => {
    const job = await queue();
    await prisma.schoolResource.update({
      where: { curriculumId_semester_year: scope() },
      data: { professors: 0, revision: 2 },
    });
    config.allocationUtilityPolicy = Object.freeze({
      difficultyFitWeight: 0.5,
      immediateUnlockWeight: 0.5,
    });
    const expected = projectAllocationRunSummary(await readAllocationPreview(actors[0], scope()));
    const { run } = await savedRun(job.id);
    expect(run.result).toEqual(expected);
    expect(run.result).toMatchObject({
      assignedStudentCount: 0,
      capacityExhaustedStudentCount: 2,
      resources: { resourceRevision: 2, professors: 0 },
      utilityPolicy: { difficultyFitWeight: 0.5, immediateUnlockWeight: 0.5 },
    });
  });

  it('keeps inputs coherent when a committed writer changes resources/history after the first real COUNT', async () => {
    const job = await queue();
    const expected = projectAllocationRunSummary(await readAllocationPreview(actors[0], scope()));
    let writes = 0;
    afterCount = async () => {
      await prisma.$transaction(async (tx) => {
        await tx.schoolResource.update({
          where: { curriculumId_semester_year: scope() },
          data: { professors: 0, revision: 2 },
        });
        await tx.studentRecord.update({
          where: { userId_courseId: { userId: actors[2], courseId: courses[1] } },
          data: { status: 'COMPLETED' },
        });
        await tx.gradeAttempt.create({
          data: { userId: actors[2], courseId: courses[1], requestId: randomUUID(), score: 95 },
        });
      });
      writes++;
    };
    const { run } = await savedRun(job.id);
    expect(writes).toBe(1);
    expect(run.result).toEqual(expected);
    expect(run.result.resources?.resourceRevision).toBe(1);
    expect(
      projectAllocationRunSummary(await readAllocationPreview(actors[0], scope())),
    ).not.toEqual(expected);
  });

  it('converges concurrent workers for the same ID on exactly one run/outcome', async () => {
    const job = await queue();
    const replies = await Promise.all([runOneAllocationJob(job.id), runOneAllocationJob(job.id)]);
    expect(replies.filter(({ processed }) => processed)).toHaveLength(1);
    expect(await counts()).toEqual({ executions: 1, runs: 1 });
    const outcome = await readAllocationJobOutcome(actors[1], job.id);
    expect(outcome.status).toBe('SUCCEEDED');
    expect(await runOneAllocationJob(job.id)).toEqual({ processed: false });
  });

  it('processes two independently selected IDs concurrently without sharing a run', async () => {
    const jobs = await Promise.all([queue(), queue(actors[1])]);
    const replies = await Promise.all(jobs.map(({ id }) => execute(id)));
    expect(replies.map(({ status }) => status)).toEqual(['SUCCEEDED', 'SUCCEEDED']);
    expect(new Set(replies.map(({ runId }) => runId)).size).toBe(2);
    expect(await counts()).toEqual({ executions: 2, runs: 2 });
  });

  it('skips an actively locked selected job and reports PENDING without blocking', async () => {
    const job = await queue();
    let release: () => void = () => undefined;
    let locked: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM simulation_allocation_jobs WHERE id = ${job.id} FOR UPDATE`;
        locked();
        await released;
      },
      { timeout: 10_000 },
    );
    try {
      await ready;
      expect(await runOneAllocationJob(job.id)).toEqual({ processed: false });
      expect((await readAllocationJobOutcome(actors[1], job.id)).status).toBe('PENDING');
      expect(await counts()).toEqual({ executions: 0, runs: 0 });
    } finally {
      release();
      await holder;
    }
    expect((await execute(job.id)).status).toBe('SUCCEEDED');
  });

  it.each(['run', 'execution'] as const)(
    'rolls back an unknown error after actual %s CREATE, then safely executes once on retry',
    async (stage) => {
      const job = await queue();
      const before = await evidence();
      const fail = async () => {
        throw new Error('Injected private infrastructure failure after real database write');
      };
      if (stage === 'run') afterRunCreate = fail;
      else afterExecutionCreate = fail;
      await expect(runOneAllocationJob(job.id)).rejects.toThrow('infrastructure failure');
      expect(await counts()).toEqual({ executions: 0, runs: 0 });
      expect((await readAllocationJobOutcome(actors[1], job.id)).status).toBe('PENDING');
      expect(await evidence()).toEqual(before);
      expect((await execute(job.id)).status).toBe('SUCCEEDED');
      expect(await counts()).toEqual({ executions: 1, runs: 1 });
    },
  );

  it('rolls back the real 15-second transaction timeout after run insertion and remains safely retryable', async () => {
    const job = await queue();
    afterRunCreate = async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 16_000));
    };
    await expect(runOneAllocationJob(job.id)).rejects.toMatchObject({ code: 'P2028' });
    expect(await counts()).toEqual({ executions: 0, runs: 0 });
    expect((await readAllocationJobOutcome(actors[1], job.id)).status).toBe('PENDING');
    expect((await execute(job.id)).status).toBe('SUCCEEDED');
    expect(await counts()).toEqual({ executions: 1, runs: 1 });
  }, 30_000);

  it.each(['demoted', 'deleted'] as const)(
    'records one sanitized author failure when the original admin is %s before execution',
    async (change) => {
      const job = await queue();
      if (change === 'demoted')
        await prisma.user.update({ where: { id: actors[0] }, data: { role: 'STUDENT' } });
      else await prisma.user.delete({ where: { id: actors[0] } });
      const outcome = await execute(job.id);
      expect(outcome).toMatchObject({
        status: 'FAILED',
        runId: null,
        failureCode: 'AUTHOR_UNAVAILABLE',
        completedAt: expect.any(String),
      });
      expect((await get(job.id, actors[1])).body.data).toEqual(outcome);
      expect(await counts()).toEqual({ executions: 1, runs: 0 });
      if (change === 'demoted')
        await prisma.user.update({ where: { id: actors[0] }, data: { role: 'ADMIN' } });
      expect(await runOneAllocationJob(job.id)).toEqual({ processed: false });
      expect(await readAllocationJobOutcome(actors[1], job.id)).toEqual(outcome);
    },
  );

  it('holds the author role stable through commit while a real concurrent demotion waits', async () => {
    const job = await queue();
    let writer: Promise<void> | undefined;
    let committed = false;
    afterCount = async () => {
      let signalPid: (pid: number) => void = () => undefined;
      const pidReady = new Promise<number>((resolve) => {
        signalPid = resolve;
      });
      writer = prisma
        .$transaction(async (tx) => {
          const [connection] = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          signalPid(connection.pid);
          await tx.user.update({ where: { id: actors[0] }, data: { role: 'STUDENT' } });
        })
        .then(() => {
          committed = true;
        });
      const pid = await pidReady;
      let blocked = false;
      for (let attempt = 0; attempt < 20 && !blocked; attempt++) {
        const [activity] = await prisma.$queryRaw<{ wait: string | null; blockers: number[] }[]>`
          SELECT wait_event_type AS wait, pg_blocking_pids(pid) AS blockers
          FROM pg_stat_activity WHERE pid = ${pid}
        `;
        blocked = activity?.wait === 'Lock' && activity.blockers.length > 0;
        if (!blocked) await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      expect(blocked).toBe(true);
      expect(committed).toBe(false);
    };
    try {
      const { run } = await savedRun(job.id);
      expect(run.result.cohortStudentCount).toBe(2);
    } finally {
      if (writer) await writer;
    }
    expect(committed).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actors[0] } })).role).toBe(
      'STUDENT',
    );
    expect((await readAllocationJobOutcome(actors[1], job.id)).status).toBe('SUCCEEDED');
    expect(await counts()).toEqual({ executions: 1, runs: 1 });
  });

  it('preserves a successful aggregate and terminal outcome after creator anonymization', async () => {
    const job = await queue();
    const { run, outcome } = await savedRun(job.id);
    await prisma.user.delete({ where: { id: actors[0] } });
    expect(
      (await prisma.simulationAllocationJob.findUniqueOrThrow({ where: { id: job.id } }))
        .createdById,
    ).toBeNull();
    expect(
      (await prisma.simulationAllocationRun.findUniqueOrThrow({ where: { id: run.id } }))
        .createdById,
    ).toBeNull();
    expect((await get(job.id, actors[1])).body.data).toEqual(outcome);
    expect(await readAllocationRun(actors[1], run.id)).toEqual(run);
    expect(await runOneAllocationJob(job.id)).toEqual({ processed: false });
  });

  it('requires current ADMIN for outcome HTTP/direct reads and accepts no query overrides', async () => {
    const job = await queue();
    const path = `/api/admin/allocation-jobs/${job.id}/outcome`;
    expect((await request(app).get(path)).status).toBe(401);
    expect((await get(job.id, actors[2])).status).toBe(403);
    expect((await get(job.id, randomUUID())).status).toBe(401);
    await expect(readAllocationJobOutcome(actors[2], job.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(readAllocationJobOutcome(randomUUID(), job.id)).rejects.toMatchObject({
      status: 401,
    });
    expect((await get('invalid')).status).toBe(400);
    expect((await get(`${job.id}%0A`)).status).toBe(400);
    expect((await get(job.id).send({ runId: randomUUID() })).status).toBe(400);
    expect((await get(randomUUID())).status).toBe(404);
    for (const overrides of [{ year: 2027 }, { status: 'SUCCEEDED' }, { runId: randomUUID() }])
      expect((await get(job.id).query(overrides)).status).toBe(400);
    expect((await get(job.id.toUpperCase(), actors[1])).body.data).toEqual(
      await readAllocationJobOutcome(actors[1], job.id),
    );
    expect(await counts()).toEqual({ executions: 0, runs: 0 });
  });

  it('rechecks current role after the outcome route middleware read', async () => {
    const job = await queue();
    afterMiddlewareRead = async () => {
      await prisma.user.update({ where: { id: actors[0] }, data: { role: 'STUDENT' } });
    };
    expect((await get(job.id)).status).toBe(403);
    expect(await counts()).toEqual({ executions: 0, runs: 0 });
  });

  it('reads terminal results without recomputing changed or now-invalid live inputs', async () => {
    const job = await queue();
    const { outcome } = await savedRun(job.id);
    await prisma.schoolResource.update({
      where: { curriculumId_semester_year: scope() },
      data: { professors: 0, revision: 2 },
    });
    config.allocationUtilityPolicy = { difficultyFitWeight: 0, immediateUnlockWeight: 0 };
    expect(await readAllocationJobOutcome(actors[1], job.id)).toEqual(outcome);
    expect(await runOneAllocationJob(job.id)).toEqual({ processed: false });
    expect(await counts()).toEqual({ executions: 1, runs: 1 });
  });

  it('leaves PENDING when current policy validation fails, then captures once after correction', async () => {
    const job = await queue();
    config.allocationUtilityPolicy = { difficultyFitWeight: 0, immediateUnlockWeight: 0 };
    await expect(runOneAllocationJob(job.id)).rejects.toThrow('policies could not be verified');
    expect(await counts()).toEqual({ executions: 0, runs: 0 });
    expect((await readAllocationJobOutcome(actors[1], job.id)).status).toBe('PENDING');
    restorePolicies();
    expect((await execute(job.id)).status).toBe('SUCCEEDED');
  });

  it('leaves PENDING for corrupt stored source metadata rather than saving a terminal failure', async () => {
    const job = await queue();
    await prisma.course.update({ where: { id: courses[0] }, data: { credits: -1 } });
    await expect(runOneAllocationJob(job.id)).rejects.toThrow();
    expect(await counts()).toEqual({ executions: 0, runs: 0 });
    expect((await readAllocationJobOutcome(actors[1], job.id)).status).toBe('PENDING');
    await prisma.course.update({ where: { id: courses[0] }, data: { credits: 3 } });
    expect((await execute(job.id)).status).toBe('SUCCEEDED');
  });

  it('rolls back invalid produced roster scores with real source reads and retries after producer repair', async () => {
    const job = await queue();
    const producer = jest
      .spyOn(allocationUtility, 'calculateAllocationStudentUtility')
      .mockReturnValue(Number.NaN);
    try {
      await expect(runOneAllocationJob(job.id)).rejects.toThrow(
        'roster metadata could not be verified',
      );
      expect(producer).toHaveBeenCalled();
      expect(sourceHistoryReads).toBeGreaterThan(0);
      expect(await counts()).toEqual({ executions: 0, runs: 0 });
      expect((await readAllocationJobOutcome(actors[1], job.id)).status).toBe('PENDING');
    } finally {
      producer.mockRestore();
    }
    expect((await execute(job.id)).status).toBe('SUCCEEDED');
  });

  it.each([
    { status: 'SUCCEEDED', run: false, failureCode: null },
    { status: 'SUCCEEDED', run: true, failureCode: 'AUTHOR_UNAVAILABLE' },
    { status: 'FAILED', run: true, failureCode: 'PREVIEW_UNAVAILABLE' },
    { status: 'FAILED', run: false, failureCode: null },
    { status: 'FAILED', run: false, failureCode: 'PRIVATE_DATABASE_ERROR' },
  ])(
    'enforces native terminal-state SQL checks, including NULL failure codes %#',
    async (fields) => {
      const job = await queue();
      const reference = await savedRun((await queue()).id);
      const resultId = fields.run ? reference.run.id : null;
      await expect(
        prisma.$executeRaw`INSERT INTO simulation_allocation_executions (job_id, status, run_id, failure_code, completed_at) VALUES (${job.id}, ${fields.status}::"SimulationAllocationExecutionStatus", ${resultId}, ${fields.failureCode}, ${new Date()})`,
      ).rejects.toThrow('simulation_allocation_executions_outcome_check');
      expect((await readAllocationJobOutcome(actors[1], job.id)).status).toBe('PENDING');
    },
  );

  it('rejects nonterminal SQL status values', async () => {
    const job = await queue();
    await expect(
      prisma.$executeRaw`INSERT INTO simulation_allocation_executions (job_id, status, completed_at) VALUES (${job.id}, 'PENDING'::"SimulationAllocationExecutionStatus", ${new Date()})`,
    ).rejects.toThrow('invalid input value for enum');
  });

  it.each(['job', 'status', 'run', 'failure', 'time'] as const)(
    'rejects native updates to immutable terminal %s data while allowing a no-op',
    async (field) => {
      const job = await queue();
      const { outcome } = await savedRun(job.id);
      const changes = {
        job: Prisma.sql`job_id = ${randomUUID()}`,
        status: Prisma.sql`status = 'FAILED'::"SimulationAllocationExecutionStatus"`,
        run: Prisma.sql`run_id = NULL`,
        failure: Prisma.sql`failure_code = 'AUTHOR_UNAVAILABLE'`,
        time: Prisma.sql`completed_at = completed_at + interval '1 second'`,
      };
      await expect(
        prisma.$executeRaw(
          Prisma.sql`UPDATE simulation_allocation_executions SET ${changes[field]} WHERE job_id = ${job.id}`,
        ),
      ).rejects.toThrow('immutable');
      expect(
        await prisma.$executeRaw`UPDATE simulation_allocation_executions SET completed_at = completed_at WHERE job_id = ${job.id}`,
      ).toBe(1);
      expect(await readAllocationJobOutcome(actors[1], job.id)).toEqual(outcome);
    },
  );

  it('enforces one execution per job and one linked execution per immutable run', async () => {
    const job = await queue();
    const { run } = await savedRun(job.id);
    await expect(
      prisma.simulationAllocationExecution.create({
        data: {
          jobId: job.id,
          status: 'FAILED',
          failureCode: 'AUTHOR_UNAVAILABLE',
          completedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.simulationAllocationExecution.create({
        data: {
          jobId: (await queue()).id,
          status: 'SUCCEEDED',
          runId: run.id,
          completedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('restricts job/run deletion and rejects missing source foreign keys', async () => {
    const job = await queue();
    const { run } = await savedRun(job.id);
    await expect(
      prisma.simulationAllocationJob.delete({ where: { id: job.id } }),
    ).rejects.toMatchObject({
      code: 'P2003',
    });
    await expect(
      prisma.simulationAllocationRun.delete({ where: { id: run.id } }),
    ).rejects.toMatchObject({
      code: 'P2003',
    });
    await expect(prisma.curriculum.delete({ where: { id: contexts[0] } })).rejects.toMatchObject({
      code: 'P2003',
    });
    await expect(
      prisma.simulationAllocationExecution.create({
        data: {
          jobId: randomUUID(),
          status: 'FAILED',
          failureCode: 'AUTHOR_UNAVAILABLE',
          completedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.simulationAllocationExecution.create({
        data: {
          jobId: (await queue()).id,
          status: 'SUCCEEDED',
          runId: randomUUID(),
          completedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('enforces unique immutable capture provenance and the run-to-job foreign key', async () => {
    const job = await queue();
    const { run } = await savedRun(job.id);
    const data = {
      ...scope(),
      createdById: actors[0],
      formatVersion: 1,
      capturedAt: new Date(run.capturedAt),
      createdAt: new Date(run.createdAt),
      result: run.result,
    };
    await expect(
      prisma.simulationAllocationRun.create({
        data: { ...data, jobId: job.id, requestId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.simulationAllocationRun.create({
        data: { ...data, jobId: randomUUID(), requestId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.$executeRaw`UPDATE simulation_allocation_runs SET job_id = NULL WHERE id = ${run.id}`,
    ).rejects.toThrow('immutable');
    expect(await counts()).toEqual({ executions: 1, runs: 1 });
  });

  it('rejects linking a manual capture even with identical actor, scenario and valid timestamps', async () => {
    const job = await queue();
    const summary = projectAllocationRunSummary(await readAllocationPreview(actors[0], scope()));
    const timestamp = new Date(Math.max(Date.now(), Date.parse(job.queuedAt)));
    const manual = await prisma.simulationAllocationRun.create({
      data: {
        ...scope(),
        jobId: null,
        createdById: actors[0],
        requestId: randomUUID(),
        formatVersion: 1,
        capturedAt: timestamp,
        createdAt: timestamp,
        result: summary,
      },
    });
    await prisma.simulationAllocationExecution.create({
      data: {
        jobId: job.id,
        status: 'SUCCEEDED',
        runId: manual.id,
        completedAt: timestamp,
      },
    });
    await expect(readAllocationJobOutcome(actors[1], job.id)).rejects.toThrow('provenance');
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await get(job.id, actors[1])).status).toBe(500);
    expect(await readAllocationRun(actors[1], manual.id)).toMatchObject({ result: summary });
  });

  it.each([
    'job',
    'creator',
    'scenario',
    'captureTime',
    'completionTime',
    'version',
    'result',
  ] as const)('fails closed on a newly inserted invalid linked run/outcome %s', async (field) => {
    const job = await queue();
    const summary = projectAllocationRunSummary(await readAllocationPreview(actors[0], scope()));
    const queued = new Date(job.queuedAt);
    const now = new Date(Math.max(Date.now(), queued.getTime() + 10));
    const result =
      field === 'scenario'
        ? { ...summary, scope: { ...summary.scope, year: 2027 } }
        : field === 'result'
          ? { ...summary, assignedStudentCount: summary.assignedStudentCount + 1 }
          : summary;
    const run = await prisma.simulationAllocationRun.create({
      data: {
        ...scope(),
        jobId: field === 'job' ? (await queue()).id : job.id,
        year: field === 'scenario' ? 2027 : 2026,
        createdById: field === 'creator' ? actors[1] : actors[0],
        requestId: randomUUID(),
        formatVersion: field === 'version' ? 2 : 1,
        capturedAt: field === 'captureTime' ? new Date(queued.getTime() - 1) : now,
        createdAt: now,
        result,
      },
    });
    await prisma.simulationAllocationExecution.create({
      data: {
        jobId: job.id,
        status: 'SUCCEEDED',
        runId: run.id,
        completedAt: field === 'completionTime' ? queued : now,
      },
    });
    const before = await counts();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await get(job.id, actors[1]);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: 'Could not load simulation job outcome',
    });
    await expect(readAllocationJobOutcome(actors[1], job.id)).rejects.toThrow('verified');
    expect(await counts()).toEqual(before);
    expect(await runOneAllocationJob(job.id)).toEqual({ processed: false });
  });

  it('executes the supported 500-student boundary within the bounded transaction', async () => {
    await addStudents(498);
    await prisma.schoolResource.update({
      where: { curriculumId_semester_year: scope() },
      data: { maxStudentsPerSection: 100000 },
    });
    const job = await queue();
    const started = Date.now();
    const { run } = await savedRun(job.id);
    const elapsed = Date.now() - started;
    expect(run.result.cohortStudentCount).toBe(500);
    expect(run.result.assignedStudentCount).toBe(500);
    expect(elapsed).toBeLessThan(15_000);
    expect(await counts()).toEqual({ executions: 1, runs: 1 });
  }, 30_000);

  it('rejects 501 students before full history reads and stores only a sanitized terminal failure', async () => {
    await addStudents(499);
    const job = await queue();
    sourceHistoryReads = 0;
    const outcome = await execute(job.id);
    expect(sourceHistoryReads).toBe(0);
    expect(outcome).toMatchObject({
      status: 'FAILED',
      failureCode: 'PREVIEW_UNAVAILABLE',
      runId: null,
    });
    expect(await counts()).toEqual({ executions: 1, runs: 0 });
    expect(await runOneAllocationJob(job.id)).toEqual({ processed: false });
  });

  it('rejects malformed selected IDs and skips an absent ID without touching other queued jobs', async () => {
    const job = await queue();
    await expect(runOneAllocationJob('invalid')).rejects.toThrow();
    await expect(runOneAllocationJob(`${job.id}\n`)).rejects.toThrow();
    expect(await runOneAllocationJob(randomUUID())).toEqual({ processed: false });
    expect((await readAllocationJobOutcome(actors[1], job.id)).status).toBe('PENDING');
    expect(await counts()).toEqual({ executions: 0, runs: 0 });
  });
});
