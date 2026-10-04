import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { SimulationCapacitySnapshotSchema } from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import * as demandService from '../services/schoolDemand';
import { readSimulationCapacity } from '../services/schoolSupply';

describe('school-admin explicit simulated capacity snapshots (PostgreSQL)', () => {
  const prefix = `admin-capacity-${randomUUID()}`;
  const users = Array.from({ length: 8 }, () => randomUUID());
  const contexts = Array.from({ length: 4 }, () => randomUUID());
  const courses = Array.from({ length: 5 }, () => randomUUID());
  const codes = courses.map((_id, index) => `${prefix}-${index}`);
  const memberships = Array.from({ length: 4 }, () => randomUUID());
  const scope = (
    curriculumId = contexts[0],
    semester: 'FALL' | 'SPRING' | 'SUMMER' = 'FALL',
    year = 2026,
  ) => ({ curriculumId, semester, year });
  const cookie = (userId = users[0]) => `${AUTH_COOKIE_NAME}=${issueToken(userId)}`;
  const get = (query: Record<string, unknown> = scope(), userId = users[0]) =>
    request(app).get('/api/admin/capacity').set('Cookie', cookie(userId)).query(query);
  const createResource = (
    courseOverrides: Prisma.InputJsonValue = {},
    resourceScope = scope(),
    revision = 1,
  ) =>
    prisma.schoolResource.create({
      data: {
        ...resourceScope,
        professors: 2,
        classrooms: 3,
        labRooms: 1,
        maxStudentsPerSection: 40,
        courseOverrides,
        revision,
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
    members: await prisma.curriculumCourse.findMany({
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
        name: 'Reference-only capacity scenario',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
      })),
    });
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: codes[index],
        name: `Capacity reference course ${index}`,
        credits: 3,
        difficultyLevel: 2,
        semesterOffered: [],
      })),
    });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        email: `${id}@example.test`,
        name: 'Private capacity student',
        passwordHash: 'Private capacity hash',
        role: index === 0 || index === 4 ? 'ADMIN' : 'STUDENT',
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
      data: [0, 1, 2, 4].map((course, index) => ({
        id: memberships[index],
        curriculumId: contexts[0],
        courseId: courses[course],
      })),
    });
    await prisma.curriculumCourse.createMany({
      data: [
        { curriculumId: contexts[1], courseId: courses[3] },
        { curriculumId: contexts[3], courseId: courses[4] },
      ],
    });
    await prisma.curriculumPlacement.createMany({
      data: [0, 1].map((sourceOrder) => ({
        curriculumCourseId: memberships[0],
        sourceOrder,
        electiveGroup: `Reference group ${sourceOrder}`,
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
        [1, 0],
        [1, 1],
        [1, 3],
        [2, 0],
        [2, 2],
        [3, 3],
        [4, 0],
        [5, 0],
        [6, 0],
        [6, 3],
        [7, 3],
      ].map(([user, course]) => ({
        userId: users[user],
        courseId: courses[course],
        status: 'PLANNED',
        semester: 'Historical term',
        year: 2001,
        grade: 'Historical B+',
        gradePoints: 3.5,
        electiveGroup: 'Historical claim',
      })),
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
    await prisma.$disconnect();
  });

  it('requires a current ADMIN cookie and rejects spoofed roles before reading', async () => {
    const before = await evidence();
    expect((await request(app).get('/api/admin/capacity').query(scope())).status).toBe(401);
    expect((await get(scope(), randomUUID())).status).toBe(401);
    expect((await get({ ...scope(), role: 'ADMIN' }, users[1])).status).toBe(403);
    expect(await evidence()).toEqual(before);
  });
  it('rejects an existing cookie after database role revocation and rechecks direct service actors', async () => {
    const session = cookie();
    await expect(readSimulationCapacity(randomUUID(), scope())).rejects.toMatchObject({
      status: 401,
    });
    await expect(readSimulationCapacity(users[1], scope())).rejects.toMatchObject({ status: 403 });
    await prisma.user.update({ where: { id: users[0] }, data: { role: 'STUDENT' } });
    expect(
      (await request(app).get('/api/admin/capacity').set('Cookie', session).query(scope())).status,
    ).toBe(403);
    await expect(readSimulationCapacity(users[0], scope())).rejects.toMatchObject({ status: 403 });
  });
  it('retains unknown capacity when no resources exist with the original scoped selection limitations', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const snapshot = SimulationCapacitySnapshotSchema.parse(response.body.data);
    expect(snapshot).toMatchObject({
      kind: 'SIMULATION',
      usage: 'REFERENCE_ONLY',
      model: 'EXPLICIT_COURSE_CAPACITY_ONLY',
      resources: null,
      classroomSeatProxy: null,
      ignoredNonmemberOverrideCount: 0,
      labClassificationAvailable: false,
      teachingLoadValidated: false,
      allocationValidated: false,
      plannedSelections: {
        scope: scope(),
        termBasis: 'SCENARIO_ONLY',
        recommendationDemandAvailable: false,
        eligibilityValidated: false,
        offeringValidationAvailable: false,
        resourceRevision: null,
        cohortStudentCount: 3,
        plannedStudentCount: 2,
        plannedSelectionCount: 4,
        ignoredNonmemberSelectionCount: 2,
      },
    });
    expect(snapshot.courses.map(({ id }) => id)).toEqual([
      courses[0],
      courses[1],
      courses[2],
      courses[4],
    ]);
    for (const course of snapshot.courses)
      expect(course).toMatchObject({
        declaredSeatCapacity: null,
        capacityBasis: 'UNSPECIFIED',
        plannedSelectionsPerDeclaredSeat: null,
        excessPlannedSelections: null,
      });
    expect(
      snapshot.plannedSelections.courses.map(({ plannedStudentCount }) => plannedStudentCount),
    ).toEqual([2, 1, 1, 0]);
    expect(
      snapshot.plannedSelections.courses.every(
        ({ supply, utilization }) => supply === null && utilization === null,
      ),
    ).toBe(true);
  });
  it('uses only absolute course overrides, distinguishing positive, zero and professor-only limits', async () => {
    await createResource({
      [codes[0]]: { capacity: 1, professorCount: 0 },
      [codes[1]]: { capacity: 0 },
      [codes[2]]: { professorCount: 1 },
      [codes[4]]: { capacity: 5 },
    });
    const snapshot = await readSimulationCapacity(users[0], scope());
    expect(snapshot.classroomSeatProxy).toEqual({
      basis: 'ONE_SIMULTANEOUS_CLASSROOM_SECTION_PER_ROOM',
      seats: 120,
    });
    expect(snapshot.courses).toEqual([
      {
        id: courses[0],
        code: codes[0],
        declaredSeatCapacity: 1,
        capacityBasis: 'EXPLICIT_COURSE_OVERRIDE',
        plannedSelectionsPerDeclaredSeat: 2,
        excessPlannedSelections: 1,
      },
      {
        id: courses[1],
        code: codes[1],
        declaredSeatCapacity: 0,
        capacityBasis: 'EXPLICIT_COURSE_OVERRIDE',
        plannedSelectionsPerDeclaredSeat: null,
        excessPlannedSelections: 1,
      },
      {
        id: courses[2],
        code: codes[2],
        declaredSeatCapacity: null,
        capacityBasis: 'UNSPECIFIED',
        plannedSelectionsPerDeclaredSeat: null,
        excessPlannedSelections: null,
      },
      {
        id: courses[4],
        code: codes[4],
        declaredSeatCapacity: 5,
        capacityBasis: 'EXPLICIT_COURSE_OVERRIDE',
        plannedSelectionsPerDeclaredSeat: 0,
        excessPlannedSelections: 0,
      },
    ]);
  });
  it('never converts classrooms, labs or professor inputs into per-course seats', async () => {
    await createResource({ [codes[0]]: { capacity: 1 }, [codes[2]]: { professorCount: 100000 } });
    const initial = await readSimulationCapacity(users[0], scope());
    await prisma.schoolResource.update({
      where: { curriculumId_semester_year: scope() },
      data: {
        classrooms: 100000,
        maxStudentsPerSection: 100000,
        professors: 0,
        labRooms: 100000,
        revision: 2,
      },
    });
    const latest = await readSimulationCapacity(users[0], scope());
    expect(latest.courses).toEqual(initial.courses);
    expect(latest.classroomSeatProxy?.seats).toBe(10000000000);
    expect(latest.resources).toEqual({
      professors: 0,
      classrooms: 100000,
      labRooms: 100000,
      maxStudentsPerSection: 100000,
    });
    expect(latest.plannedSelections.resourceRevision).toBe(2);
  });
  it('keeps current selections term-independent but isolates resource settings by the exact scenario', async () => {
    await createResource({ [codes[0]]: { capacity: 1 } }, scope(), 3);
    await createResource({ [codes[0]]: { capacity: 4 } }, scope(contexts[0], 'SPRING', 2027), 8);
    await createResource({ [codes[3]]: { capacity: 99 } }, scope(contexts[1]), 12);
    const fall = await readSimulationCapacity(users[0], scope());
    const spring = await readSimulationCapacity(users[0], scope(contexts[0], 'SPRING', 2027));
    const absent = await readSimulationCapacity(users[0], scope(contexts[0], 'SUMMER'));
    expect(fall.courses[0].declaredSeatCapacity).toBe(1);
    expect(spring.courses[0].declaredSeatCapacity).toBe(4);
    expect(spring.plannedSelections.resourceRevision).toBe(8);
    expect(spring.plannedSelections.courses).toEqual(fall.plannedSelections.courses);
    expect(absent.resources).toBeNull();
    expect(absent.courses.every(({ declaredSeatCapacity }) => declaredSeatCapacity === null)).toBe(
      true,
    );
  });
  it('ignores removed-member overrides without mutating historical resource settings', async () => {
    await createResource({ [codes[0]]: { capacity: 3 }, [codes[1]]: { capacity: 0 } });
    await prisma.curriculumCourse.delete({ where: { id: memberships[1] } });
    const before = await evidence();
    const snapshot = await readSimulationCapacity(users[0], scope());
    expect(snapshot.ignoredNonmemberOverrideCount).toBe(1);
    expect(snapshot.courses.map(({ id }) => id)).toEqual([courses[0], courses[2], courses[4]]);
    expect(snapshot.plannedSelections.ignoredNonmemberSelectionCount).toBe(3);
    expect(await evidence()).toEqual(before);
  });
  it('preserves explicit zero counts for unplaced members and empty cohorts without global fallback', async () => {
    await createResource({ [codes[4]]: { capacity: 0 } }, scope(contexts[3]));
    const noCohort = await readSimulationCapacity(users[0], scope(contexts[3]));
    expect(noCohort.plannedSelections).toMatchObject({
      cohortStudentCount: 0,
      plannedStudentCount: 0,
      plannedSelectionCount: 0,
    });
    expect(noCohort.courses).toEqual([
      {
        id: courses[4],
        code: codes[4],
        declaredSeatCapacity: 0,
        capacityBasis: 'EXPLICIT_COURSE_OVERRIDE',
        plannedSelectionsPerDeclaredSeat: null,
        excessPlannedSelections: 0,
      },
    ]);
    const emptyContext = await readSimulationCapacity(users[0], scope(contexts[2]));
    expect(emptyContext.courses).toEqual([]);
    expect(emptyContext.plannedSelections).toMatchObject({
      cohortStudentCount: 1,
      plannedStudentCount: 0,
      plannedSelectionCount: 0,
      ignoredNonmemberSelectionCount: 1,
    });
    const otherContext = await readSimulationCapacity(users[0], scope(contexts[1]));
    expect(otherContext.courses.map(({ id }) => id)).toEqual([courses[3]]);
    expect(otherContext.plannedSelections).toMatchObject({
      cohortStudentCount: 1,
      plannedStudentCount: 1,
      plannedSelectionCount: 1,
      ignoredNonmemberSelectionCount: 1,
    });
  });
  it('normalizes uppercase UUID scopes and rejects unknown curricula', async () => {
    const response = await get({ ...scope(), curriculumId: contexts[0].toUpperCase() });
    expect(response.status).toBe(200);
    expect(
      SimulationCapacitySnapshotSchema.parse(response.body.data).plannedSelections.scope,
    ).toEqual(scope());
    expect((await get(scope(randomUUID()))).status).toBe(404);
    await expect(readSimulationCapacity(users[0], scope(randomUUID()))).rejects.toMatchObject({
      status: 404,
    });
  });
  it.each([
    {},
    { ...scope(), year: '2026.0' },
    { ...scope(), year: '2101' },
    { ...scope(), year: ['2026', '2027'] },
    { ...scope(), curriculumId: [contexts[0], contexts[1]] },
    { ...scope(), semester: 'WINTER' },
    { ...scope(), userId: users[1] },
    { ...scope(), resourceRevision: 1 },
    { ...scope(), capacity: 10 },
  ])('rejects malformed or overriding query %# without writes', async (query) => {
    const before = await evidence();
    expect((await get(query)).status).toBe(400);
    expect(await evidence()).toEqual(before);
  });
  it.each([0, 3])(
    'fails closed on malformed persisted override JSON for course %s without exposing or repairing it',
    async (course) => {
      await createResource({ [codes[course]]: { capacity: -1 } });
      const before = await evidence();
      await expect(readSimulationCapacity(users[0], scope())).rejects.toThrow();
      const response = await get();
      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body).not.toHaveProperty('details');
      expect(JSON.stringify(response.body)).not.toContain(codes[course]);
      expect(await evidence()).toEqual(before);
    },
  );
  it('exposes aggregate diagnostics without private records or resource audit identity and writes nothing', async () => {
    await createResource({ [codes[0]]: { capacity: 1 } });
    const before = await evidence();
    const response = await get();
    expect(response.status).toBe(200);
    SimulationCapacitySnapshotSchema.parse(response.body.data);
    const serialized = JSON.stringify(response.body);
    for (const userId of users) expect(serialized).not.toContain(userId);
    for (const field of [
      'passwordHash',
      'email',
      'studentId',
      'gradePoints',
      'electiveGroup',
      'updatedBy',
      'Private capacity',
      'Historical claim',
    ])
      expect(serialized).not.toContain(field);
    expect(await evidence()).toEqual(before);
  });
  it('keeps actor, cohort, membership, selections and full resources in one real repeatable-read snapshot', async () => {
    await createResource({ [codes[0]]: { capacity: 1 }, [codes[1]]: { capacity: 0 } });
    await prisma.$transaction(
      async (tx) => {
        const initial = await readSimulationCapacity(users[0], scope(), tx);
        await prisma.$transaction(async (write) => {
          await write.user.update({ where: { id: users[2] }, data: { curriculumId: contexts[1] } });
          await write.studentRecord.update({
            where: { userId_courseId: { userId: users[1], courseId: courses[0] } },
            data: { status: 'DROPPED' },
          });
          await write.curriculumCourse.delete({ where: { id: memberships[1] } });
          await write.schoolResource.update({
            where: { curriculumId_semester_year: scope() },
            data: { revision: 2, classrooms: 4, courseOverrides: { [codes[0]]: { capacity: 10 } } },
          });
        });
        expect(await readSimulationCapacity(users[0], scope(), tx)).toEqual(initial);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000 },
    );
    const latest = await readSimulationCapacity(users[0], scope());
    expect(latest.plannedSelections).toMatchObject({
      cohortStudentCount: 2,
      plannedStudentCount: 0,
      plannedSelectionCount: 0,
      ignoredNonmemberSelectionCount: 3,
      resourceRevision: 2,
    });
    expect(latest.courses.map(({ id }) => id)).toEqual([courses[0], courses[2], courses[4]]);
    expect(latest.courses[0].declaredSeatCapacity).toBe(10);
    expect(latest.classroomSeatProxy?.seats).toBe(160);
  });
  it('keeps the default reader snapshot when an independent resource update commits between its reads', async () => {
    await createResource({ [codes[0]]: { capacity: 1 } });
    const originalRead = demandService.readPlannedDemand;
    const pausedRead = jest
      .spyOn(demandService, 'readPlannedDemand')
      .mockImplementationOnce(async (actorId, input, transaction) => {
        const selections = await originalRead(actorId, input, transaction);
        await prisma.schoolResource.update({
          where: { curriculumId_semester_year: scope() },
          data: { revision: 2, classrooms: 4, courseOverrides: { [codes[0]]: { capacity: 10 } } },
        });
        return selections;
      });
    try {
      const snapshot = await readSimulationCapacity(users[0], scope());
      expect(pausedRead).toHaveBeenCalledTimes(1);
      expect(snapshot.plannedSelections.resourceRevision).toBe(1);
      expect(snapshot.courses[0].declaredSeatCapacity).toBe(1);
      expect(snapshot.classroomSeatProxy?.seats).toBe(120);
    } finally {
      pausedRead.mockRestore();
    }
    const latest = await readSimulationCapacity(users[0], scope());
    expect(latest.plannedSelections.resourceRevision).toBe(2);
    expect(latest.courses[0].declaredSeatCapacity).toBe(10);
    expect(latest.classroomSeatProxy?.seats).toBe(160);
  });
});
