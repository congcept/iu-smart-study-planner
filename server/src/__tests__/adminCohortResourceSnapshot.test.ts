import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { CohortResourceSnapshotSchema } from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import config from '../config';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { readCohortResourceSnapshot } from '../services/cohortResourceSnapshot';

describe('school-admin coherent cohort-resource snapshot (PostgreSQL)', () => {
  const originalDemandPolicy = config.cohortDemandPolicy;
  const originalEnvelopePolicy = config.simulationResourcePolicy;
  const prefix = `coherent-${randomUUID()}`;
  const users = Array.from({ length: 4 }, () => randomUUID());
  const contexts = Array.from({ length: 3 }, () => randomUUID());
  const courses = Array.from({ length: 2 }, () => randomUUID());
  const members = Array.from({ length: 2 }, () => randomUUID());
  const scope = (
    curriculumId = contexts[0],
    semester: 'FALL' | 'SPRING' | 'SUMMER' = 'FALL',
    year = 2026,
  ) => ({ curriculumId, semester, year });
  const get = (query: Record<string, unknown> = scope(), userId = users[0]) =>
    request(app)
      .get('/api/admin/cohort-resource-snapshot')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(userId)}`)
      .query(query);
  let afterTransactionalActorRead: (() => Promise<void>) | undefined;
  let afterMiddlewareActorRead: (() => Promise<void>) | undefined;
  const resource = (resourceScope = scope(), overrides: Prisma.InputJsonValue = {}) =>
    prisma.schoolResource.create({
      data: {
        ...resourceScope,
        professors: 2,
        classrooms: 3,
        labRooms: 9,
        maxStudentsPerSection: 40,
        revision: 1,
        updatedBy: users[0],
        courseOverrides: overrides,
      },
    });
  const evidence = async () => ({
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
    records: await prisma.studentRecord.findMany({
      where: { userId: { in: users } },
      orderBy: { id: 'asc' },
    }),
    attempts: await prisma.gradeAttempt.findMany({
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
  });

  beforeAll(async () => {
    config.cohortDemandPolicy = Object.freeze({ maxCredits: 18, maxDifficulty: 3.5 });
    config.simulationResourcePolicy = Object.freeze({
      ...originalEnvelopePolicy,
      classroomTimeBlocks: 1,
      sectionsPerProfessor: 1,
    });
    // Gate after real SELECTs; the default production transaction implementation stays intact.
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (
        params.model === 'User' &&
        params.action === 'findUnique' &&
        params.args?.where?.id === users[0]
      ) {
        if (params.runInTransaction && afterTransactionalActorRead) {
          const writer = afterTransactionalActorRead;
          afterTransactionalActorRead = undefined;
          await writer();
        } else if (!params.runInTransaction && afterMiddlewareActorRead) {
          const writer = afterMiddlewareActorRead;
          afterMiddlewareActorRead = undefined;
          await writer();
        }
      }
      return result;
    });
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Reference coherence context',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
        isGpaPath: true,
      })),
    });
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-course-${index}`,
        name: `Reference course ${index}`,
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
        name: 'Private coherent actor',
        passwordHash: 'Private coherent hash',
        role: index === 0 ? 'ADMIN' : 'STUDENT',
        curriculumId: index === 0 || index === 3 ? contexts[1] : contexts[0],
      })),
    });
    await prisma.studyPlan.create({
      data: {
        userId: users[1],
        name: 'Private historical plan',
        semesters: {
          create: {
            semester: 'FALL',
            year: 2001,
            courses: [{ courseId: courses[0], position: 0 }],
            totalCredits: 31,
            difficultyScore: 4.2,
          },
        },
      },
    });
    await prisma.courseRating.create({
      data: { userId: users[1], courseId: courses[0], rating: 4 },
    });
  });
  beforeEach(async () => {
    afterTransactionalActorRead = undefined;
    afterMiddlewareActorRead = undefined;
    await prisma.schoolResource.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.gradeAttempt.deleteMany({ where: { userId: { in: users } } });
    await prisma.studentRecord.deleteMany({ where: { userId: { in: users } } });
    await prisma.curriculumCourse.deleteMany({ where: { curriculumId: { in: contexts } } });
    await prisma.curriculumCourse.createMany({
      data: courses.map((courseId, index) => ({
        id: members[index],
        curriculumId: contexts[0],
        courseId,
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
    for (let index = 0; index < users.length; index++)
      await prisma.user.update({
        where: { id: users[index] },
        data: {
          role: index === 0 ? 'ADMIN' : 'STUDENT',
          curriculumId: index === 0 || index === 3 ? contexts[1] : contexts[0],
        },
      });
    await prisma.curriculum.update({
      where: { id: contexts[0] },
      data: { name: 'Reference coherence context', programUrl: 'https://example.test/reference' },
    });
    await prisma.course.update({ where: { id: courses[0] }, data: { name: 'Reference course 0' } });
    await prisma.studentRecord.createMany({
      data: [1, 2, 3].map((index) => ({
        userId: users[index],
        courseId: courses[0],
        status: 'PLANNED',
        grade: 'Historical B+',
        gradePoints: 3.5,
        electiveGroup: 'Historical claim',
        semester: 'Fall 2001',
        year: 2001,
      })),
    });
  });
  afterAll(async () => {
    afterTransactionalActorRead = undefined;
    afterMiddlewareActorRead = undefined;
    config.cohortDemandPolicy = originalDemandPolicy;
    config.simulationResourcePolicy = originalEnvelopePolicy;
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
    await prisma.$disconnect();
  });

  it('requires a current ADMIN for cookie and direct service access', async () => {
    expect(
      (await request(app).get('/api/admin/cohort-resource-snapshot').query(scope())).status,
    ).toBe(401);
    expect((await get(scope(), randomUUID())).status).toBe(401);
    expect((await get(scope(), users[1])).status).toBe(403);
    await expect(readCohortResourceSnapshot(randomUUID(), scope())).rejects.toMatchObject({
      status: 401,
    });
    await expect(readCohortResourceSnapshot(users[1], scope())).rejects.toMatchObject({
      status: 403,
    });
  });
  it('returns complete aggregate diagnostics with no private payload or academic/resource writes', async () => {
    await resource(scope(), { [`${prefix}-course-0`]: { capacity: 500 } });
    const before = await evidence();
    const response = await get();
    expect(response.status).toBe(200);
    const result = CohortResourceSnapshotSchema.parse(response.body.data);
    expect(result).toMatchObject({
      consistencyBasis: 'SINGLE_DATABASE_SNAPSHOT',
      demand: { cohortStudentCount: 2, eligiblePlannedSelectionCount: 2, demandSelectionCount: 4 },
      resourceEnvelope: {
        resourceRevision: 1,
        envelope: { sharedSectionCeiling: 2, sharedSeatCeiling: 80 },
      },
    });
    expect(
      result.demand.courses.every(
        ({ supply, utilization }) => supply === null && utilization === null,
      ),
    ).toBe(true);
    expect(result.demand.scope).toEqual(result.resourceEnvelope.scope);
    expect(result.demand.curriculum).toEqual(result.resourceEnvelope.curriculum);
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
      'createdAt',
      'updatedAt',
      '"courseOverrides":',
      'Historical B+',
      'Historical claim',
      'Private coherent',
      'Private historical',
    ])
      expect(serialized).not.toContain(field);
    expect(await evidence()).toEqual(before);
  });
  it('distinguishes absent resources from a configured zero shared envelope', async () => {
    const missing = await readCohortResourceSnapshot(users[0], scope());
    expect(missing.resourceEnvelope).toMatchObject({
      resourceRevision: null,
      resources: null,
      envelope: null,
    });
    const row = await resource();
    await prisma.schoolResource.update({
      where: { id: row.id },
      data: { classrooms: 0, professors: 0 },
    });
    const zero = await readCohortResourceSnapshot(users[0], scope());
    expect(zero.resourceEnvelope).toMatchObject({
      resourceRevision: 1,
      resources: { classrooms: 0, professors: 0 },
      envelope: { sharedSectionCeiling: 0, sharedSeatCeiling: 0 },
    });
    expect(zero.demand).toEqual(missing.demand);
  });
  it('honors requested context and exact resource scenario, including empty contexts', async () => {
    await resource();
    const summer = await readCohortResourceSnapshot(users[0], scope(contexts[0], 'SUMMER', 2100));
    expect(summer.resourceEnvelope.envelope).toBeNull();
    expect(summer.demand.cohortStudentCount).toBe(2);
    const other = await readCohortResourceSnapshot(users[0], scope(contexts[1]));
    expect(other.demand).toMatchObject({
      cohortStudentCount: 1,
      courses: [],
      ignoredNonmemberPlannedSelectionCount: 1,
    });
    expect(other.resourceEnvelope.envelope).toBeNull();
    expect((await readCohortResourceSnapshot(users[0], scope(contexts[2]))).demand).toMatchObject({
      cohortStudentCount: 0,
      courses: [],
      demandSelectionCount: 0,
    });
    expect((await get(scope(randomUUID()))).status).toBe(404);
    const upper = await get({ ...scope(), curriculumId: contexts[0].toUpperCase() });
    expect(upper.status).toBe(200);
    expect(upper.body.data.demand.scope).toEqual(scope());
    expect(upper.body.data.resourceEnvelope.scope).toEqual(scope());
  });
  it.each([
    {},
    { ...scope(), semester: 'WINTER' },
    { ...scope(), year: '2026.0' },
    { ...scope(), year: '1999' },
    { ...scope(), year: ['2026', '2027'] },
    { ...scope(), maxCredits: 30 },
    { ...scope(), userId: users[1] },
    { ...scope(), role: 'ADMIN' },
    { ...scope(), classroomTimeBlocks: 100 },
  ])('rejects malformed scopes and policy/account overrides %#', async (query) => {
    const before = await evidence();
    expect((await get(query)).status).toBe(400);
    expect(await evidence()).toEqual(before);
  });
  it.each(['course', 'resource', 'context'] as const)(
    'returns plain 500 for corrupt persisted %s without changes',
    async (kind) => {
      const row = await resource();
      if (kind === 'course')
        await prisma.course.update({ where: { id: courses[0] }, data: { name: '' } });
      else if (kind === 'context')
        await prisma.curriculum.update({ where: { id: contexts[0] }, data: { programUrl: '' } });
      else
        await prisma.schoolResource.update({
          where: { id: row.id },
          data: { courseOverrides: { OLD: {} } },
        });
      const before = await evidence();
      const response = await get();
      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        success: false,
        error: 'Could not load cohort resource snapshot',
      });
      expect(await evidence()).toEqual(before);
    },
  );
  it('keeps both diagnostics in the default production snapshot after a real concurrent writer commits', async () => {
    const row = await resource();
    const initial = await readCohortResourceSnapshot(users[0], scope());
    let committed = false;
    afterTransactionalActorRead = async () => {
      await prisma.$transaction(async (write) => {
        await write.schoolResource.update({
          where: { id: row.id },
          data: { professors: 7, classrooms: 8, revision: 2 },
        });
        await write.user.update({ where: { id: users[2] }, data: { curriculumId: contexts[1] } });
        await write.studentRecord.update({
          where: { userId_courseId: { userId: users[1], courseId: courses[0] } },
          data: { status: 'COMPLETED' },
        });
        await write.gradeAttempt.create({
          data: { userId: users[1], courseId: courses[0], score: 90, requestId: randomUUID() },
        });
        await write.curriculum.update({
          where: { id: contexts[0] },
          data: { name: 'Changed context after snapshot' },
        });
        await write.curriculumCourse.delete({ where: { id: members[1] } });
      });
      committed = true;
    };
    try {
      expect(await readCohortResourceSnapshot(users[0], scope())).toEqual(initial);
      expect(committed).toBe(true);
    } finally {
      afterTransactionalActorRead = undefined;
    }
    const latest = await readCohortResourceSnapshot(users[0], scope());
    expect(latest).toMatchObject({
      demand: {
        cohortStudentCount: 1,
        demandSelectionCount: 0,
        unresolvedGpaStudentCount: 0,
        curriculum: { name: 'Changed context after snapshot' },
      },
      resourceEnvelope: {
        resourceRevision: 2,
        envelope: { sharedSeatCeiling: 280 },
        curriculum: { name: 'Changed context after snapshot' },
      },
    });
    expect(latest.demand.courses.map(({ id }) => id)).toEqual([courses[0]]);
    expect(latest).not.toEqual(initial);
  });
  it('captures both deployment policies before the first awaited production SELECT', async () => {
    await resource();
    const originalDemandPolicy = config.cohortDemandPolicy;
    const originalEnvelopePolicy = config.simulationResourcePolicy;
    let changed = false;
    afterTransactionalActorRead = async () => {
      config.cohortDemandPolicy = Object.freeze({ maxCredits: 3, maxDifficulty: 1 });
      config.simulationResourcePolicy = Object.freeze({
        ...originalEnvelopePolicy,
        classroomTimeBlocks: 4,
        sectionsPerProfessor: 4,
      });
      changed = true;
    };
    try {
      const during = await readCohortResourceSnapshot(users[0], scope());
      expect(changed).toBe(true);
      expect(during.demand.recommendationPolicy).toEqual(originalDemandPolicy);
      expect(during.resourceEnvelope.policy).toEqual(originalEnvelopePolicy);
      expect(during.resourceEnvelope.envelope?.sharedSeatCeiling).toBe(80);
      const latest = await readCohortResourceSnapshot(users[0], scope());
      expect(latest.demand.recommendationPolicy).toEqual(config.cohortDemandPolicy);
      expect(latest.resourceEnvelope.policy).toEqual(config.simulationResourcePolicy);
      expect(during.demand.recommendedSelectionCount).toBe(4);
      expect(latest.demand.recommendedSelectionCount).toBe(2);
      expect(latest.resourceEnvelope.envelope?.sharedSeatCeiling).toBe(320);
    } finally {
      afterTransactionalActorRead = undefined;
      config.cohortDemandPolicy = originalDemandPolicy;
      config.simulationResourcePolicy = originalEnvelopePolicy;
    }
  });
  it('rechecks a role demotion committed after cookie middleware authorization', async () => {
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
