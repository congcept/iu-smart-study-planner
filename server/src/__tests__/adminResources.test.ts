import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { readResources, upsertResources } from '../services/schoolResources';

describe('school-admin simulated resource settings (PostgreSQL)', () => {
  const prefix = `admin-resource-${randomUUID()}`;
  const users = [randomUUID(), randomUUID(), randomUUID()];
  const contexts = [randomUUID(), randomUUID()];
  const courses = [randomUUID(), randomUUID(), randomUUID()];
  const codes = courses.map((_id, index) => `${prefix}-${index}`);
  const resourceScope = (
    curriculumId = contexts[0],
    semester: 'FALL' | 'SPRING' | 'SUMMER' = 'FALL',
    year = 2026,
  ) => ({
    curriculumId,
    semester,
    year,
  });
  const payload = (expectedRevision = 0) => ({
    ...resourceScope(),
    professors: 2,
    classrooms: 3,
    labRooms: 1,
    maxStudentsPerSection: 40,
    courseOverrides: { [codes[0]]: { capacity: 20, professorCount: 1 } },
    expectedRevision,
  });
  const cookie = (userId = users[0]) => `${AUTH_COOKIE_NAME}=${issueToken(userId)}`;
  const read = (
    query: Record<string, unknown> = { ...resourceScope(), year: '2026' },
    userId = users[0],
  ) => request(app).get('/api/admin/resources').set('Cookie', cookie(userId)).query(query);
  const write = (body: unknown = payload(), userId = users[0]) =>
    request(app)
      .post('/api/admin/resources')
      .set('Cookie', cookie(userId))
      .send(body as Record<string, unknown>);
  const create = async (body: unknown = payload()) => {
    const response = await write(body);
    expect(response.status).toBe(201);
    return response.body.data;
  };
  const evidence = async () => ({
    resources: await prisma.schoolResource.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    users: await prisma.user.findMany({ where: { id: { in: users } }, orderBy: { id: 'asc' } }),
    courses: await prisma.course.findMany({
      where: { id: { in: courses } },
      orderBy: { id: 'asc' },
    }),
    records: await prisma.studentRecord.findMany({
      where: { userId: { in: users } },
      orderBy: { id: 'asc' },
    }),
    attempts: await prisma.gradeAttempt.findMany({
      where: { userId: { in: users } },
      orderBy: { id: 'asc' },
    }),
    memberships: await prisma.curriculumCourse.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
  });
  beforeAll(async () => {
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-context-${index}`,
        name: 'Simulated admin resource context',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
      })),
    });
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: codes[index],
        name: 'Simulated resource course',
        credits: 3,
        difficultyLevel: 2,
      })),
    });
    await prisma.curriculumCourse.createMany({
      data: [
        { curriculumId: contexts[0], courseId: courses[0] },
        { curriculumId: contexts[0], courseId: courses[1] },
        { curriculumId: contexts[1], courseId: courses[2] },
      ],
    });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        email: `${id}@example.test`,
        name: 'Simulated resource actor',
        role: index < 2 ? 'ADMIN' : 'STUDENT',
        curriculumId: index === 0 ? contexts[1] : contexts[0],
        passwordHash: 'Private fixture hash',
      })),
    });
    await prisma.studentRecord.create({
      data: {
        userId: users[2],
        courseId: courses[0],
        status: 'COMPLETED',
        grade: 'A',
        gradePoints: 4,
        electiveGroup: 'Preserve claim',
      },
    });
    await prisma.gradeAttempt.create({
      data: { userId: users[2], courseId: courses[0], requestId: randomUUID(), score: 91 },
    });
  });
  beforeEach(async () => {
    await prisma.schoolResource.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.user.update({ where: { id: users[0] }, data: { role: 'ADMIN' } });
    await prisma.curriculumCourse.upsert({
      where: { curriculumId_courseId: { curriculumId: contexts[0], courseId: courses[0] } },
      create: { curriculumId: contexts[0], courseId: courses[0] },
      update: {},
    });
  });
  afterAll(async () => {
    await prisma.schoolResource.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
    await prisma.$disconnect();
  });

  it('requires current admin sessions before either read or write and cannot use a spoofed role', async () => {
    const before = await evidence();
    expect((await request(app).get('/api/admin/resources').query(resourceScope())).status).toBe(
      401,
    );
    expect((await request(app).post('/api/admin/resources').send(payload())).status).toBe(401);
    expect((await read(undefined, randomUUID())).status).toBe(401);
    expect((await read(undefined, users[2])).status).toBe(403);
    expect((await write({ ...payload(), role: 'ADMIN' }, users[2])).status).toBe(403);
    expect(await evidence()).toEqual(before);
  });

  it('reads the current database role for a preexisting admin cookie', async () => {
    const session = cookie();
    await prisma.user.update({ where: { id: users[0] }, data: { role: 'STUDENT' } });
    expect(
      (await request(app).get('/api/admin/resources').set('Cookie', session).query(resourceScope()))
        .status,
    ).toBe(403);
    expect(
      (await request(app).post('/api/admin/resources').set('Cookie', session).send(payload()))
        .status,
    ).toBe(403);
    expect(await prisma.schoolResource.count({ where: { curriculumId: { in: contexts } } })).toBe(
      0,
    );
  });

  it('rechecks current role and actor existence inside the resource services', async () => {
    const before = await evidence();
    await expect(readResources(users[2], resourceScope())).rejects.toMatchObject({ status: 403 });
    await expect(upsertResources(users[2], payload())).rejects.toMatchObject({ status: 403 });
    await expect(readResources(randomUUID(), resourceScope())).rejects.toMatchObject({
      status: 401,
    });
    await expect(upsertResources(randomUUID(), payload())).rejects.toMatchObject({ status: 401 });
    expect(await evidence()).toEqual(before);
  });

  it('returns explicit absent simulated settings with minimal curriculum identity', async () => {
    const before = await evidence();
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        kind: 'SIMULATION',
        curriculum: {
          id: contexts[0],
          code: `${prefix}-context-0`,
          name: 'Simulated admin resource context',
          school: 'CSE',
        },
        semester: 'FALL',
        year: 2026,
        resource: null,
      },
    });
    expect(await evidence()).toEqual(before);
  });

  it('creates and updates a stable resource identity using server actor audit and increasing revisions', async () => {
    const initial = await create();
    expect(initial.kind).toBe('SIMULATION');
    expect(Object.keys(initial).sort()).toEqual([
      'curriculum',
      'kind',
      'resource',
      'semester',
      'year',
    ]);
    expect(Object.keys(initial.resource).sort()).toEqual(
      [
        'id',
        'curriculumId',
        'semester',
        'year',
        'professors',
        'classrooms',
        'labRooms',
        'maxStudentsPerSection',
        'courseOverrides',
        'revision',
        'updatedBy',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(initial.resource).toMatchObject({
      curriculumId: contexts[0],
      semester: 'FALL',
      year: 2026,
      professors: 2,
      classrooms: 3,
      labRooms: 1,
      maxStudentsPerSection: 40,
      courseOverrides: payload().courseOverrides,
      revision: 1,
      updatedBy: users[0],
    });
    expect(initial.resource).not.toHaveProperty('expectedRevision');
    expect(Number.isNaN(Date.parse(initial.resource.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(initial.resource.updatedAt))).toBe(false);
    const updated = await write(
      {
        ...payload(1),
        professors: 5,
        courseOverrides: { [codes[1]]: { capacity: 0, professorCount: 0 } },
      },
      users[1],
    );
    expect(updated.status).toBe(200);
    expect(updated.body.data.resource).toMatchObject({
      id: initial.resource.id,
      revision: 2,
      updatedBy: users[1],
      professors: 5,
      courseOverrides: { [codes[1]]: { capacity: 0, professorCount: 0 } },
      createdAt: initial.resource.createdAt,
    });
    expect((await read()).body.data).toEqual(updated.body.data);
    expect(JSON.stringify(updated.body)).not.toContain('Private fixture');
    expect(JSON.stringify(updated.body)).not.toContain('passwordHash');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: users[0] } })).curriculumId).toBe(
      contexts[1],
    );
  });

  it('isolates settings by curriculum, semester and calendar year', async () => {
    await create();
    await create({ ...payload(), curriculumId: contexts[1], courseOverrides: {} });
    await create({ ...payload(), semester: 'SPRING', courseOverrides: {} });
    await create({ ...payload(), year: 2027, courseOverrides: {} });
    expect(await prisma.schoolResource.count({ where: { curriculumId: { in: contexts } } })).toBe(
      4,
    );
    expect((await read({ ...resourceScope(), semester: 'SUMMER' })).body.data.resource).toBeNull();
    const rows = await prisma.schoolResource.findMany({
      where: { curriculumId: { in: contexts } },
    });
    expect(new Set(rows.map((row) => row.id)).size).toBe(4);
  });

  it('normalizes uppercase context UUIDs without changing course-code spelling', async () => {
    const created = await create({ ...payload(), curriculumId: contexts[0].toUpperCase() });
    expect(created.resource.curriculumId).toBe(contexts[0]);
    expect(
      (await read({ ...resourceScope(), curriculumId: contexts[0].toUpperCase() })).body.data
        .resource.id,
    ).toBe(created.resource.id);
    const before = await evidence();
    expect(
      (
        await write({
          ...payload(1),
          courseOverrides: { [codes[0].toUpperCase()]: { capacity: 2 } },
        })
      ).status,
    ).toBe(400);
    expect(await evidence()).toEqual(before);
  });

  it('allows zero simulated resources and unplaced current-member course overrides', async () => {
    expect(
      await prisma.curriculumPlacement.count({
        where: { curriculumCourse: { curriculumId: contexts[0] } },
      }),
    ).toBe(0);
    const data = await create({
      ...payload(),
      professors: 0,
      classrooms: 0,
      labRooms: 0,
      maxStudentsPerSection: 1,
      courseOverrides: { [codes[1]]: { capacity: 0, professorCount: 0 } },
    });
    expect(data.resource).toMatchObject({
      professors: 0,
      classrooms: 0,
      labRooms: 0,
      maxStudentsPerSection: 1,
      courseOverrides: { [codes[1]]: { capacity: 0, professorCount: 0 } },
    });
  });

  it('accepts empty override records as a full replacement without removing the resource scope', async () => {
    await create();
    const response = await write({ ...payload(1), courseOverrides: {} });
    expect(response.status).toBe(200);
    expect(response.body.data.resource).toMatchObject({ revision: 2, courseOverrides: {} });
  });

  it.each([0, 2])(
    'rejects outdated or future expected revision %s without partial writes',
    async (expectedRevision) => {
      await create();
      const before = await evidence();
      expect((await write({ ...payload(expectedRevision), professors: 99 })).status).toBe(409);
      expect(await evidence()).toEqual(before);
    },
  );

  it('rejects exhausted revisions without an integer overflow or partial update', async () => {
    const initial = await create();
    await prisma.schoolResource.update({
      where: { id: initial.resource.id },
      data: { revision: 2147483647 },
    });
    const before = await evidence();
    expect((await write(payload(2147483647))).status).toBe(409);
    expect(await evidence()).toEqual(before);
  });

  it('requires revision zero for an absent row and does not create from an update revision', async () => {
    const before = await evidence();
    expect((await write(payload(1))).status).toBe(409);
    expect(await evidence()).toEqual(before);
  });

  it('returns only one winner for concurrent creation at expected revision zero', async () => {
    const responses = await Promise.all([
      write({ ...payload(), professors: 8 }),
      write({ ...payload(), professors: 9 }),
    ]);
    expect(responses.filter(({ status }) => status === 201)).toHaveLength(1);
    expect(responses.filter(({ status }) => status === 409)).toHaveLength(1);
    const row = await prisma.schoolResource.findFirstOrThrow({ where: resourceScope() });
    expect(row.revision).toBe(1);
    expect([8, 9]).toContain(row.professors);
    expect(await prisma.schoolResource.count({ where: resourceScope() })).toBe(1);
  });

  it('returns only one winner for concurrent updates using the same current revision', async () => {
    const initial = await create();
    const responses = await Promise.all([
      write({ ...payload(1), professors: 8 }),
      write({ ...payload(1), professors: 9 }),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    const row = await prisma.schoolResource.findUniqueOrThrow({
      where: { id: initial.resource.id },
    });
    expect(row.revision).toBe(2);
    expect([8, 9]).toContain(row.professors);
    const winner = responses.find(({ status }) => status === 200)!;
    expect(row.professors).toBe(winner.body.data.resource.professors);
  });

  it.each([
    {},
    { curriculumId: contexts[0], semester: 'FALL' },
    { curriculumId: contexts[0], year: '2026' },
    { semester: 'FALL', year: '2026' },
    { ...resourceScope(), year: '26' },
    { ...resourceScope(), year: '2026.0' },
    { ...resourceScope(), year: '0199' },
    { ...resourceScope(), year: '2101' },
    { ...resourceScope(), year: ['2026', '2027'] },
    { ...resourceScope(), curriculumId: [contexts[0], contexts[1]] },
    { ...resourceScope(), semester: ['FALL', 'SPRING'] },
    { ...resourceScope(), semester: 'WINTER' },
    { ...resourceScope(), curriculumId: 'invalid' },
    { ...resourceScope(), professors: 2 },
    { ...resourceScope(), expectedRevision: 0 },
  ])('rejects malformed or overriding strict read query %# without writes', async (query) => {
    const before = await evidence();
    expect((await read(query)).status).toBe(400);
    expect(await evidence()).toEqual(before);
  });

  it.each([
    { professors: -1 },
    { professors: 1.5 },
    { professors: 100001 },
    { classrooms: '3' },
    { classrooms: 100001 },
    { labRooms: -1 },
    { maxStudentsPerSection: 0 },
    { maxStudentsPerSection: 100001 },
    { year: 1999 },
    { year: 2101 },
    { year: 2026.5 },
    { semester: 'WINTER' },
    { curriculumId: 'invalid' },
    { expectedRevision: -1 },
    { expectedRevision: 1.5 },
    { expectedRevision: 2147483648 },
    { updatedBy: users[1] },
    { revision: 8 },
    { kind: 'REAL' },
    { extra: true },
    { courseOverrides: { [codes[0]]: {} } },
    { courseOverrides: { [codes[0]]: { capacity: -1 } } },
    { courseOverrides: { [codes[0]]: { capacity: 100001 } } },
    { courseOverrides: { [codes[0]]: { professorCount: 100001 } } },
    { courseOverrides: { [codes[0]]: { capacity: 2, extra: true } } },
    { courseOverrides: { [`${codes[0]} `]: { capacity: 2 } } },
    { courseOverrides: { constructor: { capacity: 2 } } },
    { courseOverrides: { prototype: { capacity: 2 } } },
    { courseOverrides: JSON.parse('{"__proto__":{"capacity":2}}') },
    { courseOverrides: { [codes[2]]: { capacity: 2 } } },
    { courseOverrides: { 'UNKNOWN-CODE': { capacity: 2 } } },
    {
      courseOverrides: Object.fromEntries(
        Array.from({ length: 501 }, (_, index) => [`COURSE-${index}`, { capacity: 2 }]),
      ),
    },
  ])(
    'rejects malformed or unowned write fields %# before storing any settings',
    async (invalid) => {
      const before = await evidence();
      expect((await write({ ...payload(), ...invalid })).status).toBe(400);
      expect(await evidence()).toEqual(before);
    },
  );

  it('requires the complete replacement fields and mandatory revision in every POST', async () => {
    const before = await evidence();
    for (const field of [
      'professors',
      'classrooms',
      'labRooms',
      'maxStudentsPerSection',
      'courseOverrides',
      'expectedRevision',
    ]) {
      const incomplete: Record<string, unknown> = { ...payload() };
      delete incomplete[field];
      expect((await write(incomplete)).status).toBe(400);
    }
    expect(await evidence()).toEqual(before);
  });

  it('reports an unknown curriculum on valid read/write scopes without creating or assigning it', async () => {
    const before = await evidence();
    const curriculumId = randomUUID();
    expect((await read({ ...resourceScope(), curriculumId })).status).toBe(404);
    expect((await write({ ...payload(), curriculumId, courseOverrides: {} })).status).toBe(404);
    expect(await evidence()).toEqual(before);
  });

  it('preserves historical override codes in reads after membership removal and rejects invalid replacement', async () => {
    const initial = await create();
    await prisma.curriculumCourse.delete({
      where: { curriculumId_courseId: { curriculumId: contexts[0], courseId: courses[0] } },
    });
    const before = await evidence();
    expect((await read()).body.data.resource).toEqual(initial.resource);
    expect((await write(payload(1))).status).toBe(400);
    expect(await evidence()).toEqual(before);
    expect((await write({ ...payload(1), courseOverrides: {} })).status).toBe(200);
  });

  it.each([
    { professors: -1 },
    { classrooms: 100001 },
    { labRooms: -1 },
    { maxStudentsPerSection: 0 },
    { year: 1999 },
    { revision: 0 },
    { courseOverrides: [] },
  ])('enforces database constraints for bypassed invalid stored fields %j', async (invalid) => {
    const created = await create();
    const before = await evidence();
    await expect(
      prisma.schoolResource.update({ where: { id: created.resource.id }, data: invalid }),
    ).rejects.toBeDefined();
    expect(await evidence()).toEqual(before);
  });

  it('retains the resource snapshot with null audit identity after its own updating admin is deleted', async () => {
    const disposableAdmin = randomUUID();
    await prisma.user.create({
      data: {
        id: disposableAdmin,
        studentId: `${prefix}-${disposableAdmin}`,
        email: `${disposableAdmin}@example.test`,
        name: 'Disposable simulated resource actor',
        role: 'ADMIN',
      },
    });
    try {
      const response = await write(payload(), disposableAdmin);
      expect(response.status).toBe(201);
      const initial = response.body.data.resource;
      expect(initial.updatedBy).toBe(disposableAdmin);
      await prisma.user.delete({ where: { id: disposableAdmin } });
      const current = await read();
      expect(current.status).toBe(200);
      expect(current.body.data.resource).toMatchObject({ ...initial, updatedBy: null });
    } finally {
      await prisma.user.deleteMany({ where: { id: disposableAdmin } });
    }
  });

  it('preserves student histories, course metadata and actor assignments through settings reads/writes', async () => {
    const before = await evidence();
    await create();
    expect((await read()).status).toBe(200);
    const after = await evidence();
    expect(after.users).toEqual(before.users);
    expect(after.courses).toEqual(before.courses);
    expect(after.records).toEqual(before.records);
    expect(after.attempts).toEqual(before.attempts);
    expect(after.memberships).toEqual(before.memberships);
  });
});
