import { randomUUID } from 'node:crypto';
import { Prisma, type CourseStatus } from '@prisma/client';
import request from 'supertest';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { readPlannedDemand } from '../services/schoolDemand';

describe('school-admin planned-selection intent snapshots (PostgreSQL)', () => {
  const prefix = `admin-demand-${randomUUID()}`;
  const users = Array.from({ length: 9 }, () => randomUUID());
  const contexts = Array.from({ length: 4 }, () => randomUUID());
  const courses = Array.from({ length: 6 }, () => randomUUID());
  const codes = courses.map((_id, index) => `${prefix}-${index}`);
  const memberships = Array.from({ length: 4 }, () => randomUUID());
  const scope = (
    curriculumId = contexts[0],
    semester: 'FALL' | 'SPRING' | 'SUMMER' = 'FALL',
    year = 2026,
  ) => ({
    curriculumId,
    semester,
    year,
  });
  const cookie = (userId = users[0]) => `${AUTH_COOKIE_NAME}=${issueToken(userId)}`;
  const get = (query: Record<string, unknown> = scope(), userId = users[0]) =>
    request(app).get('/api/admin/demand').set('Cookie', cookie(userId)).query(query);
  const record = (user: number, course: number, status: CourseStatus = 'PLANNED') => ({
    userId: users[user],
    courseId: courses[course],
    status,
    grade: 'Historical B+',
    gradePoints: 3.5,
    electiveGroup: 'Historical claim',
  });
  const createResource = (resourceScope = scope(), revision = 1) =>
    prisma.schoolResource.create({
      data: {
        ...resourceScope,
        revision,
        professors: 2,
        classrooms: 3,
        labRooms: 1,
        maxStudentsPerSection: 40,
        courseOverrides: {},
        updatedBy: users[0],
      },
    });
  const evidence = async () => ({
    users: await prisma.user.findMany({ where: { id: { in: users } }, orderBy: { id: 'asc' } }),
    courses: await prisma.course.findMany({
      where: { id: { in: courses } },
      orderBy: { id: 'asc' },
    }),
    contexts: await prisma.curriculum.findMany({
      where: { id: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    memberships: await prisma.curriculumCourse.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    placements: await prisma.curriculumPlacement.findMany({
      where: { curriculumCourse: { curriculumId: { in: contexts } } },
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
    resources: await prisma.schoolResource.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
  });
  beforeAll(async () => {
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-context-${index}`,
        name: 'Reference-only simulated cohort',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
      })),
    });
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: codes[index],
        name: `Simulated intent course ${index}`,
        credits: 3,
        difficultyLevel: 2,
        semesterOffered: [],
        academicYear: 4,
        academicSemester: 2,
      })),
    });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        email: `${id}@example.test`,
        name: 'Private simulated student',
        passwordHash: 'Private fixture hash',
        role: index === 0 || index === 4 ? 'ADMIN' : 'STUDENT',
        curriculumId:
          index === 5
            ? null
            : index === 0 || index === 6
              ? contexts[1]
              : index === 7
                ? contexts[2]
                : contexts[0],
      })),
    });
    await prisma.gradeAttempt.create({
      data: { userId: users[1], courseId: courses[0], requestId: randomUUID(), score: 91 },
    });
  });
  beforeEach(async () => {
    await prisma.schoolResource.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.curriculumCourse.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.curriculumCourse.createMany({
      data: [0, 1, 2, 5].map((course, index) => ({
        id: memberships[index],
        curriculumId: contexts[0],
        courseId: courses[course],
      })),
    });
    await prisma.curriculumCourse.create({
      data: { curriculumId: contexts[1], courseId: courses[4] },
    });
    await prisma.curriculumPlacement.createMany({
      data: [0, 1].map((sourceOrder) => ({
        curriculumCourseId: memberships[0],
        sourceOrder,
        academicYear: sourceOrder + 1,
        academicSemester: 1,
        electiveGroup: `Group ${sourceOrder}`,
      })),
    });
    for (let index = 0; index < users.length; index++)
      await prisma.user.update({
        where: { id: users[index] },
        data: {
          role: index === 0 || index === 4 ? 'ADMIN' : 'STUDENT',
          curriculumId:
            index === 5
              ? null
              : index === 0 || index === 6
                ? contexts[1]
                : index === 7
                  ? contexts[2]
                  : contexts[0],
        },
      });
    await prisma.studentRecord.deleteMany({ where: { userId: { in: users } } });
    await prisma.studentRecord.createMany({
      data: [
        record(1, 0),
        { ...record(1, 1), semester: 'Fall 2001', year: 2001 },
        record(1, 3),
        record(1, 2, 'COMPLETED'),
        { ...record(2, 0), semester: 'Legacy unknown term', year: 2010 },
        record(2, 2),
        record(2, 3, 'FAILED'),
        record(3, 3),
        record(3, 2, 'IN_PROGRESS'),
        record(4, 0),
        record(5, 0),
        record(6, 0),
        record(6, 4),
        record(7, 3),
        record(8, 1, 'DROPPED'),
      ],
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
    await prisma.$disconnect();
  });

  it('requires a current ADMIN cookie before reading, with no spoofed actor or role', async () => {
    const before = await evidence();
    expect((await request(app).get('/api/admin/demand').query(scope())).status).toBe(401);
    expect((await get(scope(), randomUUID())).status).toBe(401);
    expect((await get({ ...scope(), role: 'ADMIN' }, users[1])).status).toBe(403);
    expect(await evidence()).toEqual(before);
  });
  it('rejects a preexisting admin cookie after database role revocation', async () => {
    const session = cookie();
    await prisma.user.update({ where: { id: users[0] }, data: { role: 'STUDENT' } });
    expect(
      (await request(app).get('/api/admin/demand').set('Cookie', session).query(scope())).status,
    ).toBe(403);
  });
  it('rechecks actor existence and current role inside direct service reads', async () => {
    const before = await evidence();
    await expect(readPlannedDemand(randomUUID(), scope())).rejects.toMatchObject({ status: 401 });
    await expect(readPlannedDemand(users[1], scope())).rejects.toMatchObject({ status: 403 });
    expect(await evidence()).toEqual(before);
    await prisma.user.update({ where: { id: users[0] }, data: { role: 'STUDENT' } });
    const revoked = await evidence();
    await expect(readPlannedDemand(users[0], scope())).rejects.toMatchObject({ status: 403 });
    expect(await evidence()).toEqual(revoked);
  });
  it('counts unique current-member selections and distinct assigned students with explicit limitations', async () => {
    const before = await evidence();
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        kind: 'SIMULATION',
        usage: 'REFERENCE_ONLY',
        scope: scope(),
        curriculum: {
          id: contexts[0],
          code: `${prefix}-context-0`,
          name: 'Reference-only simulated cohort',
          school: 'CSE',
        },
        planningBasis: 'CURRENT_PLANNED_SELECTIONS',
        termBasis: 'SCENARIO_ONLY',
        recommendationDemandAvailable: false,
        eligibilityValidated: false,
        offeringValidationAvailable: false,
        resourceRevision: null,
        cohortStudentCount: 4,
        plannedStudentCount: 2,
        plannedSelectionCount: 4,
        ignoredNonmemberSelectionCount: 2,
        courses: [0, 1, 2, 5].map((course) => ({
          id: courses[course],
          code: codes[course],
          name: `Simulated intent course ${course}`,
          plannedStudentCount: course === 0 ? 2 : course === 5 ? 0 : 1,
          supply: null,
          utilization: null,
        })),
      },
    });
    expect(await evidence()).toEqual(before);
  });
  it('counts repeated elective placements once and includes unplaced and zero-intent members', async () => {
    expect(
      await prisma.curriculumPlacement.count({ where: { curriculumCourseId: memberships[0] } }),
    ).toBe(2);
    expect(
      await prisma.curriculumPlacement.count({ where: { curriculumCourseId: memberships[2] } }),
    ).toBe(0);
    const snapshot = await readPlannedDemand(users[0], scope());
    expect(snapshot.courses).toHaveLength(4);
    expect(snapshot.courses.map(({ id }) => id)).toEqual([
      courses[0],
      courses[1],
      courses[2],
      courses[5],
    ]);
    expect(snapshot.courses.find(({ id }) => id === courses[0])?.plannedStudentCount).toBe(2);
    expect(snapshot.courses.find(({ id }) => id === courses[2])?.plannedStudentCount).toBe(1);
    expect(snapshot.courses.find(({ id }) => id === courses[5])?.plannedStudentCount).toBe(0);
  });
  it.each(['COMPLETED', 'IN_PROGRESS', 'FAILED', 'DROPPED'] as const)(
    'excludes status %s despite preserved grades and plans',
    async (status) => {
      await prisma.studentRecord.update({
        where: { userId_courseId: { userId: users[2], courseId: courses[2] } },
        data: { status },
      });
      const snapshot = await readPlannedDemand(users[0], scope());
      expect(snapshot.plannedSelectionCount).toBe(3);
      expect(snapshot.plannedStudentCount).toBe(2);
      expect(snapshot.courses.find(({ id }) => id === courses[2])?.plannedStudentCount).toBe(0);
    },
  );
  it('distinguishes ignored nonmember selections from students who planned a member', async () => {
    await prisma.studentRecord.updateMany({
      where: { userId: users[1], courseId: { in: [courses[0], courses[1]] } },
      data: { status: 'DROPPED' },
    });
    const snapshot = await readPlannedDemand(users[0], scope());
    expect(snapshot.cohortStudentCount).toBe(4);
    expect(snapshot.plannedStudentCount).toBe(1);
    expect(snapshot.plannedSelectionCount).toBe(2);
    expect(snapshot.ignoredNonmemberSelectionCount).toBe(2);
  });
  it('keeps term-independent selections while matching only the requested resource triplet', async () => {
    await createResource(scope(), 3);
    await createResource(scope(contexts[0], 'SPRING', 2027), 8);
    await createResource(scope(contexts[1]), 12);
    const fall = await readPlannedDemand(users[0], scope());
    const spring = await readPlannedDemand(users[0], scope(contexts[0], 'SPRING', 2027));
    const absent = await readPlannedDemand(users[0], scope(contexts[0], 'SUMMER', 2026));
    expect(fall.resourceRevision).toBe(3);
    expect(spring.resourceRevision).toBe(8);
    expect(absent.resourceRevision).toBeNull();
    expect(spring.courses).toEqual(fall.courses);
    expect(absent.courses).toEqual(fall.courses);
    expect(
      fall.courses.every(({ supply, utilization }) => supply === null && utilization === null),
    ).toBe(true);
  });
  it('does not borrow admin, unassigned or other-context plans and never falls back in empty contexts', async () => {
    const other = await readPlannedDemand(users[0], scope(contexts[1]));
    expect(other.cohortStudentCount).toBe(1);
    expect(other.plannedStudentCount).toBe(1);
    expect(other.plannedSelectionCount).toBe(1);
    expect(other.ignoredNonmemberSelectionCount).toBe(1);
    expect(other.courses.map(({ id }) => id)).toEqual([courses[4]]);
    const empty = await readPlannedDemand(users[0], scope(contexts[2]));
    expect(empty).toMatchObject({
      cohortStudentCount: 1,
      plannedStudentCount: 0,
      plannedSelectionCount: 0,
      ignoredNonmemberSelectionCount: 1,
      courses: [],
    });
    const noCohort = await readPlannedDemand(users[0], scope(contexts[3]));
    expect(noCohort).toMatchObject({
      cohortStudentCount: 0,
      plannedStudentCount: 0,
      plannedSelectionCount: 0,
      ignoredNonmemberSelectionCount: 0,
      courses: [],
    });
  });
  it('normalizes uppercase curriculum UUIDs and reports unknown curricula explicitly', async () => {
    expect(
      (await get({ ...scope(), curriculumId: contexts[0].toUpperCase() })).body.data.scope,
    ).toEqual(scope());
    expect((await get(scope(randomUUID()))).status).toBe(404);
    await expect(readPlannedDemand(users[0], scope(randomUUID()))).rejects.toMatchObject({
      status: 404,
    });
  });
  it.each([
    {},
    { curriculumId: contexts[0], semester: 'FALL' },
    { curriculumId: contexts[0], year: '2026' },
    { semester: 'FALL', year: '2026' },
    { ...scope(), year: '26' },
    { ...scope(), year: '2026.0' },
    { ...scope(), year: '1999' },
    { ...scope(), year: '2101' },
    { ...scope(), year: ['2026', '2027'] },
    { ...scope(), curriculumId: [contexts[0], contexts[1]] },
    { ...scope(), semester: ['FALL', 'SPRING'] },
    { ...scope(), semester: 'WINTER' },
    { ...scope(), curriculumId: 'invalid' },
    { ...scope(), userId: users[1] },
    { ...scope(), status: 'COMPLETED' },
    { ...scope(), role: 'ADMIN' },
    { ...scope(), resourceRevision: 1 },
    { ...scope(), semesterOffered: 'FALL' },
  ])('rejects malformed or overriding strict query %# without writes', async (query) => {
    const before = await evidence();
    expect((await get(query)).status).toBe(400);
    expect(await evidence()).toEqual(before);
  });
  it('validates direct inputs asynchronously before any read or write', async () => {
    const before = await evidence();
    await expect(readPlannedDemand(users[0], { ...scope(), year: 2026.5 })).rejects.toBeInstanceOf(
      Error,
    );
    expect(await evidence()).toEqual(before);
  });
  it.each([2000, 2100])(
    'accepts the bounded scenario year %s without changing intent counts',
    async (year) => {
      const response = await get(scope(contexts[0], 'SUMMER', year));
      expect(response.status).toBe(200);
      expect(response.body.data.scope).toEqual(scope(contexts[0], 'SUMMER', year));
      expect(response.body.data.plannedSelectionCount).toBe(4);
    },
  );
  it('reports malformed stored course metadata as a server failure, without exposing or rewriting it', async () => {
    await prisma.course.update({ where: { id: courses[0] }, data: { name: '' } });
    try {
      const before = await evidence();
      await expect(readPlannedDemand(users[0], scope())).rejects.toThrow(
        'Stored planned-selection metadata could not be verified',
      );
      const response = await get();
      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        success: false,
        error: 'Could not load planned-selection demand',
      });
      expect(response.body).not.toHaveProperty('details');
      expect(await evidence()).toEqual(before);
    } finally {
      await prisma.course.update({
        where: { id: courses[0] },
        data: { name: 'Simulated intent course 0' },
      });
    }
  });
  it('exposes only aggregate intent counts and course identity, without private records or audit details', async () => {
    await createResource();
    const before = await evidence();
    const response = await get();
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(response.body);
    for (const userId of users) expect(serialized).not.toContain(userId);
    for (const field of [
      'password',
      'passwordHash',
      'email',
      'studentId',
      'gradePoints',
      'electiveGroup',
      'updatedBy',
      'Private fixture',
      'Private simulated',
    ])
      expect(serialized).not.toContain(field);
    for (const course of response.body.data.courses)
      expect(Object.keys(course).sort()).toEqual([
        'code',
        'id',
        'name',
        'plannedStudentCount',
        'supply',
        'utilization',
      ]);
    expect(await evidence()).toEqual(before);
  });
  it('keeps cohort, selections, membership and resource revision in one real repeatable-read snapshot', async () => {
    await createResource();
    await prisma.$transaction(
      async (tx) => {
        const initial = await readPlannedDemand(users[0], scope(), tx);
        await prisma.$transaction(async (write) => {
          await write.user.update({ where: { id: users[2] }, data: { curriculumId: contexts[1] } });
          await write.studentRecord.update({
            where: { userId_courseId: { userId: users[1], courseId: courses[0] } },
            data: { status: 'DROPPED' },
          });
          await write.curriculumCourse.delete({ where: { id: memberships[1] } });
          await write.schoolResource.update({
            where: { curriculumId_semester_year: scope() },
            data: { revision: 2 },
          });
        });
        expect(await readPlannedDemand(users[0], scope(), tx)).toEqual(initial);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000 },
    );
    const latest = await readPlannedDemand(users[0], scope());
    expect(latest).toMatchObject({
      cohortStudentCount: 3,
      plannedStudentCount: 0,
      plannedSelectionCount: 0,
      ignoredNonmemberSelectionCount: 3,
      resourceRevision: 2,
    });
    expect(latest.courses.map(({ id }) => id)).toEqual([courses[0], courses[2], courses[5]]);
  });
});
