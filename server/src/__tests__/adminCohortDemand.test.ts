import { randomUUID } from 'node:crypto';
import { type CourseStatus } from '@prisma/client';
import request from 'supertest';
import { EligibleCohortDemandSnapshotSchema } from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { readEligibleCohortDemand } from '../services/eligibleCohortDemand';

describe('school-admin eligible cohort demand (PostgreSQL)', () => {
  const prefix = `cohort-demand-${randomUUID()}`;
  const users = Array.from({ length: 8 }, () => randomUUID());
  const contexts = Array.from({ length: 4 }, () => randomUUID());
  const courses = Array.from({ length: 7 }, () => randomUUID());
  const memberships = Array.from({ length: 7 }, () => randomUUID());
  const scope = (
    curriculumId = contexts[0],
    semester: 'FALL' | 'SPRING' | 'SUMMER' = 'FALL',
    year = 2026,
  ) => ({ curriculumId, semester, year });
  const cookie = (userId = users[0]) => `${AUTH_COOKIE_NAME}=${issueToken(userId)}`;
  const get = (query: Record<string, unknown> = scope(), userId = users[0]) =>
    request(app).get('/api/admin/cohort-demand').set('Cookie', cookie(userId)).query(query);
  const record = (user: number, course: number, status: CourseStatus = 'PLANNED') => ({
    userId: users[user],
    courseId: courses[course],
    status,
    grade: 'Historical B+',
    gradePoints: 3.5,
    electiveGroup: 'Historical claim',
    semester: 'Fall 2001',
    year: 2001,
  });
  let afterTransactionalActorRead: (() => Promise<void>) | undefined;
  let afterMiddlewareActorRead: (() => Promise<void>) | undefined;
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
    prerequisites: await prisma.curriculumPrerequisite.findMany({
      where: { curriculumId: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    globalPrerequisites: await prisma.prerequisite.findMany({
      where: { courseId: { in: courses } },
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
    ratings: await prisma.courseRating.findMany({
      where: { courseId: { in: courses } },
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
  });

  beforeAll(async () => {
    // Observe real queries without replacing Prisma or its transaction implementation.
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (
        params.model === 'User' &&
        params.action === 'findUnique' &&
        params.runInTransaction &&
        params.args?.where?.id === users[0] &&
        afterTransactionalActorRead
      ) {
        const write = afterTransactionalActorRead;
        afterTransactionalActorRead = undefined;
        await write();
      }
      if (
        params.model === 'User' &&
        params.action === 'findUnique' &&
        !params.runInTransaction &&
        params.args?.where?.id === users[0] &&
        afterMiddlewareActorRead
      ) {
        const write = afterMiddlewareActorRead;
        afterMiddlewareActorRead = undefined;
        await write();
      }
      return result;
    });
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-context-${index}`,
        name: 'Reference simulated cohort',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
        isGpaPath: index === 0,
      })),
    });
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: `Private-free course ${index}`,
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
    await prisma.prerequisite.create({
      data: { courseId: courses[0], prerequisiteId: courses[3], isStrict: true },
    });
    const plan = await prisma.studyPlan.create({
      data: { userId: users[1], name: 'Historical cached plan' },
    });
    await prisma.plannedSemester.create({
      data: {
        studyPlanId: plan.id,
        semester: 'FALL',
        year: 2001,
        courses: [{ courseId: courses[3], position: 0 }],
        totalCredits: 19,
        difficultyScore: 4.2,
      },
    });
  });

  beforeEach(async () => {
    afterTransactionalActorRead = undefined;
    afterMiddlewareActorRead = undefined;
    await prisma.gradeAttempt.deleteMany({ where: { userId: { in: users } } });
    await prisma.studentRecord.deleteMany({ where: { userId: { in: users } } });
    await prisma.curriculumCourse.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.curriculumCourse.createMany({
      data: [0, 1, 2, 4, 5, 6].map((index) => ({
        id: memberships[index],
        curriculumId: contexts[0],
        courseId: courses[index],
      })),
    });
    await prisma.curriculumCourse.create({
      data: { curriculumId: contexts[1], courseId: courses[3] },
    });
    await prisma.curriculumPlacement.createMany({
      data: [0, 1, 4, 5, 6].map((index) => ({
        curriculumCourseId: memberships[index],
        sourceOrder: index,
        academicYear: index === 4 || index === 5 ? 4 : 1,
        academicSemester: index === 4 || index === 5 ? 2 : 1,
      })),
    });
    await prisma.curriculumPlacement.create({
      data: {
        curriculumCourseId: memberships[0],
        sourceOrder: 10,
        academicYear: 2,
        academicSemester: 1,
        electiveGroup: 'Repeated elective placement',
      },
    });
    await prisma.curriculumPlacement.create({
      data: {
        curriculumCourseId: (
          await prisma.curriculumCourse.findUniqueOrThrow({
            where: { curriculumId_courseId: { curriculumId: contexts[1], courseId: courses[3] } },
          })
        ).id,
        sourceOrder: 0,
        academicYear: 1,
        academicSemester: 1,
      },
    });
    await prisma.curriculumPrerequisite.create({
      data: {
        curriculumId: contexts[0],
        courseId: courses[1],
        prerequisiteId: courses[6],
        isStrict: false,
        isCorequisite: true,
      },
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
    await prisma.studentRecord.createMany({
      data: [
        record(1, 0),
        record(1, 1),
        record(1, 2),
        record(1, 3),
        record(2, 6, 'COMPLETED'),
        record(2, 1),
        record(3, 0, 'COMPLETED'),
        record(3, 6, 'IN_PROGRESS'),
        record(4, 0),
        record(5, 0),
        record(6, 0),
        record(6, 3),
        record(7, 3),
      ],
    });
  });

  afterAll(async () => {
    afterTransactionalActorRead = undefined;
    afterMiddlewareActorRead = undefined;
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
    await prisma.$disconnect();
  });

  it('requires an existing current ADMIN and rechecks the actor in direct service reads', async () => {
    expect((await request(app).get('/api/admin/cohort-demand').query(scope())).status).toBe(401);
    expect((await get(scope(), randomUUID())).status).toBe(401);
    expect((await get(scope(), users[1])).status).toBe(403);
    await expect(readEligibleCohortDemand(randomUUID(), scope())).rejects.toMatchObject({
      status: 401,
    });
    await expect(readEligibleCohortDemand(users[1], scope())).rejects.toMatchObject({
      status: 403,
    });
    await prisma.user.update({ where: { id: users[0] }, data: { role: 'STUDENT' } });
    expect((await get()).status).toBe(403);
  });

  it('aggregates eligible plans union recommendations without duplicates or academic writes', async () => {
    const before = await evidence();
    const response = await get();
    expect(response.status).toBe(200);
    const snapshot = EligibleCohortDemandSnapshotSchema.parse(response.body.data);
    expect(snapshot).toMatchObject({
      cohortStudentCount: 3,
      demandStudentCount: 2,
      eligiblePlannedStudentCount: 2,
      recommendedStudentCount: 2,
      eligiblePlannedSelectionCount: 2,
      recommendedSelectionCount: 4,
      demandSelectionCount: 4,
      overlapSelectionCount: 2,
      ignoredNonmemberPlannedSelectionCount: 1,
      ineligibleMemberPlannedSelectionCount: 2,
      unresolvedGpaStudentCount: 3,
      recommendationPolicy: { maxCredits: 18, maxDifficulty: 3.5 },
    });
    expect(snapshot.courses).toHaveLength(6);
    expect(snapshot.courses.find(({ id }) => id === courses[0])).toMatchObject({
      demandStudentCount: 2,
      eligiblePlannedStudentCount: 1,
      recommendedStudentCount: 2,
      overlapStudentCount: 1,
    });
    expect(snapshot.courses.find(({ id }) => id === courses[1])).toMatchObject({
      demandStudentCount: 1,
      overlapStudentCount: 1,
    });
    expect(snapshot.courses.find(({ id }) => id === courses[2])?.demandStudentCount).toBe(0);
    expect(
      snapshot.courses.every(({ supply, utilization }) => supply === null && utilization === null),
    ).toBe(true);
    expect(await evidence()).toEqual(before);
  });

  it('never borrows other-context, admin or unassigned selections and preserves empty contexts', async () => {
    const other = await readEligibleCohortDemand(users[0], scope(contexts[1]));
    expect(other).toMatchObject({
      cohortStudentCount: 1,
      eligiblePlannedSelectionCount: 1,
      recommendedSelectionCount: 1,
      demandSelectionCount: 1,
      ignoredNonmemberPlannedSelectionCount: 1,
    });
    expect(other.courses.map(({ id }) => id)).toEqual([courses[3]]);
    expect(await readEligibleCohortDemand(users[0], scope(contexts[2]))).toMatchObject({
      cohortStudentCount: 1,
      demandSelectionCount: 0,
      ignoredNonmemberPlannedSelectionCount: 1,
      courses: [],
    });
    expect(await readEligibleCohortDemand(users[0], scope(contexts[3]))).toMatchObject({
      cohortStudentCount: 0,
      demandStudentCount: 0,
      demandSelectionCount: 0,
      courses: [],
    });
  });

  it('uses context prerequisites only and requires recommended/corequisite parents to be completed', async () => {
    const initial = await readEligibleCohortDemand(users[0], scope());
    expect(initial.courses.find(({ id }) => id === courses[0])?.demandStudentCount).toBe(2);
    await prisma.studentRecord.update({
      where: { userId_courseId: { userId: users[2], courseId: courses[6] } },
      data: { status: 'IN_PROGRESS' },
    });
    const blocked = await readEligibleCohortDemand(users[0], scope());
    expect(blocked.courses.find(({ id }) => id === courses[1])?.demandStudentCount).toBe(0);
    expect(blocked.ineligibleMemberPlannedSelectionCount).toBe(3);
  });

  it('retains scenario-independent demand with global empty offerings and old recorded terms', async () => {
    const fall = await readEligibleCohortDemand(users[0], scope());
    const summer = await readEligibleCohortDemand(users[0], scope(contexts[0], 'SUMMER', 2100));
    expect(summer.courses).toEqual(fall.courses);
    expect(summer.termBasis).toBe('SCENARIO_ONLY');
    expect(summer.scope).toEqual(scope(contexts[0], 'SUMMER', 2100));
  });

  it('uses highest member retakes for the exact numeric GPA boundary and preserves old grades', async () => {
    await prisma.studentRecord.createMany({ data: [record(1, 4), record(1, 5)] });
    await prisma.gradeAttempt.createMany({
      data: [
        { userId: users[1], courseId: courses[0], score: 20, requestId: randomUUID() },
        { userId: users[1], courseId: courses[0], score: 70, requestId: randomUUID() },
        { userId: users[1], courseId: courses[0], score: 30, requestId: randomUUID() },
        { userId: users[1], courseId: courses[3], score: 100, requestId: randomUUID() },
      ],
    });
    const before = await evidence();
    const exact70 = await readEligibleCohortDemand(users[0], scope());
    expect(exact70.unresolvedGpaStudentCount).toBe(2);
    expect(exact70.courses.find(({ id }) => id === courses[4])?.overlapStudentCount).toBe(1);
    expect(exact70.courses.find(({ id }) => id === courses[5])?.overlapStudentCount).toBe(1);
    expect(await evidence()).toEqual(before);
    await prisma.gradeAttempt.create({
      data: { userId: users[1], courseId: courses[0], score: 70.00001, requestId: randomUUID() },
    });
    const high = await readEligibleCohortDemand(users[0], scope());
    // Both fixture final-semester codes are alternative courses, so a known thesis path excludes them.
    expect(high.courses.find(({ id }) => id === courses[4])?.demandStudentCount).toBe(0);
    expect(high.courses.find(({ id }) => id === courses[5])?.demandStudentCount).toBe(0);
  });

  it('normalizes uppercase curriculum UUIDs and returns an explicit absent-context error', async () => {
    expect(
      (await get({ ...scope(), curriculumId: contexts[0].toUpperCase() })).body.data.scope,
    ).toEqual(scope());
    expect((await get(scope(randomUUID()))).status).toBe(404);
  });

  it.each([
    {},
    { ...scope(), year: '2026.0' },
    { ...scope(), year: '1999' },
    { ...scope(), year: ['2026', '2027'] },
    { ...scope(), semester: 'WINTER' },
    { ...scope(), userId: users[1] },
    { ...scope(), role: 'ADMIN' },
    { ...scope(), maxCredits: 30 },
    { ...scope(), semesterOffered: 'FALL' },
    { ...scope(), completedIds: courses[6] },
  ])('rejects strict malformed or actor/policy overrides %#', async (query) => {
    const before = await evidence();
    expect((await get(query)).status).toBe(400);
    expect(await evidence()).toEqual(before);
  });

  it('exposes aggregate counts only, with no private account, record or audit payload', async () => {
    const before = await evidence();
    const response = await get();
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(response.body);
    for (const id of users) expect(serialized).not.toContain(id);
    for (const field of [
      'passwordHash',
      'email',
      'studentId',
      'gradePoints',
      'electiveGroup',
      'requestId',
      'updatedBy',
      'Historical B+',
      'Historical claim',
      'Private fixture',
      'Private simulated',
    ])
      expect(serialized).not.toContain(field);
    expect(await evidence()).toEqual(before);
  });

  it.each(['course', 'context'] as const)(
    'reports corrupt persisted %s data as plain 500 without rewriting history',
    async (corruption) => {
      if (corruption === 'course')
        await prisma.course.update({ where: { id: courses[0] }, data: { name: '' } });
      else await prisma.curriculum.update({ where: { id: contexts[0] }, data: { programUrl: '' } });
      try {
        const before = await evidence();
        const response = await get();
        expect(response.status).toBe(500);
        expect(response.body).toEqual({
          success: false,
          error: 'Could not load eligible cohort demand',
        });
        expect(await evidence()).toEqual(before);
      } finally {
        await prisma.course.update({
          where: { id: courses[0] },
          data: { name: 'Private-free course 0' },
        });
        await prisma.curriculum.update({
          where: { id: contexts[0] },
          data: { programUrl: 'https://example.test/reference' },
        });
      }
    },
  );

  it('keeps the default production reader in one snapshot after an independent real writer commits', async () => {
    const initial = await readEligibleCohortDemand(users[0], scope());
    let writerCommitted = false;
    afterTransactionalActorRead = async () => {
      await prisma.$transaction(async (write) => {
        await write.user.update({ where: { id: users[2] }, data: { curriculumId: contexts[1] } });
        await write.studentRecord.update({
          where: { userId_courseId: { userId: users[1], courseId: courses[0] } },
          data: { status: 'COMPLETED' },
        });
        await write.gradeAttempt.create({
          data: { userId: users[1], courseId: courses[0], requestId: randomUUID(), score: 90 },
        });
        await write.curriculumCourse.delete({ where: { id: memberships[6] } });
      });
      writerCommitted = true;
    };
    try {
      const during = await readEligibleCohortDemand(users[0], scope());
      expect(writerCommitted).toBe(true);
      expect(during).toEqual(initial);
    } finally {
      afterTransactionalActorRead = undefined;
    }
    const latest = await readEligibleCohortDemand(users[0], scope());
    expect(latest.cohortStudentCount).toBe(2);
    expect(latest.unresolvedGpaStudentCount).toBe(1);
    expect(latest.courses.map(({ id }) => id)).not.toContain(courses[6]);
    expect(latest.courses.find(({ id }) => id === courses[0])?.demandStudentCount).toBe(0);
    expect(latest).not.toEqual(initial);
  });

  it('rejects a database role demotion that commits after middleware checked the cookie', async () => {
    let demoted = false;
    afterMiddlewareActorRead = async () => {
      await prisma.user.update({ where: { id: users[0] }, data: { role: 'STUDENT' } });
      demoted = true;
    };
    try {
      expect((await get()).status).toBe(403);
      expect(demoted).toBe(true);
    } finally {
      afterMiddlewareActorRead = undefined;
    }
  });
});
