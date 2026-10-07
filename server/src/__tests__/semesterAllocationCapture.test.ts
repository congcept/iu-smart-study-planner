import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import {
  OwnSemesterAllocationRunV1Schema,
  SemesterAllocationResultV1Schema,
  SemesterAllocationRunV1Schema,
  type CreateSemesterAllocationRunDTO,
  type SemesterAllocationRunV1DTO,
} from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import config from '../config';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { captureSemesterAllocationRun } from '../services/semesterAllocationCapture';

describe('explicit semester simulation capture and protected reads (PostgreSQL)', () => {
  const prefix = `semester-capture-${randomUUID()}`;
  const administrators = [randomUUID(), randomUUID()];
  const students = [randomUUID(), randomUUID(), randomUUID()];
  const users = [...administrators, ...students];
  const contexts = [randomUUID(), randomUUID()];
  const courses = [randomUUID(), randomUUID(), randomUUID()];
  const original = {
    demand: config.cohortDemandPolicy,
    envelope: config.simulationResourcePolicy,
    allocation: config.simulationAllocationPolicy,
    utility: config.allocationUtilityPolicy,
  };
  let afterMiddlewareActorRead: (() => Promise<void>) | undefined;
  let afterTransactionalActorRead: (() => Promise<void>) | undefined;
  let afterScopedHistoryRead: (() => Promise<void>) | undefined;
  let afterRunCreate: (() => Promise<void>) | undefined;
  let afterParticipantsCreate: (() => Promise<void>) | undefined;
  let cohortReads = 0;
  let runReads = 0;
  const scope = () => ({ curriculumId: contexts[0], semester: 'FALL' as const, year: 2026 });
  const input = (
    requestId = randomUUID(),
    actorId = administrators[0],
  ): CreateSemesterAllocationRunDTO => ({
    ...scope(),
    requestId,
    expectedActorId: actorId,
  });
  const cookie = (actorId: string) => `${AUTH_COOKIE_NAME}=${issueToken(actorId)}`;
  const post = (body: object = input(), actorId = administrators[0]) =>
    request(app)
      .post('/api/admin/semester-allocation-runs')
      .set('Cookie', cookie(actorId))
      .send(body);
  const getAdmin = (id: string, actorId = administrators[0]) =>
    request(app).get(`/api/admin/semester-allocation-runs/${id}`).set('Cookie', cookie(actorId));
  const getOwn = (id: string, actorId = students[0]) =>
    request(app).get(`/api/users/me/semester-allocation-runs/${id}`).set('Cookie', cookie(actorId));
  const save = (body = input(), actorId = administrators[0]) =>
    captureSemesterAllocationRun(actorId, body);
  const counts = async () => ({
    runs: await prisma.simulationSemesterRun.count({ where: { curriculumId: { in: contexts } } }),
    participants: await prisma.simulationSemesterParticipant.count({
      where: { run: { curriculumId: { in: contexts } } },
    }),
  });
  const source = async () => ({
    users: await prisma.user.findMany({ where: { id: { in: users } }, orderBy: { id: 'asc' } }),
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
    oldRuns: await prisma.simulationAllocationRun.findMany({
      where: { curriculumId: { in: contexts } },
    }),
    oldJobs: await prisma.simulationAllocationJob.findMany({
      where: { curriculumId: { in: contexts } },
    }),
  });
  const clean = async () => {
    await prisma.simulationSemesterParticipant.deleteMany({
      where: { run: { curriculumId: { in: contexts } } },
    });
    await prisma.simulationSemesterRun.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
  };
  const resetHooks = () => {
    afterMiddlewareActorRead = undefined;
    afterTransactionalActorRead = undefined;
    afterScopedHistoryRead = undefined;
    afterRunCreate = undefined;
    afterParticipantsCreate = undefined;
    cohortReads = 0;
    runReads = 0;
  };
  const checkPublic = (run: SemesterAllocationRunV1DTO) => {
    expect(SemesterAllocationRunV1Schema.parse(run)).toEqual(run);
    const serialized = JSON.stringify(run);
    for (const id of [...users]) expect(serialized).not.toContain(id);
    for (const key of [
      '"studentId":',
      '"students":',
      '"candidates":',
      '"assignments":',
      '"input":',
      '"studentUtility":',
      'requestId',
      'createdById',
      'passwordHash',
      'email',
      'gradePoints',
      'Private historic grade',
      'Private plan',
    ])
      expect(serialized).not.toContain(key);
  };

  beforeAll(() => {
    // Hooks observe completed real PostgreSQL operations; no Prisma result is replaced.
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (
        params.model === 'User' &&
        params.action === 'findUnique' &&
        params.args?.where?.id === administrators[0]
      ) {
        if (!params.runInTransaction && afterMiddlewareActorRead) {
          const hook = afterMiddlewareActorRead;
          afterMiddlewareActorRead = undefined;
          await hook();
        } else if (params.runInTransaction && afterTransactionalActorRead) {
          const hook = afterTransactionalActorRead;
          afterTransactionalActorRead = undefined;
          await hook();
        }
      }
      if (
        params.runInTransaction &&
        params.model === 'User' &&
        params.action === 'count' &&
        params.args?.where?.curriculumId === contexts[0]
      )
        cohortReads++;
      if (
        params.runInTransaction &&
        params.model === 'SimulationSemesterRun' &&
        params.action === 'findUnique'
      )
        runReads++;
      if (
        params.runInTransaction &&
        params.model === 'StudentRecord' &&
        params.action === 'findMany'
      ) {
        const selected: unknown = params.args?.where?.userId?.in;
        if (Array.isArray(selected) && selected.includes(students[0]) && afterScopedHistoryRead) {
          const hook = afterScopedHistoryRead;
          afterScopedHistoryRead = undefined;
          await hook();
        }
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
        afterParticipantsCreate
      ) {
        const hook = afterParticipantsCreate;
        afterParticipantsCreate = undefined;
        await hook();
      }
      return result;
    });
  });
  beforeEach(async () => {
    resetHooks();
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
        code: `${prefix}-context-${index}`,
        name: 'Captured reference',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/semester-capture',
        isGpaPath: false,
      })),
    });
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-course-${index}`,
        name: `Captured course ${index}`,
        credits: 3,
        difficultyLevel: 2,
        semesterOffered: [],
      })),
    });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-user-${index}`,
        email: `${id}@example.test`,
        name: `Private captured actor ${index}`,
        passwordHash: 'Private unused hash',
        role: index < 2 ? 'ADMIN' : 'STUDENT',
        curriculumId: index === 4 ? contexts[1] : contexts[0],
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
    await prisma.studentRecord.createMany({
      data: students.slice(0, 2).flatMap((userId) =>
        courses.map((courseId) => ({
          userId,
          courseId,
          status: 'PLANNED' as const,
          grade: 'Private historic grade',
          gradePoints: 3.5,
          semester: 'Fall 2001',
          year: 2001,
        })),
      ),
    });
    await prisma.studentRecord.create({
      data: { userId: students[2], courseId: courses[0], status: 'PLANNED' },
    });
    await prisma.schoolResource.create({
      data: {
        ...scope(),
        professors: 3,
        classrooms: 3,
        labRooms: 9,
        maxStudentsPerSection: 2,
        revision: 1,
        updatedBy: administrators[0],
      },
    });
    await prisma.studyPlan.create({
      data: {
        userId: students[0],
        name: 'Private plan',
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
  });
  afterEach(async () => {
    resetHooks();
    await clean();
  });
  afterAll(async () => {
    config.cohortDemandPolicy = original.demand;
    config.simulationResourcePolicy = original.envelope;
    config.simulationAllocationPolicy = original.allocation;
    config.allocationUtilityPolicy = original.utility;
    await prisma.$disconnect();
  });

  it('captures server-derived choices and exact private outcomes atomically without changing academic sources', async () => {
    const before = await source();
    const body = input();
    const response = await post(body);
    expect(response.status).toBe(201);
    const run = SemesterAllocationRunV1Schema.parse(response.body.data);
    checkPublic(run);
    expect(run).toMatchObject({
      snapshotStored: true,
      simulationAssignmentsStored: true,
      result: {
        kind: 'SIMULATION',
        usage: 'REFERENCE_ONLY',
        model: 'SEMESTER_CREDIT_BUDGET_V1',
        studentCount: 2,
        assignedStudentCount: 2,
        assignedCourseCount: 4,
        totalTargetCredits: 12,
        totalAssignedCredits: 12,
        totalRemainingCredits: 0,
        eligibilityValidated: false,
        allocationValidated: false,
        timetableValidated: false,
        academicPlansChanged: false,
      },
    });
    const stored = await prisma.simulationSemesterRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { participants: true },
    });
    const result = SemesterAllocationResultV1Schema.parse(stored.result);
    expect(stored.createdById).toBe(administrators[0]);
    expect(stored.requestId).toBe(body.requestId);
    expect(result.input.students.map((student) => student.studentId).sort()).toEqual(
      students.slice(0, 2).sort(),
    );
    expect(result.input.students.every((student) => student.targetCredits === 6)).toBe(true);
    expect(stored.participants).toHaveLength(2);
    for (const participant of stored.participants) {
      expect(participant.userId).toBe(participant.capturedStudentId);
      expect(participant.result).toEqual(
        result.students.find((student) => student.studentId === participant.userId),
      );
    }
    expect(await counts()).toEqual({ runs: 1, participants: 2 });
    expect(await source()).toEqual(before);
  });

  it('recovers the exact existing request and returns the same aggregate through either administrator read', async () => {
    const body = input();
    const first = await post(body);
    const replay = await post(body);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(first.body.data);
    const run = SemesterAllocationRunV1Schema.parse(first.body.data);
    for (const actorId of administrators) {
      const response = await getAdmin(run.id, actorId);
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(run);
      checkPublic(response.body.data);
    }
    expect(await counts()).toEqual({ runs: 1, participants: 2 });
  });

  it('returns only each live owner outcome and captured assigned course credits', async () => {
    const saved = await save();
    const stored = await prisma.simulationSemesterRun.findUniqueOrThrow({
      where: { id: saved.run.id },
    });
    const privateResult = SemesterAllocationResultV1Schema.parse(stored.result);
    for (const actorId of students.slice(0, 2)) {
      const response = await getOwn(saved.run.id, actorId);
      expect(response.status).toBe(200);
      const own = OwnSemesterAllocationRunV1Schema.parse(response.body.data);
      const outcome = privateResult.students.find((student) => student.studentId === actorId);
      expect(outcome).toBeDefined();
      expect(own.result).toEqual({
        targetCredits: outcome?.targetCredits,
        courseIds: outcome?.courseIds,
        assignedCredits: outcome?.assignedCredits,
        remainingCredits: outcome?.remainingCredits,
        reason: outcome?.reason,
      });
      expect(own.courses).toEqual(
        own.result.courseIds.map((courseId) => ({ courseId, credits: 3 })),
      );
      const serialized = JSON.stringify(own);
      for (const id of users) expect(serialized).not.toContain(id);
      for (const key of [
        '"studentId":',
        '"students":',
        '"input":',
        '"assignments":',
        '"candidates":',
        'requestId',
        'createdById',
        '"envelope":',
        '"policy":',
      ])
        expect(serialized).not.toContain(key);
    }
  });

  it('conceals existing and nonexistent run IDs equally from nonparticipants, including administrators', async () => {
    const saved = await save();
    for (const actorId of [students[2], ...administrators]) {
      const existing = await getOwn(saved.run.id, actorId);
      const missing = await getOwn(randomUUID(), actorId);
      expect(existing.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(existing.body).toEqual(missing.body);
    }
  });

  it('keeps an owner receipt readable after a role or current curriculum change', async () => {
    const saved = await save();
    const before = await getOwn(saved.run.id);
    await prisma.user.update({
      where: { id: students[0] },
      data: { role: 'ADMIN', curriculumId: contexts[1] },
    });
    const after = await getOwn(saved.run.id);
    expect(after.status).toBe(200);
    expect(after.body.data).toEqual(before.body.data);
  });

  it.each(['unauthenticated', 'missing account', 'student'] as const)(
    'rejects %s admin capture and read requests',
    async (kind) => {
      const saved = await save();
      const actorId = kind === 'missing account' ? randomUUID() : students[0];
      const create =
        kind === 'unauthenticated'
          ? await request(app).post('/api/admin/semester-allocation-runs').send(input())
          : await post(input(randomUUID(), actorId), actorId);
      const read =
        kind === 'unauthenticated'
          ? await request(app).get(`/api/admin/semester-allocation-runs/${saved.run.id}`)
          : await getAdmin(saved.run.id, actorId);
      expect(create.status).toBe(kind === 'student' ? 403 : 401);
      expect(read.status).toBe(kind === 'student' ? 403 : 401);
      expect(await counts()).toEqual({ runs: 1, participants: 2 });
    },
  );

  it.each(['unauthenticated', 'missing account'] as const)(
    'requires a current account for %s owner reads',
    async (kind) => {
      const saved = await save();
      const response =
        kind === 'unauthenticated'
          ? await request(app).get(`/api/users/me/semester-allocation-runs/${saved.run.id}`)
          : await getOwn(saved.run.id, randomUUID());
      expect(response.status).toBe(401);
    },
  );

  it.each(['capture', 'read'] as const)(
    'rejects a role demoted after authentication before %s authorization',
    async (kind) => {
      const saved = kind === 'read' ? await save() : undefined;
      afterMiddlewareActorRead = async () => {
        await prisma.user.update({ where: { id: administrators[0] }, data: { role: 'STUDENT' } });
      };
      const response = saved ? await getAdmin(saved.run.id) : await post();
      expect(response.status).toBe(403);
      expect(cohortReads).toBe(saved ? 1 : 0);
      expect(await counts()).toEqual({ runs: saved ? 1 : 0, participants: saved ? 2 : 0 });
    },
  );

  it('holds the current administrator role through source capture and commit', async () => {
    afterTransactionalActorRead = async () => {
      // This is a separate real writer with a bounded lock deadline. The capture has
      // already authorized the actor but has not read the cohort or created a run.
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '50ms'");
          await tx.$executeRaw(
            Prisma.sql`UPDATE users SET role = 'STUDENT' WHERE id = ${administrators[0]}`,
          );
        }),
      ).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } });
    };
    const saved = await save();
    expect(saved.created).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: administrators[0] } })).role).toBe(
      'ADMIN',
    );
    expect((await getAdmin(saved.run.id)).status).toBe(200);
    expect(await counts()).toEqual({ runs: 1, participants: 2 });
  });

  it('returns safe missing curriculum and run errors without creating a partial capture', async () => {
    expect((await post({ ...input(), curriculumId: randomUUID() })).status).toBe(404);
    expect((await getAdmin(randomUUID())).status).toBe(404);
    expect(await counts()).toEqual({ runs: 0, participants: 0 });
  });

  it('checks the expected signed-in administrator before looking up an existing retry key', async () => {
    const body = input();
    await save(body);
    runReads = 0;
    cohortReads = 0;
    const response = await post({ ...body, expectedActorId: administrators[1] });
    expect(response.status).toBe(409);
    expect(runReads).toBe(0);
    expect(cohortReads).toBe(0);
    expect(await counts()).toEqual({ runs: 1, participants: 2 });
  });

  it.each([
    { requestId: 'not-a-uuid' },
    { expectedActorId: undefined },
    { year: 1999 },
    { students: [{ studentId: students[0], targetCredits: 30 }] },
    { result: { assignedStudentCount: 500 } },
    { policy: { studentUtilityWeight: 1 } },
    { curriculumId: `${contexts[0]}\n` },
  ])('rejects invalid preconditions and participant or score uploads %#', async (override) => {
    const response = await post({ ...input(), ...override });
    expect(response.status).toBe(400);
    expect(await counts()).toEqual({ runs: 0, participants: 0 });
  });

  it('rejects query overrides on capture and cross-origin writes', async () => {
    expect((await post().query({ studentId: students[0] })).status).toBe(400);
    expect((await post().set('Origin', 'https://untrusted.example.test')).status).toBe(403);
    expect(await counts()).toEqual({ runs: 0, participants: 0 });
  });

  it.each(['admin', 'own'] as const)(
    'rejects malformed IDs and query or body overrides on %s reads',
    async (kind) => {
      const saved = await save();
      const get = kind === 'admin' ? getAdmin : getOwn;
      expect((await get('not-a-uuid')).status).toBe(400);
      expect((await get(`${saved.run.id}%0A`)).status).toBe(400);
      expect((await get(saved.run.id).query({ studentId: students[0] })).status).toBe(400);
      expect((await get(saved.run.id).send({ userId: students[0] })).status).toBe(400);
    },
  );

  it('normalizes UUIDs consistently for save, retry and protected reads', async () => {
    const body = input();
    const upper = Object.fromEntries(
      Object.entries(body).map(([key, value]) => [
        key,
        typeof value === 'string' && key !== 'semester' ? value.toUpperCase() : value,
      ]),
    );
    const first = await post(upper);
    expect(first.status).toBe(201);
    const run = SemesterAllocationRunV1Schema.parse(first.body.data);
    expect((await post(body)).body.data).toEqual(run);
    expect((await getAdmin(run.id.toUpperCase())).body.data).toEqual(run);
    expect((await getOwn(run.id.toUpperCase())).status).toBe(200);
    expect(await counts()).toEqual({ runs: 1, participants: 2 });
  });

  it('refuses to reuse an existing key in another semester or year', async () => {
    const body = input();
    await save(body);
    for (const override of [
      { semester: 'SPRING' },
      { year: 2027 },
      { curriculumId: contexts[1] },
    ]) {
      const response = await post({ ...body, ...override });
      expect(response.status).toBe(409);
    }
    expect(await counts()).toEqual({ runs: 1, participants: 2 });
  });

  it('isolates the same retry key between administrators', async () => {
    const key = randomUUID();
    const first = await save(input(key));
    const second = await save(input(key, administrators[1]), administrators[1]);
    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.run.id).not.toBe(first.run.id);
    expect(second.run.result).toEqual(first.run.result);
    expect((await save(input(key))).run).toEqual(first.run);
    expect(await counts()).toEqual({ runs: 2, participants: 4 });
  });

  it('recovers a saved request before consulting invalid current policy or a changed cohort', async () => {
    const body = input();
    const first = await save(body);
    config.cohortDemandPolicy = { maxCredits: 31, maxDifficulty: 5 };
    await prisma.user.updateMany({
      where: { id: { in: students.slice(0, 2) } },
      data: { curriculumId: contexts[1] },
    });
    cohortReads = 0;
    const replay = await post(body);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(first.run);
    expect(cohortReads).toBe(0);
    expect((await post(input())).status).toBe(500);
    expect(await counts()).toEqual({ runs: 1, participants: 2 });
  });

  it('captures later source changes only under a new request and preserves historical course credits', async () => {
    const body = input();
    const first = await save(body);
    const ownerBefore = await getOwn(first.run.id);
    config.cohortDemandPolicy = { maxCredits: 9, maxDifficulty: 5 };
    await prisma.course.update({ where: { id: courses[0] }, data: { credits: 4 } });
    await prisma.schoolResource.update({
      where: { curriculumId_semester_year: scope() },
      data: { revision: 2, classrooms: 1, professors: 1 },
    });
    const second = await save();
    expect(second.created).toBe(true);
    expect(second.run.id).not.toBe(first.run.id);
    expect(second.run.result.totalTargetCredits).toBe(18);
    expect(second.run.result.envelope.resourceRevision).toBe(2);
    expect(
      second.run.result.courses.find((course) => course.courseId === courses[0])?.credits,
    ).toBe(4);
    expect((await save(body)).run).toEqual(first.run);
    expect((await getAdmin(first.run.id)).body.data).toEqual(first.run);
    expect((await getOwn(first.run.id)).body.data).toEqual(ownerBefore.body.data);
    expect(await counts()).toEqual({ runs: 2, participants: 4 });
  });

  it('deduplicates concurrent captures of one exact request and verifies both completed responses', async () => {
    const body = input();
    const responses = await Promise.all([post(body), post(body)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(responses[0].body.data).toEqual(responses[1].body.data);
    checkPublic(SemesterAllocationRunV1Schema.parse(responses[0].body.data));
    expect(await counts()).toEqual({ runs: 1, participants: 2 });
  });

  it.each(['run', 'participants'] as const)(
    'rolls back an actual %s insertion fault and safely retries the exact request',
    async (stage) => {
      const body = input();
      const before = await source();
      const fail = async () => {
        throw new Error('Private insertion failure must not reach HTTP');
      };
      if (stage === 'run') afterRunCreate = fail;
      else afterParticipantsCreate = fail;
      const failed = await post(body);
      expect(failed.status).toBe(500);
      expect(JSON.stringify(failed.body)).not.toContain('Private insertion failure');
      expect(await counts()).toEqual({ runs: 0, participants: 0 });
      expect(await source()).toEqual(before);
      const retried = await post(body);
      expect(retried.status).toBe(201);
      expect((await post(body)).body.data).toEqual(retried.body.data);
      expect(await counts()).toEqual({ runs: 1, participants: 2 });
      expect(await source()).toEqual(before);
    },
  );

  it('keeps course and resource values coherent when a committed writer changes both after the snapshot starts', async () => {
    afterTransactionalActorRead = async () => {
      await prisma.$transaction([
        prisma.course.update({ where: { id: courses[0] }, data: { credits: 4 } }),
        prisma.schoolResource.update({
          where: { curriculumId_semester_year: scope() },
          data: { revision: 2, classrooms: 1, professors: 1 },
        }),
      ]);
    };
    const saved = await save();
    const credit = saved.run.result.courses.find(
      (course) => course.courseId === courses[0],
    )?.credits;
    const revision = saved.run.result.envelope.resourceRevision;
    const professors = saved.run.result.envelope.resources?.professors;
    expect([
      [3, 1, 3],
      [4, 2, 1],
    ]).toContainEqual([credit, revision, professors]);
    const current = await save();
    expect(
      current.run.result.courses.find((course) => course.courseId === courses[0])?.credits,
    ).toBe(4);
    expect(current.run.result.envelope.resourceRevision).toBe(2);
    expect(await counts()).toEqual({ runs: 2, participants: 4 });
  });

  it('retries a concurrent cohort reassignment before storing any stale participant access', async () => {
    afterScopedHistoryRead = async () => {
      await prisma.user.update({ where: { id: students[1] }, data: { curriculumId: contexts[1] } });
    };
    const saved = await save();
    expect(saved.run.result.studentCount).toBe(1);
    const rows = await prisma.simulationSemesterParticipant.findMany({
      where: { runId: saved.run.id },
    });
    expect(rows.map((row) => row.userId)).toEqual([students[0]]);
    expect((await getOwn(saved.run.id, students[1])).status).toBe(404);
    expect(await counts()).toEqual({ runs: 1, participants: 1 });
  });

  it('persists unknown-resource outcomes honestly without inventing assignments', async () => {
    await prisma.schoolResource.delete({ where: { curriculumId_semester_year: scope() } });
    const saved = await save();
    expect(saved.run.result).toMatchObject({
      studentCount: 2,
      assignedStudentCount: 0,
      assignedCourseCount: 0,
      totalTargetCredits: 12,
      totalAssignedCredits: 0,
      totalRemainingCredits: 12,
      stopReasonCounts: { RESOURCE_UNKNOWN: 2 },
      envelope: { resources: null },
    });
    const own = await getOwn(saved.run.id);
    expect(OwnSemesterAllocationRunV1Schema.parse(own.body.data).result).toEqual({
      targetCredits: 6,
      courseIds: [],
      assignedCredits: 0,
      remainingCredits: 6,
      reason: 'RESOURCE_UNKNOWN',
    });
    expect(await counts()).toEqual({ runs: 1, participants: 2 });
  });

  it('persists an empty cohort without participant rows or granting owner access', async () => {
    await prisma.user.updateMany({
      where: { id: { in: students.slice(0, 2) } },
      data: { curriculumId: contexts[1] },
    });
    const saved = await save();
    expect(saved.run.result).toMatchObject({
      studentCount: 0,
      assignedStudentCount: 0,
      assignedCourseCount: 0,
      totalTargetCredits: 0,
      totalAssignedCredits: 0,
    });
    expect(await counts()).toEqual({ runs: 1, participants: 0 });
    expect((await getOwn(saved.run.id)).status).toBe(404);
  });

  it('retains a no-choice participant receipt instead of silently dropping the student', async () => {
    await prisma.studentRecord.updateMany({
      where: { userId: students[0] },
      data: { status: 'COMPLETED' },
    });
    const saved = await save();
    expect(saved.run.result.studentCount).toBe(2);
    const response = await getOwn(saved.run.id);
    expect(response.status).toBe(200);
    expect(OwnSemesterAllocationRunV1Schema.parse(response.body.data).result).toEqual({
      targetCredits: 6,
      courseIds: [],
      assignedCredits: 0,
      remainingCredits: 6,
      reason: 'NO_REMAINING_CHOICES',
    });
  });

  it('fails closed for authorized reads and retries when one captured child is missing', async () => {
    const body = input();
    const saved = await save(body);
    await prisma.simulationSemesterParticipant.delete({
      where: { runId_userId: { runId: saved.run.id, userId: students[1] } },
    });
    for (const response of [
      await getAdmin(saved.run.id),
      await getOwn(saved.run.id),
      await post(body),
    ]) {
      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body)).not.toContain('Stored semester simulation');
      for (const id of users) expect(JSON.stringify(response.body)).not.toContain(id);
    }
    expect((await getOwn(saved.run.id, students[1])).status).toBe(404);
    expect((await getOwn(saved.run.id, students[2])).status).toBe(404);
    expect(await counts()).toEqual({ runs: 1, participants: 1 });
  });

  it('revokes a deleted owner through the live FK even if the same captured UUID is recreated', async () => {
    const body = input();
    const saved = await save(body);
    const otherOwner = await getOwn(saved.run.id, students[1]);
    await prisma.user.delete({ where: { id: students[0] } });
    expect((await getOwn(saved.run.id)).status).toBe(401);
    const captured = await prisma.simulationSemesterParticipant.findUniqueOrThrow({
      where: { runId_capturedStudentId: { runId: saved.run.id, capturedStudentId: students[0] } },
    });
    expect(captured.userId).toBeNull();
    expect(captured.capturedStudentId).toBe(students[0]);
    await prisma.user.create({
      data: {
        id: students[0],
        studentId: `${prefix}-recreated`,
        email: `${students[0]}@example.test`,
        name: 'Recreated account',
        role: 'STUDENT',
        curriculumId: contexts[0],
      },
    });
    expect((await getOwn(saved.run.id)).status).toBe(404);
    expect((await getOwn(saved.run.id, students[1])).body.data).toEqual(otherOwner.body.data);
    expect((await getAdmin(saved.run.id)).body.data).toEqual(saved.run);
    expect((await save(body)).run).toEqual(saved.run);
    expect(await counts()).toEqual({ runs: 1, participants: 2 });
  });
});
