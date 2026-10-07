import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CreateSemesterAllocationJobSchema,
  SemesterAllocationJobSchema,
} from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import config from '../config';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { enqueueAllocationJob } from '../services/allocationJobs';
import {
  enqueueSemesterAllocationJob,
  readSemesterAllocationJob,
} from '../services/semesterAllocationJobs';

describe('separate immutable semester simulation queue (PostgreSQL)', () => {
  const prefix = `semester-queue-${randomUUID()}`;
  const actors = Array.from({ length: 3 }, () => randomUUID());
  const contexts = Array.from({ length: 2 }, () => randomUUID());
  const courseId = randomUUID();
  const scope = () => ({ curriculumId: contexts[0], semester: 'FALL' as const, year: 2026 });
  const body = (requestId = randomUUID(), actorId = actors[0]) => ({
    ...scope(),
    requestId,
    expectedActorId: actorId,
  });
  const cookie = (actorId = actors[0]) => `${AUTH_COOKIE_NAME}=${issueToken(actorId)}`;
  const post = (input: Record<string, unknown> = body(), actorId = actors[0]) =>
    request(app)
      .post('/api/admin/semester-allocation-jobs')
      .set('Cookie', cookie(actorId))
      .send(input);
  const get = (id: string, actorId = actors[0]) =>
    request(app).get(`/api/admin/semester-allocation-jobs/${id}`).set('Cookie', cookie(actorId));
  const originalDemandPolicy = config.cohortDemandPolicy;
  let afterMiddlewareRead: (() => Promise<void>) | undefined;
  let afterQueueCreate: (() => Promise<void>) | undefined;
  let failAfterCreate = false;
  const clean = async () => {
    await prisma.simulationSemesterAllocationJob.deleteMany({
      where: { curriculumId: { in: contexts } },
    });
    await prisma.simulationAllocationJob.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.user.deleteMany({ where: { id: { in: actors } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: courseId } });
  };
  const evidence = async () => ({
    actors: await prisma.user.findMany({ where: { id: { in: actors } }, orderBy: { id: 'asc' } }),
    contexts: await prisma.curriculum.findMany({
      where: { id: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    course: await prisma.course.findMany({ where: { id: courseId } }),
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
    oldJobs: await prisma.simulationAllocationJob.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    oldRuns: await prisma.simulationAllocationRun.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    semesterRuns: await prisma.simulationSemesterRun.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
  });

  beforeAll(() => {
    // These probes run after actual queries/writes; transactions and PostgreSQL remain real.
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
        params.model === 'SimulationSemesterAllocationJob' &&
        params.action === 'create' &&
        params.args?.data?.createdById === actors[0] &&
        failAfterCreate
      ) {
        failAfterCreate = false;
        throw new Error('Fixture failure after real semester queue insertion');
      }
      if (
        params.model === 'SimulationSemesterAllocationJob' &&
        params.action === 'create' &&
        params.args?.data?.createdById === actors[0] &&
        afterQueueCreate
      ) {
        const observe = afterQueueCreate;
        afterQueueCreate = undefined;
        await observe();
      }
      return result;
    });
  });
  beforeEach(async () => {
    afterMiddlewareRead = undefined;
    afterQueueCreate = undefined;
    failAfterCreate = false;
    config.cohortDemandPolicy = originalDemandPolicy;
    await clean();
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Semester queue reference',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/semester-queue',
      })),
    });
    await prisma.user.createMany({
      data: actors.map((id, index) => ({
        id,
        email: `${prefix}-${index}@example.test`,
        studentId: `${prefix}-${index}`,
        name: `Semester queue actor ${index}`,
        passwordHash: 'unused',
        role: index < 2 ? 'ADMIN' : 'STUDENT',
      })),
    });
  });
  afterEach(async () => {
    afterMiddlewareRead = undefined;
    afterQueueCreate = undefined;
    failAfterCreate = false;
    config.cohortDemandPolicy = originalDemandPolicy;
    jest.restoreAllMocks();
    await clean();
  });

  it('stores scenario intent and returns the exact private-free semester model receipt', async () => {
    const input = body();
    const response = await post(input);
    expect(response.status).toBe(201);
    const job = SemesterAllocationJobSchema.parse(response.body.data);
    expect(job).toEqual({
      id: expect.any(String),
      kind: 'SIMULATION',
      usage: 'REFERENCE_ONLY',
      model: 'SEMESTER_CREDIT_BUDGET_V1',
      scope: scope(),
      status: 'QUEUED',
      queuedAt: expect.any(String),
      inputsCaptured: false,
    });
    const row = await prisma.simulationSemesterAllocationJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row.requestId).toBe(input.requestId);
    expect(row.createdById).toBe(actors[0]);
    expect(row.model).toBe(job.model);
    expect(row.createdAt.toISOString()).toBe(job.queuedAt);
    expect(Object.keys(response.body.data).sort()).toEqual(Object.keys(job).sort());
    expect(await prisma.simulationSemesterRun.count({ where: { curriculumId: contexts[0] } })).toBe(
      0,
    );
  });

  it('creates and replays without reading invalid allocation policies or requiring live cohort/resources', async () => {
    config.cohortDemandPolicy = Object.freeze({ maxCredits: -1, maxDifficulty: Number.NaN });
    const input = body();
    const first = await post(input);
    const replay = await post(input);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(first.body.data);
    expect(
      await prisma.simulationSemesterAllocationJob.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(1);
    expect(await prisma.simulationSemesterRun.count({ where: { curriculumId: contexts[0] } })).toBe(
      0,
    );
    expect(await prisma.schoolResource.count({ where: { curriculumId: contexts[0] } })).toBe(0);
    expect((await post({ ...body(), curriculumId: randomUUID() })).status).toBe(404);
  });

  it('normalizes all actor/scenario/retry UUIDs for durable replay and exact reads', async () => {
    const input = body();
    const saved = await enqueueSemesterAllocationJob(actors[0].toUpperCase(), {
      ...input,
      curriculumId: input.curriculumId.toUpperCase(),
      requestId: input.requestId.toUpperCase(),
      expectedActorId: actors[0].toUpperCase(),
    });
    expect(saved.created).toBe(true);
    expect((await post(input)).body.data).toEqual(saved.job);
    expect(
      await readSemesterAllocationJob(actors[0].toUpperCase(), saved.job.id.toUpperCase()),
    ).toEqual(saved.job);
  });

  it.each([{ curriculumId: contexts[1] }, { semester: 'SPRING' }, { year: 2027 }])(
    'rejects changed scenario recovery with the same actor and key: %j',
    async (changed) => {
      const input = body();
      const first = await post(input);
      expect((await post({ ...input, ...changed })).status).toBe(409);
      expect((await get(first.body.data.id)).body.data).toEqual(first.body.data);
      expect(
        await prisma.simulationSemesterAllocationJob.count({
          where: { curriculumId: { in: contexts } },
        }),
      ).toBe(1);
    },
  );

  it('keeps the same request key independent for separate administrators', async () => {
    const key = randomUUID();
    const first = await post(body(key));
    const second = await post(body(key, actors[1]), actors[1]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).not.toBe(first.body.data.id);
  });

  it('keeps the old one-course queue namespace and IDs separate for the same actor/key', async () => {
    const input = body();
    const old = await enqueueAllocationJob(actors[0], input);
    const fresh = await post(input);
    expect(fresh.status).toBe(201);
    expect(fresh.body.data.id).not.toBe(old.job.id);
    expect((await get(old.job.id)).status).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/admin/allocation-jobs/${fresh.body.data.id}`)
          .set('Cookie', cookie())
      ).status,
    ).toBe(404);
    expect((await post(input)).body.data).toEqual(fresh.body.data);
    expect(
      await prisma.simulationAllocationJob.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(1);
    expect(
      await prisma.simulationSemesterAllocationJob.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(1);
  });

  it('deduplicates real concurrent same-key semester requests', async () => {
    const input = body();
    const responses = await Promise.all([post(input), post(input), post(input), post(input)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 200, 201]);
    expect(new Set(responses.map((response) => response.body.data.id)).size).toBe(1);
    expect(
      await prisma.simulationSemesterAllocationJob.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(1);
  });

  it('commits one winner when concurrent same-key requests disagree on the scenario', async () => {
    const input = body();
    const responses = await Promise.all([post(input), post({ ...input, year: 2027 })]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.simulationSemesterAllocationJob.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(1);
  });

  it('checks the expected administrator before creating or replaying any key', async () => {
    const input = body();
    expect((await post({ ...input, expectedActorId: actors[1] })).status).toBe(409);
    expect(
      await prisma.simulationSemesterAllocationJob.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(0);
    await post(input);
    expect((await post({ ...input, expectedActorId: actors[1] })).status).toBe(409);
    expect(
      await prisma.simulationSemesterAllocationJob.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(1);
  });

  it('requires cookie authentication and an administrator for enqueue and read', async () => {
    const saved = await post();
    expect(
      (await request(app).post('/api/admin/semester-allocation-jobs').send(body())).status,
    ).toBe(401);
    expect(
      (await request(app).get(`/api/admin/semester-allocation-jobs/${saved.body.data.id}`)).status,
    ).toBe(401);
    expect((await post(body(randomUUID(), actors[2]), actors[2])).status).toBe(403);
    expect((await get(saved.body.data.id, actors[2])).status).toBe(403);
  });

  it('reauthorizes a committed demotion after middleware before both new enqueue and replay', async () => {
    const input = body();
    afterMiddlewareRead = async () => {
      await prisma.user.update({ where: { id: actors[0] }, data: { role: 'STUDENT' } });
    };
    expect((await post(input)).status).toBe(403);
    expect(
      await prisma.simulationSemesterAllocationJob.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(0);
    await prisma.user.update({ where: { id: actors[0] }, data: { role: 'ADMIN' } });
    await post(input);
    afterMiddlewareRead = async () => {
      await prisma.user.update({ where: { id: actors[0] }, data: { role: 'STUDENT' } });
    };
    expect((await post(input)).status).toBe(403);
  });

  it('reauthorizes a committed demotion after middleware before returning a saved receipt', async () => {
    const saved = await post();
    afterMiddlewareRead = async () => {
      await prisma.user.update({ where: { id: actors[0] }, data: { role: 'STUDENT' } });
    };
    expect((await get(saved.body.data.id)).status).toBe(403);
  });

  it('holds the administrator role lock through queue commit before a real demotion can succeed', async () => {
    const input = body();
    let writer: Promise<void> | undefined;
    let demotionCommitted = false;
    afterQueueCreate = async () => {
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
            await tx.user.update({ where: { id: actors[0] }, data: { role: 'STUDENT' } });
          },
          { maxWait: 3000, timeout: 10000 },
        )
        .then(
          () => {
            demotionCommitted = true;
          },
          (failure: unknown) => {
            failPid(failure);
          },
        );
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
      expect(demotionCommitted).toBe(false);
      // Return to allow the queue transaction to commit and release its FOR SHARE lock.
    };
    let saved: Awaited<ReturnType<typeof enqueueSemesterAllocationJob>> | undefined;
    try {
      saved = await enqueueSemesterAllocationJob(actors[0], input);
    } finally {
      afterQueueCreate = undefined;
      if (writer) await writer;
    }
    expect(saved?.created).toBe(true);
    expect(demotionCommitted).toBe(true);
    await expect(enqueueSemesterAllocationJob(actors[0], input)).rejects.toMatchObject({
      status: 403,
    });
    await expect(readSemesterAllocationJob(actors[0], saved!.job.id)).rejects.toMatchObject({
      status: 403,
    });
    expect(await readSemesterAllocationJob(actors[1], saved!.job.id)).toEqual(saved!.job);
  });

  const requestDuringUncommittedDemotion = async (submit: () => ReturnType<typeof post>) => {
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
          await tx.user.update({ where: { id: actors[0] }, data: { role: 'STUDENT' } });
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
    let middlewareSawAdmin = false;
    afterMiddlewareRead = async () => {
      middlewareSawAdmin = true;
    };
    let response: { status: number; body: unknown } | undefined;
    let submissionFailure: unknown;
    let submission: Promise<void> | undefined;
    try {
      const writerPid = await writerReady;
      submission = submit().then(
        (received) => {
          response = { status: received.status, body: received.body };
        },
        (failure: unknown) => {
          submissionFailure = failure;
        },
      );
      let blocked = false;
      for (let attempt = 0; attempt < 40 && !blocked; attempt++) {
        const waiting = await prisma.$queryRaw<{ wait: string | null; blockers: number[] }[]>`
          SELECT wait_event_type AS wait, pg_blocking_pids(pid) AS blockers
          FROM pg_stat_activity
          WHERE pid <> ${writerPid}
            AND ${writerPid} = ANY(pg_blocking_pids(pid))
            AND query LIKE '%FROM "users"%'
            AND query LIKE '%FOR SHARE%'
        `;
        blocked = waiting.some(
          (activity) => activity.wait === 'Lock' && activity.blockers.includes(writerPid),
        );
        if (!blocked) await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      expect(middlewareSawAdmin).toBe(true);
      expect(blocked).toBe(true);
    } finally {
      afterMiddlewareRead = undefined;
      releaseWriter();
      await writer;
      if (submission) await submission;
    }
    if (writerFailure) throw writerFailure;
    if (submissionFailure) throw submissionFailure;
    if (!response) throw new Error('The role-wait request did not return a response');
    return response;
  };

  it.each(['enqueue', 'read'] as const)(
    '%s retries a role lock waiting behind an uncommitted demotion and rejects without exposing a receipt',
    async (operation) => {
      const input = body();
      const prior = operation === 'read' ? await post(input) : undefined;
      if (prior) expect(prior.status).toBe(201);
      const saved = prior ? SemesterAllocationJobSchema.parse(prior.body.data) : undefined;
      const response = await requestDuringUncommittedDemotion(() =>
        saved ? get(saved.id) : post(input),
      );
      expect(response.status).toBe(403);
      expect(response.body).not.toHaveProperty('data');
      expect(
        await prisma.simulationSemesterAllocationJob.count({
          where: { createdById: actors[0], requestId: input.requestId },
        }),
      ).toBe(saved ? 1 : 0);
      await prisma.user.update({ where: { id: actors[0] }, data: { role: 'ADMIN' } });
      if (saved) {
        const restored = await get(saved.id);
        expect(restored.status).toBe(200);
        expect(restored.body.data).toEqual(saved);
      } else {
        expect((await post(input)).status).toBe(201);
        expect(
          await prisma.simulationSemesterAllocationJob.count({
            where: { createdById: actors[0], requestId: input.requestId },
          }),
        ).toBe(1);
      }
    },
  );

  it('rejects absent or demoted actors through direct service calls as well', async () => {
    await expect(enqueueSemesterAllocationJob(randomUUID(), body())).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      enqueueSemesterAllocationJob(actors[2], body(randomUUID(), actors[2])),
    ).rejects.toMatchObject({ status: 403 });
    await expect(readSemesterAllocationJob(randomUUID(), randomUUID())).rejects.toMatchObject({
      status: 401,
    });
  });

  it('allows current admin inspection without exposing the author/key, including after creator deletion', async () => {
    const first = await post();
    const response = await get(first.body.data.id, actors[1]);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(first.body.data);
    expect(response.body.data).not.toHaveProperty('requestId');
    expect(response.body.data).not.toHaveProperty('createdById');
    await prisma.user.delete({ where: { id: actors[0] } });
    expect(
      (
        await prisma.simulationSemesterAllocationJob.findUniqueOrThrow({
          where: { id: first.body.data.id },
        })
      ).createdById,
    ).toBeNull();
    expect((await get(first.body.data.id, actors[1])).body.data).toEqual(first.body.data);
  });

  it('restricts curriculum deletion while queued semester history exists', async () => {
    await post();
    await expect(prisma.curriculum.delete({ where: { id: contexts[0] } })).rejects.toMatchObject({
      code: 'P2003',
    });
  });

  it.each([
    { year: 2027 },
    { requestId: randomUUID() },
    { createdAt: new Date('2001-01-01T00:00:00Z') },
  ])('rejects immutable request/scenario/time mutation in PostgreSQL: %j', async (changed) => {
    const first = await post();
    await expect(
      prisma.simulationSemesterAllocationJob.update({
        where: { id: first.body.data.id },
        data: changed,
      }),
    ).rejects.toThrow();
    expect((await get(first.body.data.id)).body.data).toEqual(first.body.data);
  });

  it('permits no-op updates and creator detachment but rejects creator reattachment', async () => {
    const first = await post();
    await prisma.simulationSemesterAllocationJob.update({
      where: { id: first.body.data.id },
      data: { year: 2026 },
    });
    await prisma.simulationSemesterAllocationJob.update({
      where: { id: first.body.data.id },
      data: { createdById: null },
    });
    await expect(
      prisma.simulationSemesterAllocationJob.update({
        where: { id: first.body.data.id },
        data: { createdById: actors[0] },
      }),
    ).rejects.toThrow();
    expect((await get(first.body.data.id)).body.data).toEqual(first.body.data);
  });

  it('enforces the pinned model, year bounds and actor/request uniqueness in PostgreSQL', async () => {
    const input = body();
    await post(input);
    for (const year of [1999, 2101])
      await expect(
        prisma.simulationSemesterAllocationJob.create({
          data: { ...scope(), year, requestId: randomUUID(), createdById: actors[0] },
        }),
      ).rejects.toThrow();
    await expect(
      prisma.simulationSemesterAllocationJob.create({
        data: {
          ...scope(),
          model: 'ONE_COURSE_PER_STUDENT_ROUND_V1',
          requestId: randomUUID(),
          createdById: actors[0],
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.simulationSemesterAllocationJob.create({
        data: { ...scope(), requestId: input.requestId, createdById: actors[0] },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it.each([
    { expectedActorId: undefined },
    { requestId: `${randomUUID()}\n` },
    { model: 'SEMESTER_CREDIT_BUDGET_V1' },
    { students: [], inputsCaptured: true },
  ])('rejects malformed or supplied simulation inputs without saving: %j', async (changed) => {
    const input = { ...body(), ...changed };
    expect(CreateSemesterAllocationJobSchema.safeParse(input).success).toBe(false);
    expect((await post(input)).status).toBe(400);
    expect(
      await prisma.simulationSemesterAllocationJob.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(0);
  });

  it('rejects query/body overrides and noncanonical IDs while preserving valid exact reads', async () => {
    expect(
      (
        await request(app)
          .post('/api/admin/semester-allocation-jobs?execute=true')
          .set('Cookie', cookie())
          .send(body())
      ).status,
    ).toBe(400);
    const first = await post();
    expect((await get(first.body.data.id).query({ userId: actors[1] })).status).toBe(400);
    expect((await get(first.body.data.id).send({ result: {} })).status).toBe(400);
    expect((await get('invalid')).status).toBe(400);
    expect((await get(`${first.body.data.id}%0A`)).status).toBe(400);
    expect((await get(randomUUID())).status).toBe(404);
    expect((await get(first.body.data.id.toUpperCase())).body.data).toEqual(first.body.data);
  });

  it('fails closed instead of projecting a corrupt stored source identity', async () => {
    const id = 'corrupt-semester-queue-id';
    await prisma.simulationSemesterAllocationJob.create({
      data: { id, ...scope(), requestId: randomUUID(), createdById: actors[0] },
    });
    await expect(readSemesterAllocationJob(actors[0], id)).rejects.toThrow();
  });

  it('rolls back a real inserted row after a later transaction failure and keeps its key safely retryable', async () => {
    const input = body();
    failAfterCreate = true;
    await expect(enqueueSemesterAllocationJob(actors[0], input)).rejects.toThrow(
      'Fixture failure after real semester queue insertion',
    );
    expect(
      await prisma.simulationSemesterAllocationJob.count({
        where: { createdById: actors[0], requestId: input.requestId },
      }),
    ).toBe(0);
    const recovered = await enqueueSemesterAllocationJob(actors[0], input);
    expect(recovered.created).toBe(true);
    expect(recovered.job.status).toBe('QUEUED');
    expect(recovered.job.inputsCaptured).toBe(false);
  });

  it('leaves academic data, resources, old jobs and both capture formats unchanged on enqueue/replay/read', async () => {
    await prisma.course.create({
      data: {
        id: courseId,
        code: `${prefix}-course`,
        name: 'Retained course',
        credits: 3,
        difficultyLevel: 2,
      },
    });
    await prisma.studentRecord.create({
      data: { userId: actors[2], courseId, status: 'COMPLETED', grade: 'A', gradePoints: 4 },
    });
    await prisma.gradeAttempt.create({
      data: { userId: actors[2], courseId, score: 85, requestId: randomUUID() },
    });
    await prisma.studyPlan.create({ data: { userId: actors[2], name: 'Retained plan' } });
    await prisma.schoolResource.create({
      data: {
        ...scope(),
        professors: 1,
        classrooms: 1,
        labRooms: 0,
        maxStudentsPerSection: 40,
        revision: 1,
      },
    });
    await enqueueAllocationJob(actors[0], body());
    const before = await evidence();
    const input = body();
    const first = await post(input);
    expect(first.status).toBe(201);
    expect((await post(input)).status).toBe(200);
    expect((await get(first.body.data.id)).status).toBe(200);
    expect(await evidence()).toEqual(before);
  });
});
