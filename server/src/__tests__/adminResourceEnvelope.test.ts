import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { SimulationResourceEnvelopeSchema } from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { readSimulationResourceEnvelope } from '../services/schoolResourceEnvelope';
import * as resourceService from '../services/schoolResources';

describe('school-admin shared simulation resource envelope (PostgreSQL)', () => {
  const prefix = `admin-envelope-${randomUUID()}`;
  const users = [randomUUID(), randomUUID()];
  const contexts = [randomUUID(), randomUUID(), randomUUID()];
  const course = randomUUID();
  const courseCode = `${prefix}-course`;
  const scope = (
    curriculumId = contexts[0],
    semester: 'FALL' | 'SPRING' | 'SUMMER' = 'FALL',
    year = 2026,
  ) => ({ curriculumId, semester, year });
  const cookie = (userId = users[0]) => `${AUTH_COOKIE_NAME}=${issueToken(userId)}`;
  const get = (query: Record<string, unknown> = scope(), userId = users[0]) =>
    request(app).get('/api/admin/resource-envelope').set('Cookie', cookie(userId)).query(query);
  const createResource = (
    courseOverrides: Prisma.InputJsonValue = {},
    resourceScope = scope(),
    professors = 2,
    classrooms = 3,
  ) =>
    prisma.schoolResource.create({
      data: {
        ...resourceScope,
        professors,
        classrooms,
        labRooms: 10,
        maxStudentsPerSection: 40,
        courseOverrides,
        revision: 1,
        updatedBy: users[0],
      },
    });
  const evidence = async () => ({
    resources: await prisma.schoolResource.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    users: await prisma.user.findMany({ where: { id: { in: users } }, orderBy: { id: 'asc' } }),
    courses: await prisma.course.findMany({ where: { id: course } }),
    contexts: await prisma.curriculum.findMany({
      where: { id: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    members: await prisma.curriculumCourse.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    records: await prisma.studentRecord.findMany({ where: { userId: users[1] } }),
    attempts: await prisma.gradeAttempt.findMany({ where: { userId: users[1] } }),
    ratings: await prisma.courseRating.findMany({ where: { userId: users[1] } }),
    plans: await prisma.studyPlan.findMany({
      where: { userId: users[1] },
      include: { semesters: true },
    }),
  });

  beforeAll(async () => {
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-context-${index}`,
        name: 'Shared simulation envelope reference',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
      })),
    });
    await prisma.course.create({
      data: {
        id: course,
        code: courseCode,
        name: 'Private fixture course',
        credits: 3,
        difficultyLevel: 2,
      },
    });
    await prisma.curriculumCourse.create({ data: { curriculumId: contexts[0], courseId: course } });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        email: `${id}@example.test`,
        name: 'Private envelope actor',
        passwordHash: 'Private envelope hash',
        role: index === 0 ? 'ADMIN' : 'STUDENT',
        curriculumId: index === 0 ? contexts[1] : contexts[0],
      })),
    });
    await prisma.studentRecord.create({
      data: {
        userId: users[1],
        courseId: course,
        status: 'COMPLETED',
        grade: 'Historical B+',
        gradePoints: 3.5,
        electiveGroup: 'Historical envelope claim',
      },
    });
    await prisma.gradeAttempt.create({
      data: { userId: users[1], courseId: course, requestId: randomUUID(), score: 91 },
    });
    await prisma.courseRating.create({ data: { userId: users[1], courseId: course, rating: 4 } });
    await prisma.studyPlan.create({
      data: {
        userId: users[1],
        name: 'Private cached envelope plan',
        semesters: {
          create: {
            semester: 'FALL',
            year: 2026,
            courses: [{ courseId: course, position: 0 }],
            totalCredits: 3,
            difficultyScore: 2,
          },
        },
      },
    });
  });
  beforeEach(async () => {
    await prisma.schoolResource.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.user.update({ where: { id: users[0] }, data: { role: 'ADMIN' } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: course } });
    await prisma.$disconnect();
  });

  it('requires an existing cookie-account administrator before reading any scenario', async () => {
    const before = await evidence();
    expect((await request(app).get('/api/admin/resource-envelope').query(scope())).status).toBe(
      401,
    );
    expect((await get(undefined, randomUUID())).status).toBe(401);
    expect((await get(undefined, users[1])).status).toBe(403);
    expect((await get({ ...scope(), role: 'ADMIN' }, users[1])).status).toBe(403);
    expect(await evidence()).toEqual(before);
  });

  it('revokes access for a previously issued admin cookie when the database role changes', async () => {
    const session = cookie();
    await prisma.user.update({ where: { id: users[0] }, data: { role: 'STUDENT' } });
    const before = await evidence();
    expect(
      (await request(app).get('/api/admin/resource-envelope').set('Cookie', session).query(scope()))
        .status,
    ).toBe(403);
    await expect(readSimulationResourceEnvelope(users[0], scope())).rejects.toMatchObject({
      status: 403,
    });
    expect(await evidence()).toEqual(before);
  });

  it('rechecks current actor role and existence in direct service calls', async () => {
    const before = await evidence();
    await expect(readSimulationResourceEnvelope(users[1], scope())).rejects.toMatchObject({
      status: 403,
    });
    await expect(readSimulationResourceEnvelope(randomUUID(), scope())).rejects.toMatchObject({
      status: 401,
    });
    expect(await evidence()).toEqual(before);
  });

  it('rejects role revocation after HTTP middleware authorization but before the resource read', async () => {
    await createResource();
    const before = await evidence();
    const originalRead = resourceService.readResources;
    const scheduledRead = jest
      .spyOn(resourceService, 'readResources')
      .mockImplementationOnce(async (actorId, input) => {
        // Middleware already accepted the real ADMIN row; the production reader must recheck it.
        await prisma.user.update({ where: { id: actorId }, data: { role: 'STUDENT' } });
        return originalRead(actorId, input);
      });
    try {
      const response = await get();
      expect(scheduledRead).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ success: false, error: 'Administrator access required' });
      const after = await evidence();
      expect(after.users.find((user) => user.id === users[0])?.role).toBe('STUDENT');
      expect({ ...after, users: before.users }).toEqual(before);
    } finally {
      scheduledRead.mockRestore();
    }
  });

  it('returns explicit unknown settings without inventing shared supply', async () => {
    const before = await evidence();
    const response = await get();
    expect(response.status).toBe(200);
    const snapshot = SimulationResourceEnvelopeSchema.parse(response.body.data);
    expect(snapshot).toMatchObject({
      kind: 'SIMULATION',
      usage: 'REFERENCE_ONLY',
      scope: scope(),
      scopeBasis: 'SCENARIO_ONLY',
      resourceRevision: null,
      resources: null,
      envelope: null,
      curriculum: {
        id: contexts[0],
        code: `${prefix}-context-0`,
        name: 'Shared simulation envelope reference',
        school: 'CSE',
      },
      policy: { classroomTimeBlocks: 1, sectionsPerProfessor: 1 },
    });
    expect(await evidence()).toEqual(before);
  });

  it('uses one shared classroom/staff ceiling despite large lab and course-specific counts', async () => {
    await createResource({
      [courseCode]: { capacity: 100000, professorCount: 100000 },
      HISTORICAL: { capacity: 100000 },
    });
    const response = await get();
    expect(response.status).toBe(200);
    const snapshot = SimulationResourceEnvelopeSchema.parse(response.body.data);
    expect(snapshot).toMatchObject({
      resourceRevision: 1,
      resources: { professors: 2, classrooms: 3, labRooms: 10, maxStudentsPerSection: 40 },
      envelope: {
        classroomSectionCeiling: 3,
        professorSectionCeiling: 2,
        sharedSectionCeiling: 2,
        sharedSeatCeiling: 80,
      },
      labSectionsModeled: false,
      courseOverridesApplied: false,
      allocationValidated: false,
      professorQualificationsValidated: false,
      crossCurriculumResourcesReconciled: false,
    });
    expect(snapshot).not.toHaveProperty('courses');
  });

  it('keeps configured zero inventory distinct from missing settings', async () => {
    await createResource({}, scope(), 0, 0);
    const response = await get();
    expect(response.status).toBe(200);
    expect(SimulationResourceEnvelopeSchema.parse(response.body.data)).toMatchObject({
      resourceRevision: 1,
      resources: { professors: 0, classrooms: 0 },
      envelope: {
        classroomSectionCeiling: 0,
        professorSectionCeiling: 0,
        sharedSectionCeiling: 0,
        sharedSeatCeiling: 0,
      },
    });
  });

  it('isolates curriculum, semester and year without using the admin account assignment', async () => {
    await createResource({}, scope(), 2, 3);
    await createResource({}, scope(contexts[1]), 4, 5);
    await createResource({}, scope(contexts[0], 'SPRING'), 6, 7);
    await createResource({}, scope(contexts[0], 'FALL', 2027), 8, 9);
    const before = await evidence();
    for (const [input, seats] of [
      [scope(), 80],
      [scope(contexts[1]), 160],
      [scope(contexts[0], 'SPRING'), 240],
      [scope(contexts[0], 'FALL', 2027), 320],
    ] as const) {
      const response = await get(input);
      expect(response.status).toBe(200);
      const result = SimulationResourceEnvelopeSchema.parse(response.body.data);
      expect(result.scope).toEqual(input);
      expect(result.envelope?.sharedSeatCeiling).toBe(seats);
    }
    expect((await get(scope(contexts[0], 'SUMMER'))).body.data.envelope).toBeNull();
    expect(await evidence()).toEqual(before);
  });

  it('reads an empty curriculum resource scenario without fabricating membership or course supply', async () => {
    await createResource({ HISTORICAL: { capacity: 100000 } }, scope(contexts[2]));
    const before = await evidence();
    const response = await get(scope(contexts[2]));
    expect(response.status).toBe(200);
    const result = SimulationResourceEnvelopeSchema.parse(response.body.data);
    expect(result.scope.curriculumId).toBe(contexts[2]);
    expect(result.envelope?.sharedSeatCeiling).toBe(80);
    expect(result).not.toHaveProperty('courses');
    expect(await evidence()).toEqual(before);
  });

  it('normalizes uppercase scope UUIDs in both route and direct service calls', async () => {
    await createResource();
    const upper = { ...scope(), curriculumId: contexts[0].toUpperCase() };
    const response = await get(upper);
    expect(response.status).toBe(200);
    const result = SimulationResourceEnvelopeSchema.parse(response.body.data);
    expect(result.scope).toEqual(scope());
    expect(result.curriculum.id).toBe(contexts[0]);
    expect(await readSimulationResourceEnvelope(users[0], upper)).toEqual(result);
  });

  it('reports valid unknown curriculum scopes without creating or assigning them', async () => {
    const before = await evidence();
    const unknown = scope(randomUUID());
    expect((await get(unknown)).status).toBe(404);
    await expect(readSimulationResourceEnvelope(users[0], unknown)).rejects.toMatchObject({
      status: 404,
    });
    expect(await evidence()).toEqual(before);
  });

  it.each([
    {},
    { curriculumId: contexts[0], semester: 'FALL' },
    { ...scope(), curriculumId: 'invalid' },
    { ...scope(), curriculumId: [contexts[0], contexts[1]] },
    { ...scope(), semester: ['FALL', 'SPRING'] },
    { ...scope(), semester: 'WINTER' },
    { ...scope(), year: '2026.0' },
    { ...scope(), year: '26' },
    { ...scope(), year: '1999' },
    { ...scope(), year: '2101' },
    { ...scope(), year: ['2026', '2027'] },
    { ...scope(), userId: users[1] },
    { ...scope(), classroomTimeBlocks: '10' },
    { ...scope(), sectionsPerProfessor: '10' },
    { ...scope(), policy: { classroomTimeBlocks: 10 } },
    { ...scope(), professors: '100' },
    { ...scope(), resourceRevision: '1' },
  ])('rejects malformed or policy-overriding strict query %# without writes', async (query) => {
    const before = await evidence();
    expect((await get(query)).status).toBe(400);
    expect(await evidence()).toEqual(before);
  });

  it.each([courseCode, 'HISTORICAL'])(
    'fails closed on invalid ignored persisted override %s',
    async (code) => {
      await createResource({ [code]: { capacity: -1 } });
      const before = await evidence();
      await expect(readSimulationResourceEnvelope(users[0], scope())).rejects.toThrow();
      const response = await get();
      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body).not.toHaveProperty('details');
      expect(JSON.stringify(response.body)).not.toContain(code);
      expect(await evidence()).toEqual(before);
    },
  );

  it('exposes only reference aggregates and preserves histories, plans, settings and assignments', async () => {
    await createResource({ [courseCode]: { capacity: 1 } });
    const before = await evidence();
    const response = await get();
    expect(response.status).toBe(200);
    SimulationResourceEnvelopeSchema.parse(response.body.data);
    const serialized = JSON.stringify(response.body);
    for (const id of [...users, course]) expect(serialized).not.toContain(id);
    for (const privateField of [
      'passwordHash',
      'email',
      'studentId',
      'gradePoints',
      'electiveGroup',
      'updatedBy',
      'createdAt',
      'updatedAt',
      '"courseOverrides":',
      'Private envelope',
      'Historical envelope',
    ])
      expect(serialized).not.toContain(privateField);
    expect(await evidence()).toEqual(before);
  });

  it('keeps default reader authorization and resource revision in one real repeatable-read snapshot', async () => {
    await createResource();
    const originalTransaction = prisma.$transaction.bind(prisma);
    let committedWriter = false;
    const scheduledTransaction = jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce((read, options) =>
        originalTransaction(async (tx) => {
          const originalActorRead = tx.user.findUnique.bind(tx.user);
          // Narrow only the awaited contract so the scheduler need not implement Prisma's
          // unrelated fluent relation methods; every actor result still comes from PostgreSQL.
          const actorReader: {
            findUnique: (input: Parameters<typeof tx.user.findUnique>[0]) => PromiseLike<unknown>;
          } = tx.user;
          const scheduledActorRead = jest
            .spyOn(actorReader, 'findUnique')
            .mockImplementationOnce(async (input) => {
              const actor = await originalActorRead(input);
              // The real actor SELECT establishes the reader snapshot before this writer commits.
              await originalTransaction(async (write) => {
                await write.schoolResource.update({
                  where: { curriculumId_semester_year: scope() },
                  data: { revision: 2, professors: 5, classrooms: 6, maxStudentsPerSection: 50 },
                });
                await write.user.update({ where: { id: users[0] }, data: { role: 'STUDENT' } });
              });
              committedWriter = true;
              return actor;
            });
          try {
            return await read(tx);
          } finally {
            scheduledActorRead.mockRestore();
          }
        }, options),
      );
    try {
      const result = await readSimulationResourceEnvelope(users[0], scope());
      expect(committedWriter).toBe(true);
      expect(scheduledTransaction).toHaveBeenCalledTimes(1);
      expect(scheduledTransaction.mock.calls[0][1]).toMatchObject({
        isolationLevel: 'RepeatableRead',
      });
      expect(result).toMatchObject({
        resourceRevision: 1,
        resources: { professors: 2, classrooms: 3, maxStudentsPerSection: 40 },
        envelope: { sharedSectionCeiling: 2, sharedSeatCeiling: 80 },
      });
    } finally {
      scheduledTransaction.mockRestore();
    }
    await expect(readSimulationResourceEnvelope(users[0], scope())).rejects.toMatchObject({
      status: 403,
    });
    await prisma.user.update({ where: { id: users[0] }, data: { role: 'ADMIN' } });
    expect(await readSimulationResourceEnvelope(users[0], scope())).toMatchObject({
      resourceRevision: 2,
      resources: { professors: 5, classrooms: 6, maxStudentsPerSection: 50 },
      envelope: { sharedSectionCeiling: 5, sharedSeatCeiling: 250 },
    });
  });
});
