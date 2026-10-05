import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { AllocationPreviewSchema } from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import config from '../config';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { readAllocationPreview } from '../services/allocationPreview';

describe('school-admin aggregate allocation preview (PostgreSQL)', () => {
  const originalDemandPolicy = config.cohortDemandPolicy;
  const originalEnvelopePolicy = config.simulationResourcePolicy;
  const originalAllocationPolicy = config.simulationAllocationPolicy;
  const originalUtilityPolicy = config.allocationUtilityPolicy;
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
      .get('/api/admin/allocation-preview')
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
    config.simulationAllocationPolicy = Object.freeze({
      studentUtilityWeight: 0.6,
      resourceFitWeight: 0.25,
      fairnessWeight: 0.15,
      congestionThreshold: 0.85,
    });
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
    config.simulationAllocationPolicy = originalAllocationPolicy;
    config.allocationUtilityPolicy = originalUtilityPolicy;
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
    await prisma.$disconnect();
  });

  it('requires a current ADMIN for cookie and direct service access', async () => {
    expect((await request(app).get('/api/admin/allocation-preview').query(scope())).status).toBe(
      401,
    );
    expect((await get(scope(), randomUUID())).status).toBe(401);
    expect((await get(scope(), users[1])).status).toBe(403);
    await expect(readAllocationPreview(randomUUID(), scope())).rejects.toMatchObject({
      status: 401,
    });
    await expect(readAllocationPreview(users[1], scope())).rejects.toMatchObject({
      status: 403,
    });
  });
  it('returns complete aggregate diagnostics with no private payload or academic/resource writes', async () => {
    await resource(scope(), { [`${prefix}-course-0`]: { capacity: 500 } });
    const before = await evidence();
    const response = await get();
    expect(response.status).toBe(200);
    const result = AllocationPreviewSchema.parse(response.body.data);
    expect(result.snapshot).toMatchObject({
      consistencyBasis: 'SINGLE_DATABASE_SNAPSHOT',
      demand: { cohortStudentCount: 2, eligiblePlannedSelectionCount: 2, demandSelectionCount: 4 },
      resourceEnvelope: {
        resourceRevision: 1,
        envelope: { sharedSectionCeiling: 2, sharedSeatCeiling: 80 },
      },
    });
    expect(
      result.snapshot.demand.courses.every(
        ({ supply, utilization }) => supply === null && utilization === null,
      ),
    ).toBe(true);
    expect(result.snapshot.demand.scope).toEqual(result.snapshot.resourceEnvelope.scope);
    expect(result.snapshot.demand.curriculum).toEqual(result.snapshot.resourceEnvelope.curriculum);
    const serialized = JSON.stringify(response.body);
    for (const id of users) expect(serialized).not.toContain(id);
    for (const field of [
      'rosterStudentIds',
      'assignments',
      'unassigned',
      '"studentUtility":',
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
    expect(result.assignedStudentCount).toBe(2);
    expect(result.noChoicesStudentCount).toBe(0);
    expect(result.usedSections).toBeGreaterThan(0);
    expect(result.courses.reduce((sum, row) => sum + row.assignedStudentCount, 0)).toBe(2);
    expect(result).toMatchObject({
      utilityBasis: 'BAYESIAN_DIFFICULTY_AND_IMMEDIATE_UNLOCKS_V1',
      persisted: false,
      allocationValidated: false,
    });
    expect(await evidence()).toEqual(before);
  });
  it('distinguishes absent resources from a configured zero shared envelope', async () => {
    const missing = await readAllocationPreview(users[0], scope());
    expect(missing.snapshot.resourceEnvelope).toMatchObject({
      resourceRevision: null,
      resources: null,
      envelope: null,
    });
    const row = await resource();
    await prisma.schoolResource.update({
      where: { id: row.id },
      data: { classrooms: 0, professors: 0 },
    });
    const zero = await readAllocationPreview(users[0], scope());
    expect(zero.snapshot.resourceEnvelope).toMatchObject({
      resourceRevision: 1,
      resources: { classrooms: 0, professors: 0 },
      envelope: { sharedSectionCeiling: 0, sharedSeatCeiling: 0 },
    });
    expect(missing).toMatchObject({
      assignedStudentCount: 0,
      noChoicesStudentCount: 0,
      resourceUnknownStudentCount: 2,
      capacityExhaustedStudentCount: 0,
    });
    expect(zero).toMatchObject({
      assignedStudentCount: 0,
      noChoicesStudentCount: 0,
      resourceUnknownStudentCount: 0,
      capacityExhaustedStudentCount: 2,
    });
    expect(zero.snapshot.demand).toEqual(missing.snapshot.demand);
  });
  it('honors requested context and exact resource scenario, including empty contexts', async () => {
    await resource();
    const summer = await readAllocationPreview(users[0], scope(contexts[0], 'SUMMER', 2100));
    expect(summer.snapshot.resourceEnvelope.envelope).toBeNull();
    expect(summer.snapshot.demand.cohortStudentCount).toBe(2);
    const other = await readAllocationPreview(users[0], scope(contexts[1]));
    expect(other.snapshot.demand).toMatchObject({
      cohortStudentCount: 1,
      courses: [],
      ignoredNonmemberPlannedSelectionCount: 1,
    });
    expect(other.snapshot.resourceEnvelope.envelope).toBeNull();
    expect(
      (await readAllocationPreview(users[0], scope(contexts[2]))).snapshot.demand,
    ).toMatchObject({
      cohortStudentCount: 0,
      courses: [],
      demandSelectionCount: 0,
    });
    expect((await get(scope(randomUUID()))).status).toBe(404);
    const upper = await get({ ...scope(), curriculumId: contexts[0].toUpperCase() });
    expect(upper.status).toBe(200);
    expect(upper.body.data.snapshot.demand.scope).toEqual(scope());
    expect(upper.body.data.snapshot.resourceEnvelope.scope).toEqual(scope());
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
    { ...scope(), studentUtilityWeight: 1 },
    { ...scope(), studentIds: [users[1]] },
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
        error: 'Could not load allocation preview',
      });
      expect(await evidence()).toEqual(before);
    },
  );
  it('keeps all allocation inputs in the default production snapshot after a real concurrent writer commits', async () => {
    const row = await resource();
    const initial = await readAllocationPreview(users[0], scope());
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
      expect(await readAllocationPreview(users[0], scope())).toEqual(initial);
      expect(committed).toBe(true);
    } finally {
      afterTransactionalActorRead = undefined;
    }
    const latest = await readAllocationPreview(users[0], scope());
    expect(latest.snapshot).toMatchObject({
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
    expect(latest.snapshot.demand.courses.map(({ id }) => id)).toEqual([courses[0]]);
    expect(latest).not.toEqual(initial);
  });
  it('captures all four deployment policies before the first awaited production SELECT', async () => {
    await resource();
    const originalDemandPolicy = config.cohortDemandPolicy;
    const originalEnvelopePolicy = config.simulationResourcePolicy;
    const originalAllocationPolicy = config.simulationAllocationPolicy;
    const originalUtilityPolicy = config.allocationUtilityPolicy;
    let changed = false;
    afterTransactionalActorRead = async () => {
      config.cohortDemandPolicy = Object.freeze({ maxCredits: 3, maxDifficulty: 1 });
      config.simulationResourcePolicy = Object.freeze({
        ...originalEnvelopePolicy,
        classroomTimeBlocks: 4,
        sectionsPerProfessor: 4,
      });
      config.simulationAllocationPolicy = Object.freeze({
        studentUtilityWeight: 1,
        resourceFitWeight: 0,
        fairnessWeight: 0,
        congestionThreshold: 0.5,
      });
      config.allocationUtilityPolicy = Object.freeze({
        difficultyFitWeight: 0,
        immediateUnlockWeight: 1,
      });
      changed = true;
    };
    try {
      const during = await readAllocationPreview(users[0], scope());
      expect(changed).toBe(true);
      expect(during.allocationPolicy).toEqual(originalAllocationPolicy);
      expect(during.utilityPolicy).toEqual(originalUtilityPolicy);
      expect((await readAllocationPreview(users[0], scope())).utilityPolicy).toEqual(
        config.allocationUtilityPolicy,
      );
      expect((await readAllocationPreview(users[0], scope())).allocationPolicy).toEqual(
        config.simulationAllocationPolicy,
      );
      expect(during.snapshot.demand.recommendationPolicy).toEqual(originalDemandPolicy);
      expect(during.snapshot.resourceEnvelope.policy).toEqual(originalEnvelopePolicy);
      expect(during.snapshot.resourceEnvelope.envelope?.sharedSeatCeiling).toBe(80);
      const latest = await readAllocationPreview(users[0], scope());
      expect(latest.snapshot.demand.recommendationPolicy).toEqual(config.cohortDemandPolicy);
      expect(latest.snapshot.resourceEnvelope.policy).toEqual(config.simulationResourcePolicy);
      expect(during.snapshot.demand.recommendedSelectionCount).toBe(4);
      expect(latest.snapshot.demand.recommendedSelectionCount).toBe(2);
      expect(latest.snapshot.resourceEnvelope.envelope?.sharedSeatCeiling).toBe(320);
    } finally {
      afterTransactionalActorRead = undefined;
      config.cohortDemandPolicy = originalDemandPolicy;
      config.simulationResourcePolicy = originalEnvelopePolicy;
      config.simulationAllocationPolicy = originalAllocationPolicy;
      config.allocationUtilityPolicy = originalUtilityPolicy;
    }
  });

  it('uses mandatory immediate unlock utility to select a prerequisite in the real cohort', async () => {
    const child = randomUUID();
    const prior = config.allocationUtilityPolicy;
    config.allocationUtilityPolicy = Object.freeze({
      difficultyFitWeight: 0,
      immediateUnlockWeight: 1,
    });
    try {
      await prisma.course.create({
        data: {
          id: child,
          code: `${prefix}-unlock`,
          name: 'Unlock fixture',
          credits: 3,
          difficultyLevel: 2,
        },
      });
      await prisma.curriculumCourse.create({
        data: {
          curriculumId: contexts[0],
          courseId: child,
          placements: { create: { academicYear: 2, academicSemester: 1, sourceOrder: 2 } },
        },
      });
      await prisma.curriculumPrerequisite.create({
        data: {
          curriculumId: contexts[0],
          courseId: child,
          prerequisiteId: courses[0],
          isStrict: false,
          isCorequisite: true,
        },
      });
      const row = await resource();
      await prisma.schoolResource.update({
        where: { id: row.id },
        data: { classrooms: 1, professors: 1, maxStudentsPerSection: 2 },
      });
      const before = await evidence();
      const result = await readAllocationPreview(users[0], scope());
      expect(result.utilityPolicy).toEqual({ difficultyFitWeight: 0, immediateUnlockWeight: 1 });
      expect(result.courses.find(({ id }) => id === courses[0])?.assignedStudentCount).toBe(2);
      expect(result.courses.find(({ id }) => id === courses[1])?.assignedStudentCount).toBe(0);
      expect(result.courses.find(({ id }) => id === child)?.demandStudentCount).toBe(0);
      expect(await evidence()).toEqual(before);
      expect(JSON.stringify(result)).not.toContain('immediateUnlockCount');
    } finally {
      config.allocationUtilityPolicy = prior;
      await prisma.curriculumPrerequisite.deleteMany({
        where: { curriculumId: contexts[0], courseId: child },
      });
      await prisma.curriculumCourse.deleteMany({
        where: { curriculumId: contexts[0], courseId: child },
      });
      await prisma.course.deleteMany({ where: { id: child } });
    }
  });
  it('keeps prerequisite utility metadata within the captured production snapshot', async () => {
    await resource();
    const initial = await readAllocationPreview(users[0], scope());
    const edge = randomUUID();
    afterTransactionalActorRead = async () => {
      await prisma.curriculumPrerequisite.create({
        data: {
          id: edge,
          curriculumId: contexts[0],
          courseId: courses[1],
          prerequisiteId: courses[0],
          isStrict: false,
          isCorequisite: true,
        },
      });
    };
    try {
      expect(await readAllocationPreview(users[0], scope())).toEqual(initial);
      const latest = await readAllocationPreview(users[0], scope());
      expect(
        latest.snapshot.demand.courses.find(({ id }) => id === courses[1])?.demandStudentCount,
      ).toBe(0);
      expect(latest.courses.find(({ id }) => id === courses[0])?.assignedStudentCount).toBe(2);
    } finally {
      afterTransactionalActorRead = undefined;
      await prisma.curriculumPrerequisite.deleteMany({ where: { id: edge } });
    }
  });
  it('rejects corrupt utility policy before reading with a plain private-free 500', async () => {
    config.allocationUtilityPolicy = Object.freeze({
      difficultyFitWeight: 1,
      immediateUnlockWeight: 1,
    });
    try {
      const response = await get();
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ success: false, error: 'Could not load allocation preview' });
    } finally {
      config.allocationUtilityPolicy = originalUtilityPolicy;
    }
  });
  it('respects a single shared seat without inventing per-course supply', async () => {
    const row = await resource();
    await prisma.schoolResource.update({
      where: { id: row.id },
      data: { classrooms: 1, professors: 1, maxStudentsPerSection: 1 },
    });
    const result = await readAllocationPreview(users[0], scope());
    expect(result).toMatchObject({
      assignedStudentCount: 1,
      capacityExhaustedStudentCount: 1,
      usedSections: 1,
    });
    expect(result.courses.reduce((sum, course) => sum + course.seatCapacity, 0)).toBe(1);
    expect(result.courses.filter(({ openedSections }) => openedSections === 1)).toHaveLength(1);
    expect(
      result.snapshot.demand.courses.every(
        ({ supply, utilization }) => supply === null && utilization === null,
      ),
    ).toBe(true);
  });
  it('rejects corrupt allocation policy with a plain 500', async () => {
    const prior = config.simulationAllocationPolicy;
    config.simulationAllocationPolicy = Object.freeze({ ...prior, studentUtilityWeight: 2 });
    try {
      const response = await get();
      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        success: false,
        error: 'Could not load allocation preview',
      });
    } finally {
      config.simulationAllocationPolicy = prior;
    }
  });
  it('returns an identity-free 409 for cohorts beyond the synchronous preview limit', async () => {
    const extra = Array.from({ length: 499 }, () => randomUUID());
    await prisma.user.createMany({
      data: extra.map((id) => ({
        id,
        studentId: id,
        email: `${id}@example.test`,
        name: 'Limit fixture',
        passwordHash: 'fixture',
        role: 'STUDENT',
        curriculumId: contexts[0],
      })),
    });
    try {
      const response = await get();
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        success: false,
        error:
          'Allocation preview supports at most 500 students, 100 choices per student and 10000 total choices',
      });
      for (const id of extra) expect(JSON.stringify(response.body)).not.toContain(id);
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: extra } } });
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
