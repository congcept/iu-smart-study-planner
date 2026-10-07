import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import {
  OwnSemesterAllocationRunV1Schema,
  SemesterAllocationJobOutcomeSchema,
  SemesterAllocationResultV1Schema,
  SemesterAllocationRunV1Schema,
} from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import config from '../config';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { enqueueAllocationJob } from '../services/allocationJobs';
import { captureSemesterAllocationRun } from '../services/semesterAllocationCapture';
import {
  readSemesterAllocationJobOutcome,
  runOneSemesterAllocationJob,
  verifyStoredSemesterAllocationJobOutcome,
} from '../services/semesterAllocationJobExecution';
import {
  enqueueSemesterAllocationJob,
  readSemesterAllocationJob,
} from '../services/semesterAllocationJobs';
import {
  produceSemesterAllocationPreview,
  readSemesterAllocationPreview,
} from '../services/semesterAllocationPreview';
import {
  readOwnSemesterAllocationRun,
  readSemesterAllocationRun,
} from '../services/semesterAllocationStorage';

describe('explicit atomic semester simulation job execution (PostgreSQL)', () => {
  const prefix = `semester-worker-${randomUUID()}`;
  const administrators = [randomUUID(), randomUUID()];
  const students = [randomUUID(), randomUUID(), randomUUID()];
  const actors = [...administrators, ...students];
  const contexts = [randomUUID(), randomUUID()];
  const courses = [randomUUID(), randomUUID(), randomUUID()];
  const scope = () => ({ curriculumId: contexts[0], semester: 'FALL' as const, year: 2026 });
  const original = {
    demand: config.cohortDemandPolicy,
    envelope: config.simulationResourcePolicy,
    allocation: config.simulationAllocationPolicy,
    utility: config.allocationUtilityPolicy,
  };
  const knownJobs = new Set<string>();
  let afterCount: (() => Promise<void>) | undefined;
  let afterRunCreate: (() => Promise<void>) | undefined;
  let afterParticipantsCreate: (() => Promise<void>) | undefined;
  let afterExecutionCreate: (() => Promise<void>) | undefined;
  let afterMiddlewareRead: (() => Promise<void>) | undefined;
  let sourceHistoryReads = 0;

  const resetHooks = () => {
    afterCount = undefined;
    afterRunCreate = undefined;
    afterParticipantsCreate = undefined;
    afterExecutionCreate = undefined;
    afterMiddlewareRead = undefined;
    sourceHistoryReads = 0;
    knownJobs.clear();
  };
  const restorePolicies = () => {
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
    await prisma.user.deleteMany({ where: { studentId: { startsWith: prefix } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
  };
  const queue = async (actorId = administrators[0], requestId = randomUUID()) => {
    const { job } = await enqueueSemesterAllocationJob(actorId, {
      ...scope(),
      requestId,
      expectedActorId: actorId,
    });
    knownJobs.add(job.id);
    return job;
  };
  const get = (id: string, actorId = administrators[0]) =>
    request(app)
      .get(`/api/admin/semester-allocation-jobs/${id}/outcome`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(actorId)}`);
  const counts = async () => ({
    executions: await prisma.simulationSemesterAllocationExecution.count({
      where: { job: { curriculumId: { in: contexts } } },
    }),
    runs: await prisma.simulationSemesterRun.count({ where: { curriculumId: { in: contexts } } }),
    participants: await prisma.simulationSemesterParticipant.count({
      where: { run: { curriculumId: { in: contexts } } },
    }),
  });
  const source = async () => ({
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
    jobs: await prisma.simulationSemesterAllocationJob.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    oldJobs: await prisma.simulationAllocationJob.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    oldRuns: await prisma.simulationAllocationRun.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
  });
  const execute = async (id: string) => {
    const result = await runOneSemesterAllocationJob(id);
    if (!result.processed) throw new Error('Fixture semester job was not processed');
    return SemesterAllocationJobOutcomeSchema.parse(result.outcome);
  };
  const savedRun = async (id: string) => {
    const outcome = await execute(id);
    if (outcome.status !== 'SUCCEEDED' || outcome.runId === null)
      throw new Error('Fixture semester job did not succeed');
    const run = SemesterAllocationRunV1Schema.parse(
      await readSemesterAllocationRun(administrators[1], outcome.runId),
    );
    return { outcome, run };
  };
  const storedExecution = (jobId: string) =>
    prisma.simulationSemesterAllocationExecution.findUniqueOrThrow({
      where: { jobId },
      include: { run: { include: { participants: true } } },
    });

  beforeAll(() => {
    // Scoped probes observe completed real writes/queries; the timeout case forwards a shorter budget.
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (
        params.runInTransaction &&
        params.action === 'findMany' &&
        (params.model === 'StudentRecord' || params.model === 'GradeAttempt') &&
        Array.isArray(params.args?.where?.userId?.in) &&
        params.args.where.userId.in.includes(students[0])
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
        params.model === 'SimulationSemesterRun' &&
        params.action === 'create' &&
        params.args?.data?.curriculumId === contexts[0] &&
        afterRunCreate
      ) {
        const hook = afterRunCreate;
        afterRunCreate = undefined;
        await hook();
      }
      if (
        params.model === 'SimulationSemesterParticipant' &&
        params.action === 'createMany' &&
        Array.isArray(params.args?.data) &&
        params.args.data.some((item: { userId?: string }) => item.userId === students[0]) &&
        afterParticipantsCreate
      ) {
        const hook = afterParticipantsCreate;
        afterParticipantsCreate = undefined;
        await hook();
      }
      if (
        params.model === 'SimulationSemesterAllocationExecution' &&
        params.action === 'create' &&
        knownJobs.has(params.args?.data?.jobId) &&
        afterExecutionCreate
      ) {
        const hook = afterExecutionCreate;
        afterExecutionCreate = undefined;
        await hook();
      }
      if (
        params.model === 'User' &&
        params.action === 'findUnique' &&
        params.args?.where?.id === administrators[0] &&
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
    resetHooks();
    restorePolicies();
    await clean();
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-context-${index}`,
        name: 'Semester worker reference',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/semester-worker',
        isGpaPath: false,
      })),
    });
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-course-${index}`,
        name: `Semester worker course ${index}`,
        credits: 3,
        difficultyLevel: 2,
        semesterOffered: [],
      })),
    });
    for (let index = 0; index < courses.length; index++) {
      const member = await prisma.curriculumCourse.create({
        data: { curriculumId: contexts[0], courseId: courses[index] },
      });
      await prisma.curriculumPlacement.create({
        data: {
          curriculumCourseId: member.id,
          academicYear: 1,
          academicSemester: 1,
          sourceOrder: index,
        },
      });
    }
    await prisma.curriculumPrerequisite.create({
      data: {
        curriculumId: contexts[0],
        courseId: courses[2],
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
        name: `Private semester actor ${index}`,
        passwordHash: 'Private unused semester hash',
        role: index < 2 ? 'ADMIN' : 'STUDENT',
        curriculumId: index === 4 ? contexts[1] : contexts[0],
      })),
    });
    await prisma.studentRecord.createMany({
      data: students.slice(0, 2).flatMap((userId) =>
        courses.map((courseId) => ({
          userId,
          courseId,
          status: 'PLANNED' as const,
          grade: 'Private historic semester grade',
          gradePoints: 3.5,
          semester: 'Fall 2001',
          year: 2001,
        })),
      ),
    });
    await prisma.gradeAttempt.createMany({
      data: [88, 52].map((score) => ({
        userId: students[0],
        courseId: courses[0],
        requestId: randomUUID(),
        score,
      })),
    });
    await prisma.courseRating.create({
      data: { userId: students[0], courseId: courses[0], rating: 4 },
    });
    await prisma.studyPlan.create({
      data: {
        userId: students[0],
        name: 'Private prior semester plan',
        semesters: {
          create: {
            semester: 'FALL',
            year: 2001,
            courses: [{ courseId: courses[0] }],
            totalCredits: 31,
            difficultyScore: 4.2,
          },
        },
      },
    });
    await prisma.schoolResource.create({
      data: {
        ...scope(),
        professors: 3,
        classrooms: 3,
        labRooms: 1,
        maxStudentsPerSection: 2,
        revision: 1,
        updatedBy: administrators[0],
      },
    });
  });
  afterEach(async () => {
    resetHooks();
    jest.restoreAllMocks();
    await clean();
  });
  afterAll(() => {
    config.cohortDemandPolicy = original.demand;
    config.simulationResourcePolicy = original.envelope;
    config.simulationAllocationPolicy = original.allocation;
    config.allocationUtilityPolicy = original.utility;
  });

  it('returns an exact private-free PENDING outcome without capturing any input', async () => {
    const job = await queue();
    const before = await source();
    const response = await get(job.id.toUpperCase(), administrators[1]);
    expect(response.status).toBe(200);
    const outcome = SemesterAllocationJobOutcomeSchema.parse(response.body.data);
    expect(outcome).toEqual({
      jobId: job.id,
      kind: 'SIMULATION',
      usage: 'REFERENCE_ONLY',
      model: 'SEMESTER_CREDIT_BUDGET_V1',
      scope: scope(),
      queuedAt: job.queuedAt,
      executionModel: 'ATOMIC_SINGLE_JOB',
      status: 'PENDING',
      runId: null,
      completedAt: null,
      failureCode: null,
    });
    expect(await counts()).toEqual({ executions: 0, runs: 0, participants: 0 });
    expect(await source()).toEqual(before);
  });

  it('atomically captures the live aggregate and exact private owner outcomes without changing academic sources', async () => {
    const job = await queue();
    const before = await source();
    const expected = (await readSemesterAllocationPreview(administrators[0], scope())).result;
    const { run, outcome } = await savedRun(job.id.toUpperCase());
    expect(run.result).toEqual(expected);
    expect(run.result).toMatchObject({
      studentCount: 2,
      assignedStudentCount: 2,
      assignedCourseCount: 4,
      totalTargetCredits: 12,
      totalAssignedCredits: 12,
      totalRemainingCredits: 0,
    });
    expect(run.result.courses.find(({ courseId }) => courseId === courses[2])).toMatchObject({
      demandStudentCount: 0,
      assignedStudentCount: 0,
    });
    const saved = await storedExecution(job.id);
    const stored = saved.run!;
    const result = SemesterAllocationResultV1Schema.parse(stored.result);
    expect(stored.jobId).toBe(job.id);
    expect(stored.createdById).toBe(administrators[0]);
    expect(stored.requestId).not.toBe(job.id);
    expect(stored.requestId).not.toBe(
      (await prisma.simulationSemesterAllocationJob.findUniqueOrThrow({ where: { id: job.id } }))
        .requestId,
    );
    expect(saved.runId).toBe(run.id);
    expect(saved.completedAt.toISOString()).toBe(outcome.completedAt);
    expect(stored.participants).toHaveLength(2);
    for (const studentId of students.slice(0, 2)) {
      const participant = stored.participants.find(({ userId }) => userId === studentId)!;
      expect(participant.capturedStudentId).toBe(studentId);
      expect(participant.result).toEqual(
        result.students.find(({ studentId: id }) => id === studentId),
      );
      const own = OwnSemesterAllocationRunV1Schema.parse(
        await readOwnSemesterAllocationRun(studentId, run.id),
      );
      expect(own.result).toMatchObject({
        targetCredits: 6,
        assignedCredits: 6,
        remainingCredits: 0,
        reason: 'TARGET_REACHED',
      });
      expect(own.result.courseIds).toEqual(expect.arrayContaining(courses.slice(0, 2)));
      for (const id of actors) expect(JSON.stringify(own)).not.toContain(id);
    }
    await expect(readOwnSemesterAllocationRun(students[2], run.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await readSemesterAllocationJob(administrators[0], job.id)).toEqual(job);
    expect((await get(job.id, administrators[1])).body.data).toEqual(outcome);
    expect(await source()).toEqual(before);
    expect(await counts()).toEqual({ executions: 1, runs: 1, participants: 2 });
    const serialized = JSON.stringify({ run, outcome });
    for (const id of actors) expect(serialized).not.toContain(id);
    for (const value of [
      stored.requestId,
      'Private historic',
      'Private unused',
      '"students":',
      '"studentId":',
      'requestId',
      'createdById',
      'gradePoints',
      'passwordHash',
      'email',
    ])
      expect(serialized).not.toContain(value);
  });

  it('captures current resources and policies at execution after the immutable enqueue receipt', async () => {
    const job = await queue();
    await prisma.schoolResource.update({
      where: { curriculumId_semester_year: scope() },
      data: { professors: 0, revision: 2 },
    });
    config.cohortDemandPolicy = Object.freeze({ maxCredits: 9, maxDifficulty: 5 });
    const expected = (await readSemesterAllocationPreview(administrators[0], scope())).result;
    const { run } = await savedRun(job.id);
    expect(run.result).toEqual(expected);
    expect(run.result).toMatchObject({
      totalTargetCredits: 18,
      totalAssignedCredits: 0,
      stopReasonCounts: { CAPACITY_EXHAUSTED: 2 },
      envelope: { resourceRevision: 2, resources: { professors: 0 } },
    });
    expect(await readSemesterAllocationJob(administrators[1], job.id)).toEqual(job);
  });

  it('stores a successful unknown-resource reference result instead of pretending there is a terminal infrastructure error', async () => {
    await prisma.schoolResource.deleteMany({ where: scope() });
    const { run } = await savedRun((await queue()).id);
    expect(run.result).toMatchObject({
      totalAssignedCredits: 0,
      envelope: { resources: null },
      stopReasonCounts: { RESOURCE_UNKNOWN: 2 },
    });
  });

  it('converges concurrent workers for the same selected job on one immutable run and participant set', async () => {
    const job = await queue();
    const results = await Promise.all([
      runOneSemesterAllocationJob(job.id),
      runOneSemesterAllocationJob(job.id),
    ]);
    expect(results.filter(({ processed }) => processed)).toHaveLength(1);
    expect(await counts()).toEqual({ executions: 1, runs: 1, participants: 2 });
    const outcome = await readSemesterAllocationJobOutcome(administrators[1], job.id);
    expect(outcome.status).toBe('SUCCEEDED');
    expect(await runOneSemesterAllocationJob(job.id)).toEqual({ processed: false, outcome });
  });

  it('skips a job held by another real transaction and reports PENDING without waiting for its release', async () => {
    const job = await queue();
    let release: () => void = () => undefined;
    let signalReady: () => void = () => undefined;
    let failReady: (failure: unknown) => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve, reject) => {
      signalReady = resolve;
      failReady = reject;
    });
    let holderFailure: unknown;
    const holder = prisma
      .$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM simulation_semester_allocation_jobs WHERE id = ${job.id} FOR UPDATE`;
          signalReady();
          await released;
        },
        { timeout: 10000 },
      )
      .then(
        () => undefined,
        (failure: unknown) => {
          holderFailure = failure;
          failReady(failure);
        },
      );
    try {
      await ready;
      const skipped = await runOneSemesterAllocationJob(job.id);
      expect(skipped).toMatchObject({
        processed: false,
        outcome: { jobId: job.id, status: 'PENDING' },
      });
      expect(await counts()).toEqual({ executions: 0, runs: 0, participants: 0 });
    } finally {
      release();
      await holder;
    }
    if (holderFailure) throw holderFailure;
    expect((await execute(job.id)).status).toBe('SUCCEEDED');
  });

  it.each(['run', 'participants', 'execution'] as const)(
    'rolls back an unknown error after the real %s write and keeps explicit retry safe',
    async (stage) => {
      const job = await queue();
      const before = await source();
      const fail = async () => {
        throw new Error('Private infrastructure failure after real semester write');
      };
      if (stage === 'run') afterRunCreate = fail;
      else if (stage === 'participants') afterParticipantsCreate = fail;
      else afterExecutionCreate = fail;
      await expect(runOneSemesterAllocationJob(job.id)).rejects.toThrow('infrastructure failure');
      expect(await counts()).toEqual({ executions: 0, runs: 0, participants: 0 });
      expect((await readSemesterAllocationJobOutcome(administrators[1], job.id)).status).toBe(
        'PENDING',
      );
      expect(await source()).toEqual(before);
      expect((await execute(job.id)).status).toBe('SUCCEEDED');
      expect(await counts()).toEqual({ executions: 1, runs: 1, participants: 2 });
    },
  );

  it('rolls back an actual Prisma transaction timeout after run insertion and safely retries the same pending job', async () => {
    const job = await queue();
    const before = await source();
    let inserted = false;
    let timeoutCode: string | undefined;
    afterRunCreate = async () => {
      inserted = true;
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
    };
    const originalTransaction = prisma.$transaction.bind(prisma);
    const shortenedTransaction = jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce((callback, options) =>
        originalTransaction(callback, { ...options, timeout: 100 }).catch((failure: unknown) => {
          if (failure instanceof Prisma.PrismaClientKnownRequestError) timeoutCode = failure.code;
          throw failure;
        }),
      );
    try {
      await expect(runOneSemesterAllocationJob(job.id)).rejects.toMatchObject({ status: 409 });
      expect(inserted).toBe(true);
      expect(timeoutCode).toBe('P2028');
      expect(shortenedTransaction.mock.calls[0][1]).toMatchObject({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30000,
      });
    } finally {
      shortenedTransaction.mockRestore();
      afterRunCreate = undefined;
    }
    expect(await counts()).toEqual({ executions: 0, runs: 0, participants: 0 });
    expect((await readSemesterAllocationJobOutcome(administrators[1], job.id)).status).toBe(
      'PENDING',
    );
    expect(await source()).toEqual(before);
    expect((await execute(job.id)).status).toBe('SUCCEEDED');
    expect(await counts()).toEqual({ executions: 1, runs: 1, participants: 2 });
  });

  it.each(['demoted', 'deleted'] as const)(
    'records one sanitized terminal author failure when the original administrator is %s',
    async (change) => {
      const job = await queue();
      if (change === 'demoted')
        await prisma.user.update({ where: { id: administrators[0] }, data: { role: 'STUDENT' } });
      else await prisma.user.delete({ where: { id: administrators[0] } });
      const outcome = await execute(job.id);
      expect(outcome).toMatchObject({
        status: 'FAILED',
        runId: null,
        failureCode: 'AUTHOR_UNAVAILABLE',
      });
      expect(outcome.completedAt).not.toBeNull();
      expect((await get(job.id, administrators[1])).body.data).toEqual(outcome);
      expect(await counts()).toEqual({ executions: 1, runs: 0, participants: 0 });
      if (change === 'demoted')
        await prisma.user.update({ where: { id: administrators[0] }, data: { role: 'ADMIN' } });
      expect(await runOneSemesterAllocationJob(job.id)).toEqual({ processed: false, outcome });
    },
  );

  it('records a bounded-preview domain failure without capturing or reading student histories', async () => {
    const job = await queue();
    await prisma.user.createMany({
      data: Array.from({ length: 499 }, (_, index) => ({
        id: randomUUID(),
        studentId: `${prefix}-extra-${index}`,
        email: `${prefix}-extra-${index}@example.test`,
        name: 'Private extra semester student',
        role: 'STUDENT',
        curriculumId: contexts[0],
      })),
    });
    sourceHistoryReads = 0;
    const outcome = await execute(job.id);
    expect(outcome).toMatchObject({
      status: 'FAILED',
      failureCode: 'PREVIEW_UNAVAILABLE',
      runId: null,
    });
    expect(sourceHistoryReads).toBe(0);
    expect(await counts()).toEqual({ executions: 1, runs: 0, participants: 0 });
    expect(await runOneSemesterAllocationJob(job.id)).toEqual({ processed: false, outcome });
  });

  it('keeps invalid current configuration nonterminal and executes once after repair', async () => {
    const job = await queue();
    config.allocationUtilityPolicy = { difficultyFitWeight: 0, immediateUnlockWeight: 0 };
    await expect(runOneSemesterAllocationJob(job.id)).rejects.toThrow(
      'policies could not be verified',
    );
    expect(await counts()).toEqual({ executions: 0, runs: 0, participants: 0 });
    expect((await readSemesterAllocationJobOutcome(administrators[1], job.id)).status).toBe(
      'PENDING',
    );
    restorePolicies();
    expect((await execute(job.id)).status).toBe('SUCCEEDED');
  });

  it('keeps corrupt current source credits nonterminal rather than disguising corruption as a domain failure', async () => {
    const job = await queue();
    await prisma.course.update({ where: { id: courses[0] }, data: { credits: -1 } });
    await expect(runOneSemesterAllocationJob(job.id)).rejects.toThrow();
    expect(await counts()).toEqual({ executions: 0, runs: 0, participants: 0 });
    expect((await readSemesterAllocationJobOutcome(administrators[1], job.id)).status).toBe(
      'PENDING',
    );
    await prisma.course.update({ where: { id: courses[0] }, data: { credits: 3 } });
    expect((await execute(job.id)).status).toBe('SUCCEEDED');
  });

  it('keeps the producer snapshot coherent when resource and progress writers commit after the initial cohort count', async () => {
    const job = await queue();
    const expected = (await readSemesterAllocationPreview(administrators[0], scope())).result;
    afterCount = async () => {
      await prisma.$transaction(async (tx) => {
        await tx.schoolResource.update({
          where: { curriculumId_semester_year: scope() },
          data: { professors: 0, revision: 2 },
        });
        await tx.studentRecord.update({
          where: { userId_courseId: { userId: students[0], courseId: courses[0] } },
          data: { status: 'COMPLETED' },
        });
      });
    };
    const { run } = await savedRun(job.id);
    expect(run.result).toEqual(expected);
    expect((await readSemesterAllocationPreview(administrators[0], scope())).result).not.toEqual(
      expected,
    );
  });

  it('holds the author role through atomic commit while a real demotion waits on the worker lock', async () => {
    const job = await queue();
    let writer: Promise<void> | undefined;
    let writerFailure: unknown;
    let committed = false;
    afterCount = async () => {
      let signalPid: (pid: number) => void = () => undefined;
      let failPid: (failure: unknown) => void = () => undefined;
      const pidReady = new Promise<number>((resolve, reject) => {
        signalPid = resolve;
        failPid = reject;
      });
      writer = prisma
        .$transaction(
          async (tx) => {
            const [connection] = await tx.$queryRaw<
              { pid: number }[]
            >`SELECT pg_backend_pid() AS pid`;
            signalPid(connection.pid);
            await tx.user.update({ where: { id: administrators[0] }, data: { role: 'STUDENT' } });
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
      const pid = await pidReady;
      let blocked = false;
      for (let attempt = 0; attempt < 40 && !blocked; attempt++) {
        const [activity] = await prisma.$queryRaw<{ wait: string | null; blockers: number[] }[]>`
          SELECT wait_event_type AS wait, pg_blocking_pids(pid) AS blockers
          FROM pg_stat_activity WHERE pid = ${pid}
        `;
        blocked = activity?.wait === 'Lock' && activity.blockers.length > 0;
        if (!blocked) await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      expect(blocked).toBe(true);
      expect(committed).toBe(false);
      // Returning allows the protected worker transaction to commit before the writer can.
    };
    try {
      const { run } = await savedRun(job.id);
      expect(run.result.totalAssignedCredits).toBe(12);
    } finally {
      afterCount = undefined;
      if (writer) await writer;
    }
    if (writerFailure) throw writerFailure;
    expect(committed).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: administrators[0] } })).role).toBe(
      'STUDENT',
    );
    expect((await readSemesterAllocationJobOutcome(administrators[1], job.id)).status).toBe(
      'SUCCEEDED',
    );
    expect(await counts()).toEqual({ executions: 1, runs: 1, participants: 2 });
  });

  it('retries the raw role lock behind an uncommitted demotion before recording one author failure', async () => {
    const job = await queue();
    let releaseWriter: () => void = () => undefined;
    const release = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    let signalHeld: (pid: number) => void = () => undefined;
    let failHeld: (failure: unknown) => void = () => undefined;
    const writerReady = new Promise<number>((resolve, reject) => {
      signalHeld = resolve;
      failHeld = reject;
    });
    let writerFailure: unknown;
    const writer = prisma
      .$transaction(
        async (tx) => {
          const [connection] = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          await tx.user.update({ where: { id: administrators[0] }, data: { role: 'STUDENT' } });
          signalHeld(connection.pid);
          await release;
        },
        { maxWait: 3000, timeout: 10000 },
      )
      .then(
        () => undefined,
        (failure: unknown) => {
          writerFailure = failure;
          failHeld(failure);
        },
      );
    let execution: Promise<void> | undefined;
    let result: Awaited<ReturnType<typeof runOneSemesterAllocationJob>> | undefined;
    let executionFailure: unknown;
    try {
      const writerPid = await writerReady;
      execution = runOneSemesterAllocationJob(job.id).then(
        (received) => {
          result = received;
        },
        (failure: unknown) => {
          executionFailure = failure;
        },
      );
      let blocked = false;
      for (let attempt = 0; attempt < 40 && !blocked; attempt++) {
        const waiting = await prisma.$queryRaw<{ wait: string | null; blockers: number[] }[]>`
          SELECT wait_event_type AS wait, pg_blocking_pids(pid) AS blockers
          FROM pg_stat_activity
          WHERE pid <> ${writerPid}
            AND ${writerPid} = ANY(pg_blocking_pids(pid))
            AND query LIKE '%FROM users%'
            AND query LIKE '%FOR SHARE%'
        `;
        blocked = waiting.some(
          (activity) => activity.wait === 'Lock' && activity.blockers.includes(writerPid),
        );
        if (!blocked) await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      expect(blocked).toBe(true);
    } finally {
      releaseWriter();
      await writer;
      if (execution) await execution;
    }
    if (writerFailure) throw writerFailure;
    if (executionFailure) throw executionFailure;
    expect(result).toMatchObject({
      processed: true,
      outcome: { status: 'FAILED', failureCode: 'AUTHOR_UNAVAILABLE', runId: null },
    });
    const outcome = SemesterAllocationJobOutcomeSchema.parse(result?.outcome);
    expect(await counts()).toEqual({ executions: 1, runs: 0, participants: 0 });
    await prisma.user.update({ where: { id: administrators[0] }, data: { role: 'ADMIN' } });
    expect(await runOneSemesterAllocationJob(job.id)).toEqual({ processed: false, outcome });
    expect(await readSemesterAllocationJobOutcome(administrators[1], job.id)).toEqual(outcome);
  });

  it('requires current ADMIN for exact outcome reads and accepts neither query/body overrides nor IDs from the older queue', async () => {
    const job = await queue();
    const path = `/api/admin/semester-allocation-jobs/${job.id}/outcome`;
    expect((await request(app).get(path)).status).toBe(401);
    expect((await get(job.id, students[0])).status).toBe(403);
    expect((await get(job.id, randomUUID())).status).toBe(401);
    await expect(readSemesterAllocationJobOutcome(students[0], job.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(readSemesterAllocationJobOutcome(randomUUID(), job.id)).rejects.toMatchObject({
      status: 401,
    });
    expect((await get('invalid')).status).toBe(400);
    expect((await get(`${job.id}%0A`)).status).toBe(400);
    expect((await get(job.id).send({ runId: randomUUID() })).status).toBe(400);
    expect((await get(job.id).query({ year: 2027 })).status).toBe(400);
    expect((await get(randomUUID())).status).toBe(404);
    const old = (
      await enqueueAllocationJob(administrators[0], {
        ...scope(),
        requestId: randomUUID(),
        expectedActorId: administrators[0],
      })
    ).job;
    expect((await get(old.id)).status).toBe(404);
    await expect(runOneSemesterAllocationJob(old.id)).rejects.toMatchObject({ status: 404 });
    await expect(runOneSemesterAllocationJob(randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(runOneSemesterAllocationJob(`${job.id}\n`)).rejects.toThrow();
    expect(await counts()).toEqual({ executions: 0, runs: 0, participants: 0 });
  });

  it('reauthorizes a committed demotion after the route middleware read', async () => {
    const job = await queue();
    afterMiddlewareRead = async () => {
      await prisma.user.update({ where: { id: administrators[0] }, data: { role: 'STUDENT' } });
    };
    expect((await get(job.id)).status).toBe(403);
    expect(await counts()).toEqual({ executions: 0, runs: 0, participants: 0 });
  });

  it('replays terminal outcomes from immutable private storage without reading changed or invalid live allocation inputs', async () => {
    const job = await queue();
    const { outcome, run } = await savedRun(job.id);
    await prisma.schoolResource.update({
      where: { curriculumId_semester_year: scope() },
      data: { professors: 0, revision: 2 },
    });
    await prisma.studentRecord.updateMany({
      where: { userId: students[0] },
      data: { status: 'COMPLETED' },
    });
    config.allocationUtilityPolicy = { difficultyFitWeight: 0, immediateUnlockWeight: 0 };
    sourceHistoryReads = 0;
    expect(await readSemesterAllocationJobOutcome(administrators[1], job.id)).toEqual(outcome);
    expect(await runOneSemesterAllocationJob(job.id)).toEqual({ processed: false, outcome });
    expect(await readSemesterAllocationRun(administrators[1], run.id)).toEqual(run);
    expect(sourceHistoryReads).toBe(0);
    expect(await counts()).toEqual({ executions: 1, runs: 1, participants: 2 });
  });

  it('preserves terminal provenance and owner access after the creator is deleted', async () => {
    const job = await queue();
    const { run, outcome } = await savedRun(job.id);
    const own = await readOwnSemesterAllocationRun(students[0], run.id);
    await prisma.user.delete({ where: { id: administrators[0] } });
    expect(
      (await prisma.simulationSemesterAllocationJob.findUniqueOrThrow({ where: { id: job.id } }))
        .createdById,
    ).toBeNull();
    expect((await storedExecution(job.id)).run?.createdById).toBeNull();
    expect(await readSemesterAllocationJobOutcome(administrators[1], job.id)).toEqual(outcome);
    expect(await runOneSemesterAllocationJob(job.id)).toEqual({ processed: false, outcome });
    expect(await readOwnSemesterAllocationRun(students[0], run.id)).toEqual(own);
  });

  it('uses a separate private capture key even when a direct capture already owns the enqueue request key', async () => {
    const requestId = randomUUID();
    const job = await queue(administrators[0], requestId);
    const direct = await captureSemesterAllocationRun(administrators[0], {
      ...scope(),
      requestId,
      expectedActorId: administrators[0],
    });
    const { outcome, run } = await savedRun(job.id);
    expect(run.id).not.toBe(direct.run.id);
    expect((await storedExecution(job.id)).run?.requestId).not.toBe(requestId);
    expect(
      (await prisma.simulationSemesterRun.findUniqueOrThrow({ where: { id: direct.run.id } }))
        .jobId,
    ).toBeNull();
    expect(await readSemesterAllocationRun(administrators[1], direct.run.id)).toEqual(direct.run);
    expect(outcome.runId).toBe(run.id);
    expect(await counts()).toEqual({ executions: 1, runs: 2, participants: 4 });
  });

  it('rejects native terminal updates while allowing no-ops and preserves exact successful reads', async () => {
    const job = await queue();
    const { outcome } = await savedRun(job.id);
    const changes = [
      Prisma.sql`job_id = ${randomUUID()}`,
      Prisma.sql`status = 'FAILED'::"SimulationAllocationExecutionStatus"`,
      Prisma.sql`run_id = NULL`,
      Prisma.sql`failure_code = 'AUTHOR_UNAVAILABLE'`,
      Prisma.sql`completed_at = completed_at + interval '1 second'`,
    ];
    for (const change of changes)
      await expect(
        prisma.$executeRaw(
          Prisma.sql`UPDATE simulation_semester_allocation_executions SET ${change} WHERE job_id = ${job.id}`,
        ),
      ).rejects.toThrow();
    expect(
      await prisma.$executeRaw`UPDATE simulation_semester_allocation_executions SET completed_at = completed_at WHERE job_id = ${job.id}`,
    ).toBe(1);
    expect(await readSemesterAllocationJobOutcome(administrators[1], job.id)).toEqual(outcome);
  });

  it('rejects impossible terminal states and unknown failure codes through native SQL', async () => {
    const job = await queue();
    for (const fields of [
      { status: 'SUCCEEDED', failureCode: null },
      { status: 'FAILED', failureCode: null },
      { status: 'FAILED', failureCode: 'Private database failure' },
    ])
      await expect(
        prisma.$executeRaw`INSERT INTO simulation_semester_allocation_executions (job_id, status, run_id, failure_code, completed_at) VALUES (${job.id}, ${fields.status}::"SimulationAllocationExecutionStatus", NULL, ${fields.failureCode}, ${new Date()})`,
      ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`INSERT INTO simulation_semester_allocation_executions (job_id, status, completed_at) VALUES (${job.id}, 'PENDING'::"SimulationAllocationExecutionStatus", ${new Date()})`,
    ).rejects.toThrow();
    expect((await readSemesterAllocationJobOutcome(administrators[1], job.id)).status).toBe(
      'PENDING',
    );
  });

  it('restricts deletion and enforces one terminal execution per real job', async () => {
    const job = await queue();
    const { run } = await savedRun(job.id);
    await expect(
      prisma.simulationSemesterAllocationJob.delete({ where: { id: job.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.simulationSemesterRun.delete({ where: { id: run.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.curriculum.delete({ where: { id: contexts[0] } })).rejects.toMatchObject({
      code: 'P2003',
    });
    await expect(
      prisma.simulationSemesterAllocationExecution.create({
        data: {
          jobId: job.id,
          status: 'FAILED',
          failureCode: 'AUTHOR_UNAVAILABLE',
          completedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.simulationSemesterAllocationExecution.create({
        data: {
          jobId: randomUUID(),
          status: 'FAILED',
          failureCode: 'AUTHOR_UNAVAILABLE',
          completedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    const other = await queue();
    await expect(
      prisma.simulationSemesterAllocationExecution.create({
        data: { jobId: other.id, status: 'SUCCEEDED', runId: run.id, completedAt: new Date() },
      }),
    ).rejects.toThrow();
    expect((await readSemesterAllocationJobOutcome(administrators[1], other.id)).status).toBe(
      'PENDING',
    );
  });

  it('rejects associating a direct capture with an unrelated job through the native provenance gate', async () => {
    const job = await queue();
    const direct = await captureSemesterAllocationRun(administrators[0], {
      ...scope(),
      requestId: randomUUID(),
      expectedActorId: administrators[0],
    });
    await expect(
      prisma.simulationSemesterAllocationExecution.create({
        data: { jobId: job.id, status: 'SUCCEEDED', runId: direct.run.id, completedAt: new Date() },
      }),
    ).rejects.toThrow();
    expect((await readSemesterAllocationJobOutcome(administrators[1], job.id)).status).toBe(
      'PENDING',
    );
    expect(await readSemesterAllocationRun(administrators[1], direct.run.id)).toEqual(direct.run);
    expect((await execute(job.id)).status).toBe('SUCCEEDED');
  });

  it('rejects wrong job capture authors, scopes and chronology before allowing any provenance rewrite', async () => {
    const job = await queue();
    const { result } = await produceSemesterAllocationPreview(administrators[0], scope());
    const timestamp = new Date(Math.max(Date.now(), Date.parse(job.queuedAt)));
    const base = {
      ...scope(),
      jobId: job.id,
      createdById: administrators[0],
      formatVersion: 1,
      capturedAt: timestamp,
      createdAt: timestamp,
      result: result as unknown as Prisma.InputJsonValue,
    };
    for (const changes of [
      { createdById: administrators[1] },
      { year: 2027 },
      { capturedAt: new Date(Date.parse(job.queuedAt) - 1) },
      { formatVersion: 2 },
      { jobId: randomUUID() },
    ])
      await expect(
        prisma.simulationSemesterRun.create({
          data: { ...base, ...changes, requestId: randomUUID() },
        }),
      ).rejects.toThrow();
    expect(await counts()).toEqual({ executions: 0, runs: 0, participants: 0 });
    const { run } = await savedRun(job.id);
    await expect(
      prisma.$executeRaw`UPDATE simulation_semester_runs SET job_id = NULL WHERE id = ${run.id}`,
    ).rejects.toThrow('immutable');
    await expect(
      prisma.simulationSemesterRun.create({ data: { ...base, requestId: randomUUID() } }),
    ).rejects.toThrow();
    expect(await counts()).toEqual({ executions: 1, runs: 1, participants: 2 });
  });

  it.each(['result', 'participants'] as const)(
    'fails closed on a real linked capture with corrupt private %s without exposing a public outcome',
    async (field) => {
      const job = await queue();
      const { result } = await produceSemesterAllocationPreview(administrators[0], scope());
      const timestamp = new Date(Math.max(Date.now(), Date.parse(job.queuedAt)));
      const run = await prisma.simulationSemesterRun.create({
        data: {
          ...scope(),
          jobId: job.id,
          createdById: administrators[0],
          requestId: randomUUID(),
          formatVersion: 1,
          capturedAt: timestamp,
          createdAt: timestamp,
          result: (field === 'result' ? {} : result) as unknown as Prisma.InputJsonValue,
        },
      });
      if (field === 'participants') {
        const student = result.students[0];
        await prisma.simulationSemesterParticipant.create({
          data: {
            runId: run.id,
            capturedStudentId: student.studentId,
            userId: student.studentId,
            result: student as unknown as Prisma.InputJsonValue,
          },
        });
      }
      await prisma.simulationSemesterAllocationExecution.create({
        data: {
          jobId: job.id,
          status: 'SUCCEEDED',
          runId: run.id,
          completedAt: new Date(Math.max(Date.now(), timestamp.getTime())),
        },
      });
      const before = await counts();
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const response = await get(job.id, administrators[1]);
      expect(response.status).toBe(500);
      expect(response.body).not.toHaveProperty('data');
      expect(JSON.stringify(response.body)).not.toContain(students[0]);
      await expect(readSemesterAllocationJobOutcome(administrators[1], job.id)).rejects.toThrow(
        'verified',
      );
      await expect(runOneSemesterAllocationJob(job.id)).rejects.toThrow('verified');
      expect(await counts()).toEqual(before);
    },
  );

  it('fails closed on a linked orphan capture rather than reporting PENDING or producing another run', async () => {
    const job = await queue();
    const { result } = await produceSemesterAllocationPreview(administrators[0], scope());
    const timestamp = new Date(Math.max(Date.now(), Date.parse(job.queuedAt)));
    const run = await prisma.simulationSemesterRun.create({
      data: {
        ...scope(),
        jobId: job.id,
        createdById: administrators[0],
        requestId: randomUUID(),
        formatVersion: 1,
        capturedAt: timestamp,
        createdAt: timestamp,
        result: result as unknown as Prisma.InputJsonValue,
      },
    });
    await prisma.simulationSemesterParticipant.createMany({
      data: result.students.map((student) => ({
        runId: run.id,
        capturedStudentId: student.studentId,
        userId: student.studentId,
        result: student as unknown as Prisma.InputJsonValue,
      })),
    });
    const before = await counts();
    sourceHistoryReads = 0;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await get(job.id, administrators[1]);
    expect(response.status).toBe(500);
    expect(response.body).not.toHaveProperty('data');
    await expect(readSemesterAllocationJobOutcome(administrators[1], job.id)).rejects.toThrow(
      'verified',
    );
    await expect(runOneSemesterAllocationJob(job.id)).rejects.toThrow('verified');
    expect(sourceHistoryReads).toBe(0);
    expect(await counts()).toEqual(before);
  });

  it('verifies the entire private participant set before exposing even a public terminal outcome', async () => {
    const job = await queue();
    const { outcome } = await savedRun(job.id);
    const row = await prisma.simulationSemesterAllocationJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    const execution = await storedExecution(job.id);
    expect(verifyStoredSemesterAllocationJobOutcome(row, execution)).toEqual(outcome);
    const run = execution.run!;
    const corruption = [
      { ...execution, jobId: randomUUID() },
      { ...execution, run: { ...run, jobId: null } },
      { ...execution, run: { ...run, createdById: administrators[1] } },
      { ...execution, completedAt: new Date(row.createdAt.getTime() - 1) },
      { ...execution, run: { ...run, participants: run.participants.slice(1) } },
      {
        ...execution,
        run: {
          ...run,
          participants: run.participants.map((participant, index) =>
            index ? participant : { ...participant, capturedStudentId: students[2] },
          ),
        },
      },
      {
        ...execution,
        run: {
          ...run,
          participants: run.participants.map((participant, index) =>
            index ? participant : { ...participant, result: {} },
          ),
        },
      },
      { ...execution, run: { ...run, result: {} } },
    ];
    for (const invalid of corruption)
      expect(() => verifyStoredSemesterAllocationJobOutcome(row, invalid)).toThrow();
    expect(await readSemesterAllocationJobOutcome(administrators[1], job.id)).toEqual(outcome);
    expect(await counts()).toEqual({ executions: 1, runs: 1, participants: 2 });
  });
});
