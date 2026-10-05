import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AllocationJobSchema } from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import config from '../config';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { enqueueAllocationJob, readAllocationJob } from '../services/allocationJobs';

describe('durable queued simulation requests (PostgreSQL)', () => {
  const prefix = `simulation-queue-${randomUUID()}`;
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
    request(app).post('/api/admin/allocation-jobs').set('Cookie', cookie(actorId)).send(input);
  const get = (id: string, actorId = actors[0]) =>
    request(app).get(`/api/admin/allocation-jobs/${id}`).set('Cookie', cookie(actorId));
  const originalDemandPolicy = config.cohortDemandPolicy;
  let afterMiddlewareRead: (() => Promise<void>) | undefined;
  const clean = async () => {
    await prisma.simulationAllocationJob.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.simulationAllocationRun.deleteMany({ where: { curriculumId: { in: contexts } } });
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
    runs: await prisma.simulationAllocationRun.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
  });

  beforeAll(() => {
    // Only a committed fixture writer after a real middleware SELECT; never replace transactions.
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
      return result;
    });
  });
  beforeEach(async () => {
    afterMiddlewareRead = undefined;
    config.cohortDemandPolicy = originalDemandPolicy;
    await clean();
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Queue reference',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/queue',
      })),
    });
    await prisma.user.createMany({
      data: actors.map((id, index) => ({
        id,
        email: `${prefix}-${index}@example.test`,
        studentId: `${prefix}-${index}`,
        name: `Queue actor ${index}`,
        passwordHash: 'unused',
        role: index < 2 ? 'ADMIN' : 'STUDENT',
      })),
    });
  });
  afterEach(async () => {
    afterMiddlewareRead = undefined;
    config.cohortDemandPolicy = originalDemandPolicy;
    jest.restoreAllMocks();
    await clean();
  });

  it('stores a scenario intent only and replies with an exact private-free queued contract', async () => {
    const input = body();
    const response = await post(input);
    expect(response.status).toBe(201);
    const job = AllocationJobSchema.parse(response.body.data);
    expect(job).toEqual({
      id: expect.any(String),
      kind: 'SIMULATION',
      usage: 'REFERENCE_ONLY',
      scope: scope(),
      status: 'QUEUED',
      queuedAt: expect.any(String),
      inputsCaptured: false,
    });
    const stored = await prisma.simulationAllocationJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(stored.requestId).toBe(input.requestId);
    expect(stored.createdById).toBe(actors[0]);
    expect(job.queuedAt).toBe(stored.createdAt.toISOString());
    expect(Object.keys(response.body.data).sort()).toEqual(Object.keys(job).sort());
  });
  it('replays the same id/time without previewing current invalid policies or missing resources', async () => {
    const input = body();
    const first = await post(input);
    config.cohortDemandPolicy = Object.freeze({ maxCredits: -1, maxDifficulty: Number.NaN });
    const retry = await post(input);
    expect(retry.status).toBe(200);
    expect(retry.body.data).toEqual(first.body.data);
    expect(
      await prisma.simulationAllocationJob.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(1);
    expect(
      await prisma.simulationAllocationRun.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(0);
  });
  it('normalizes actor, context and retry UUIDs before storing or looking up the key', async () => {
    const input = body();
    const first = await enqueueAllocationJob(actors[0].toUpperCase(), {
      ...input,
      curriculumId: input.curriculumId.toUpperCase(),
      requestId: input.requestId.toUpperCase(),
      expectedActorId: actors[0].toUpperCase(),
    });
    const retry = await post(input);
    expect(retry.status).toBe(200);
    expect(retry.body.data).toEqual(first.job);
    expect((await readAllocationJob(actors[0].toUpperCase(), first.job.id.toUpperCase())).id).toBe(
      first.job.id,
    );
  });
  it.each([{ curriculumId: contexts[1] }, { semester: 'SPRING' }, { year: 2027 }])(
    'rejects changed scenario with the same actor/key: %j',
    async (changed) => {
      const input = body();
      const first = await post(input);
      const retry = await post({ ...input, ...changed });
      expect(retry.status).toBe(409);
      expect((await get(first.body.data.id)).body.data).toEqual(first.body.data);
      expect(
        await prisma.simulationAllocationJob.count({ where: { curriculumId: { in: contexts } } }),
      ).toBe(1);
    },
  );
  it('keeps identical retry keys independent for separate admins', async () => {
    const key = randomUUID();
    const first = await post(body(key));
    const second = await post(body(key, actors[1]), actors[1]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).not.toBe(first.body.data.id);
  });
  it('deduplicates concurrent same-key enqueues in real PostgreSQL', async () => {
    const input = body();
    const replies = await Promise.all([post(input), post(input), post(input), post(input)]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 200, 200, 201]);
    expect(new Set(replies.map((reply) => reply.body.data.id)).size).toBe(1);
    expect(
      await prisma.simulationAllocationJob.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(1);
  });
  it('concurrent changed-scenario enqueues persist one winner and reject the other', async () => {
    const input = body();
    const replies = await Promise.all([post(input), post({ ...input, year: 2027 })]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.simulationAllocationJob.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(1);
  });
  it('requires a context but does not require verified curricula, resources or cohort members', async () => {
    expect((await post({ ...body(), curriculumId: randomUUID() })).status).toBe(404);
    expect((await post()).status).toBe(201);
  });
  it('rejects switched actor before any new save or key replay', async () => {
    const input = body();
    expect((await post({ ...input, expectedActorId: actors[1] })).status).toBe(409);
    expect(
      await prisma.simulationAllocationJob.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(0);
    await post(input);
    expect((await post({ ...input, expectedActorId: actors[1] })).status).toBe(409);
  });
  it('requires anonymous/student access guards for both enqueue and read', async () => {
    const saved = await post();
    expect((await request(app).post('/api/admin/allocation-jobs').send(body())).status).toBe(401);
    expect(
      (await request(app).get(`/api/admin/allocation-jobs/${saved.body.data.id}`)).status,
    ).toBe(401);
    expect((await post(body(randomUUID(), actors[2]), actors[2])).status).toBe(403);
    expect((await get(saved.body.data.id, actors[2])).status).toBe(403);
  });
  it('reauthorizes after middleware before creating or replaying a queue request', async () => {
    const input = body();
    afterMiddlewareRead = async () => {
      await prisma.user.update({ where: { id: actors[0] }, data: { role: 'STUDENT' } });
    };
    expect((await post(input)).status).toBe(403);
    expect(
      await prisma.simulationAllocationJob.count({ where: { curriculumId: contexts[0] } }),
    ).toBe(0);
    await prisma.user.update({ where: { id: actors[0] }, data: { role: 'ADMIN' } });
    await post(input);
    afterMiddlewareRead = async () => {
      await prisma.user.update({ where: { id: actors[0] }, data: { role: 'STUDENT' } });
    };
    expect((await post(input)).status).toBe(403);
  });
  it('reauthorizes after middleware before historical reads', async () => {
    const saved = await post();
    afterMiddlewareRead = async () => {
      await prisma.user.update({ where: { id: actors[0] }, data: { role: 'STUDENT' } });
    };
    expect((await get(saved.body.data.id)).status).toBe(403);
  });
  it('direct service calls reject absent or demoted actors', async () => {
    await expect(enqueueAllocationJob(randomUUID(), body())).rejects.toMatchObject({ status: 401 });
    await expect(
      enqueueAllocationJob(actors[2], body(randomUUID(), actors[2])),
    ).rejects.toMatchObject({ status: 403 });
    await expect(readAllocationJob(randomUUID(), randomUUID())).rejects.toMatchObject({
      status: 401,
    });
  });
  it('other current admins can inspect a request without learning its author or retry key', async () => {
    const first = await post();
    const response = await get(first.body.data.id, actors[1]);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(first.body.data);
    expect(response.body.data).not.toHaveProperty('requestId');
    expect(response.body.data).not.toHaveProperty('createdById');
  });
  it('anonymizes a deleted creator while preserving the original request', async () => {
    const first = await post();
    await prisma.user.delete({ where: { id: actors[0] } });
    expect(
      (
        await prisma.simulationAllocationJob.findUniqueOrThrow({
          where: { id: first.body.data.id },
        })
      ).createdById,
    ).toBeNull();
    expect((await get(first.body.data.id, actors[1])).body.data).toEqual(first.body.data);
  });
  it('restricts context deletion while queued history exists', async () => {
    await post();
    await expect(prisma.curriculum.delete({ where: { id: contexts[0] } })).rejects.toMatchObject({
      code: 'P2003',
    });
  });
  it.each([
    { year: 2027 },
    { semester: 'SPRING' as const },
    { curriculumId: contexts[1] },
    { requestId: randomUUID() },
    { createdById: actors[1] },
    { createdAt: new Date('2001-01-01T00:00:00Z') },
    { id: randomUUID() },
  ])('SQL rejects mutation of immutable source fields: %j', async (changed) => {
    const saved = await post();
    await expect(
      prisma.simulationAllocationJob.update({ where: { id: saved.body.data.id }, data: changed }),
    ).rejects.toThrow();
    expect((await get(saved.body.data.id)).body.data).toEqual(saved.body.data);
  });
  it('allows no-op updates but cannot reattach an anonymized creator', async () => {
    const saved = await post();
    await prisma.simulationAllocationJob.update({
      where: { id: saved.body.data.id },
      data: { year: 2026 },
    });
    await prisma.simulationAllocationJob.update({
      where: { id: saved.body.data.id },
      data: { createdById: null },
    });
    await expect(
      prisma.simulationAllocationJob.update({
        where: { id: saved.body.data.id },
        data: { createdById: actors[0] },
      }),
    ).rejects.toThrow();
    expect((await get(saved.body.data.id)).body.data).toEqual(saved.body.data);
  });
  it('SQL rejects out-of-bounds years and duplicate actor/request keys', async () => {
    const input = body();
    await post(input);
    await expect(
      prisma.simulationAllocationJob.create({
        data: { ...scope(), year: 1999, requestId: randomUUID(), createdById: actors[0] },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.simulationAllocationJob.create({
        data: { ...scope(), year: 2101, requestId: randomUUID(), createdById: actors[0] },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.simulationAllocationJob.create({
        data: { ...scope(), requestId: input.requestId, createdById: actors[0] },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
  it.each([
    { expectedActorId: undefined },
    { expectedActorId: 'invalid' },
    { requestId: 'invalid' },
    { year: '2026' },
    { year: 2026.5 },
    { year: 1999 },
    { semester: 'WINTER' },
    { status: 'SUCCEEDED' },
    { createdById: actors[0] },
    { inputsCaptured: true },
    { result: {} },
  ])('rejects malformed or unsupported enqueue fields: %j', async (changed) => {
    expect((await post({ ...body(), ...changed })).status).toBe(400);
    expect(
      await prisma.simulationAllocationJob.count({ where: { curriculumId: { in: contexts } } }),
    ).toBe(0);
  });
  it('rejects enqueue/read overrides and malformed IDs without exposing metadata', async () => {
    expect(
      (
        await request(app)
          .post('/api/admin/allocation-jobs?status=SUCCEEDED')
          .set('Cookie', cookie())
          .send(body())
      ).status,
    ).toBe(400);
    const saved = await post();
    expect((await get(saved.body.data.id).query({ curriculumId: contexts[1] })).status).toBe(400);
    expect((await get('bad-id')).status).toBe(400);
    expect((await get(`${saved.body.data.id}%0A`)).status).toBe(400);
    expect((await get(randomUUID())).status).toBe(404);
    expect((await get(saved.body.data.id.toUpperCase())).body.data).toEqual(saved.body.data);
  });
  it('fails closed when a stored source cannot pass the public schema', async () => {
    const id = 'corrupt-queue-id';
    await prisma.simulationAllocationJob.create({
      data: { id, ...scope(), requestId: randomUUID(), createdById: actors[0] },
    });
    await expect(readAllocationJob(actors[0], id)).rejects.toThrow('could not be verified');
  });
  it('enqueue/retry/read leave academic data, resources, curriculum metadata and captures unchanged', async () => {
    await prisma.course.create({
      data: {
        id: courseId,
        code: `${prefix}-course`,
        name: 'Unchanged course',
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
    const before = await evidence();
    const input = body();
    const saved = await post(input);
    expect(saved.status).toBe(201);
    expect((await post(input)).status).toBe(200);
    expect((await get(saved.body.data.id)).status).toBe(200);
    expect(await evidence()).toEqual(before);
  });
});
