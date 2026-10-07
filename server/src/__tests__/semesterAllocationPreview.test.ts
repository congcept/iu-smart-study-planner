import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { SemesterAllocationPreviewSchema, type ResourceScopeDTO } from '@iu-study-planner/shared';
import app, { prisma } from '../index';
import config from '../config';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import {
  produceSemesterAllocationPreview,
  readSemesterAllocationPreview,
} from '../services/semesterAllocationPreview';

describe('read-only semester reference preview (PostgreSQL)', () => {
  const prefix = `semester-preview-${randomUUID()}`;
  const users = Array.from({ length: 4 }, () => randomUUID());
  const contexts = Array.from({ length: 3 }, () => randomUUID());
  const courses = Array.from({ length: 6 }, () => randomUUID());
  const members = Array.from({ length: 6 }, () => randomUUID());
  const original = {
    demand: config.cohortDemandPolicy,
    envelope: config.simulationResourcePolicy,
    allocation: config.simulationAllocationPolicy,
    utility: config.allocationUtilityPolicy,
  };
  let afterTransactionalActorRead: (() => Promise<void>) | undefined;
  let afterMiddlewareActorRead: (() => Promise<void>) | undefined;
  let historyReads = 0;
  let physicalCourseId: string;
  let createdPhysicalCourse = false;
  const scope = (
    curriculumId = contexts[0],
    semester: ResourceScopeDTO['semester'] = 'FALL',
    year = 2026,
  ): ResourceScopeDTO => ({ curriculumId, semester, year });
  const get = (query: Record<string, unknown> = scope(), actorId = users[0]) =>
    request(app)
      .get('/api/admin/semester-allocation-preview')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(actorId)}`)
      .query(query);
  const policies = () => {
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
  };
  const evidence = async () => ({
    users: await prisma.user.findMany({ where: { id: { in: users } }, orderBy: { id: 'asc' } }),
    contexts: await prisma.curriculum.findMany({
      where: { id: { in: contexts } },
      orderBy: { id: 'asc' },
    }),
    courses: await prisma.course.findMany({
      where: { id: { in: [...courses, physicalCourseId] } },
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
    semesterRuns: await prisma.simulationSemesterRun.findMany({
      where: { curriculumId: { in: contexts } },
    }),
    semesterParticipants: await prisma.simulationSemesterParticipant.findMany({
      where: { run: { curriculumId: { in: contexts } } },
    }),
    oldRuns: await prisma.simulationAllocationRun.findMany({
      where: { curriculumId: { in: contexts } },
    }),
    oldJobs: await prisma.simulationAllocationJob.findMany({
      where: { curriculumId: { in: contexts } },
    }),
  });
  const clean = async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
  };
  const addMember = async (index: number, year = 1, semester = 1) => {
    await prisma.curriculumCourse.create({
      data: { id: members[index], curriculumId: contexts[0], courseId: courses[index] },
    });
    await prisma.curriculumPlacement.create({
      data: {
        curriculumCourseId: members[index],
        academicYear: year,
        academicSemester: semester,
        sourceOrder: index,
      },
    });
  };
  const planned = (userId: string, courseId: string) => ({
    userId,
    courseId,
    status: 'PLANNED' as const,
    grade: 'Historical B+',
    gradePoints: 3.5,
    semester: 'Fall 2001',
    year: 2001,
  });

  beforeAll(async () => {
    // All hooks observe actual completed queries; Prisma responses and transactions stay real.
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (
        params.model === 'User' &&
        params.action === 'findUnique' &&
        params.args?.where?.id === users[0]
      ) {
        if (params.runInTransaction && afterTransactionalActorRead) {
          const hook = afterTransactionalActorRead;
          afterTransactionalActorRead = undefined;
          await hook();
        } else if (!params.runInTransaction && afterMiddlewareActorRead) {
          const hook = afterMiddlewareActorRead;
          afterMiddlewareActorRead = undefined;
          await hook();
        }
      }
      if (
        params.runInTransaction &&
        ['StudentRecord', 'GradeAttempt'].includes(params.model ?? '') &&
        params.action === 'findMany'
      ) {
        const selected: unknown = params.args?.where?.userId?.in;
        if (Array.isArray(selected) && selected.includes(users[1])) historyReads++;
      }
      return result;
    });
    const existing = await prisma.course.findUnique({
      where: { code: 'PT001IU' },
      select: { id: true },
    });
    if (existing) physicalCourseId = existing.id;
    else {
      physicalCourseId = randomUUID();
      createdPhysicalCourse = true;
      await prisma.course.create({
        data: {
          id: physicalCourseId,
          code: 'PT001IU',
          name: 'Physical training fixture',
          credits: 3,
          difficultyLevel: 2,
          semesterOffered: [],
        },
      });
    }
  });
  beforeEach(async () => {
    afterTransactionalActorRead = undefined;
    afterMiddlewareActorRead = undefined;
    historyReads = 0;
    policies();
    await clean();
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-context-${index}`,
        name: 'Semester reference',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/semester-preview',
        isGpaPath: false,
      })),
    });
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-course-${index}`,
        name: `Semester course ${index}`,
        credits: index === 3 ? 0 : 3,
        difficultyLevel: 2,
        semesterOffered: [],
      })),
    });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-user-${index}`,
        email: `${id}@example.test`,
        name: `Private semester actor ${index}`,
        passwordHash: 'Private unused hash',
        role: index === 0 ? 'ADMIN' : 'STUDENT',
        curriculumId: index === 3 ? contexts[1] : contexts[0],
      })),
    });
    for (const index of [0, 1, 2]) await addMember(index);
    await prisma.studentRecord.createMany({
      data: [users[1], users[2]].flatMap((userId) =>
        [0, 1, 2].map((index) => planned(userId, courses[index])),
      ),
    });
    await prisma.studentRecord.create({ data: planned(users[3], courses[0]) });
    await prisma.schoolResource.create({
      data: {
        ...scope(),
        professors: 3,
        classrooms: 3,
        labRooms: 9,
        maxStudentsPerSection: 2,
        revision: 1,
        updatedBy: users[0],
      },
    });
    await prisma.studyPlan.create({
      data: {
        userId: users[1],
        name: 'Private legacy study plan',
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
    afterTransactionalActorRead = undefined;
    afterMiddlewareActorRead = undefined;
    await clean();
  });
  afterAll(async () => {
    config.cohortDemandPolicy = original.demand;
    config.simulationResourcePolicy = original.envelope;
    config.simulationAllocationPolicy = original.allocation;
    config.allocationUtilityPolicy = original.utility;
    if (createdPhysicalCourse) await prisma.course.delete({ where: { id: physicalCourseId } });
    await prisma.$disconnect();
  });

  it('allocates multiple courses against a uniform configured target and shared persistent sections', async () => {
    const before = await evidence();
    const response = await get();
    expect(response.status).toBe(200);
    const preview = SemesterAllocationPreviewSchema.parse(response.body.data);
    expect(preview).toMatchObject({
      consistencyBasis: 'SINGLE_DATABASE_SNAPSHOT',
      targetCreditsBasis: 'CONFIGURED_REFERENCE_MAX_CREDITS',
      recommendationPolicy: { maxCredits: 6, maxDifficulty: 5 },
      result: {
        studentCount: 2,
        assignedStudentCount: 2,
        assignedCourseCount: 4,
        totalTargetCredits: 12,
        totalAssignedCredits: 12,
        totalRemainingCredits: 0,
        usedSections: 2,
        rounds: 2,
        stopReasonCounts: { TARGET_REACHED: 2 },
        academicPlansChanged: false,
        eligibilityValidated: false,
        allocationValidated: false,
        timetableValidated: false,
      },
    });
    expect(
      preview.result.courses.reduce((sum, course) => sum + course.assignedStudentCount, 0),
    ).toBe(4);
    expect(preview.result.courses.reduce((sum, course) => sum + course.seatCapacity, 0)).toBe(4);
    const serialized = JSON.stringify(response.body);
    for (const id of users) expect(serialized).not.toContain(id);
    for (const value of [
      'students',
      'studentId',
      'candidates',
      'assignments',
      '"input"',
      'passwordHash',
      'email',
      'Historical B+',
      'Private legacy',
      'gradePoints',
      '"studentUtility":',
      'requestId',
      'createdById',
    ])
      expect(serialized).not.toContain(value);
    expect(await evidence()).toEqual(before);
  });

  it('keeps the internal coherent roster private and gives every student the configured budget', async () => {
    const produced = await produceSemesterAllocationPreview(users[0], scope());
    expect(produced.result.input.students.map((student) => student.targetCredits)).toEqual([6, 6]);
    expect(produced.result.input.students.map((student) => student.studentId).sort()).toEqual(
      [users[1], users[2]].sort(),
    );
    expect(produced.preview).toEqual(await readSemesterAllocationPreview(users[0], scope()));
    expect(produced.result.students.every((student) => student.assignedCredits === 6)).toBe(true);
  });

  it.each(['unauthenticated', 'missing', 'student'] as const)(
    'requires fresh ADMIN authorization for %s HTTP access',
    async (kind) => {
      const response =
        kind === 'unauthenticated'
          ? await request(app).get('/api/admin/semester-allocation-preview').query(scope())
          : await get(scope(), kind === 'missing' ? randomUUID() : users[1]);
      expect(response.status).toBe(kind === 'student' ? 403 : 401);
    },
  );

  it.each(['missing', 'student'] as const)(
    'requires fresh ADMIN authorization for direct %s access',
    async (kind) => {
      await expect(
        readSemesterAllocationPreview(kind === 'missing' ? randomUUID() : users[1], scope()),
      ).rejects.toMatchObject({ status: kind === 'missing' ? 401 : 403 });
    },
  );

  it('rejects a role changed after the real authentication middleware read', async () => {
    afterMiddlewareActorRead = async () => {
      await prisma.user.update({ where: { id: users[0] }, data: { role: 'STUDENT' } });
    };
    expect((await get()).status).toBe(403);
    expect(historyReads).toBe(0);
  });

  it.each([
    {},
    { curriculumId: contexts[0], semester: 'WINTER', year: 2026 },
    { ...scope(), year: '2026.0' },
    { ...scope(), year: '1999' },
    { ...scope(), year: ['2026', '2027'] },
    { ...scope(), maxCredits: 30 },
    { ...scope(), studentId: users[1] },
    { ...scope(), role: 'ADMIN' },
    { ...scope(), students: [users[1]] },
    { ...scope(), studentUtilityWeight: 1 },
    { ...scope(), classroomTimeBlocks: 100 },
  ])('rejects strict malformed scopes and actor/policy overrides %#', async (query) => {
    const before = await evidence();
    expect((await get(query)).status).toBe(400);
    expect(await evidence()).toEqual(before);
  });

  it.each([{ roster: [] }, { result: {} }, { maxCredits: 30 }, []])(
    'rejects nonempty GET bodies %#',
    async (body) => {
      const before = await evidence();
      const response = await request(app)
        .get('/api/admin/semester-allocation-preview')
        .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(users[0])}`)
        .query(scope())
        .send(body);
      expect(response.status).toBe(400);
      expect(await evidence()).toEqual(before);
    },
  );

  it('keeps exact scenario resources separate while preserving scenario-only choices', async () => {
    const fall = await readSemesterAllocationPreview(users[0], scope());
    const summer = await readSemesterAllocationPreview(
      users[0],
      scope(contexts[0], 'SUMMER', 2100),
    );
    expect(summer.result.envelope.resources).toBeNull();
    expect(summer.result.courses.map((course) => course.demandStudentCount)).toEqual(
      fall.result.courses.map((course) => course.demandStudentCount),
    );
    expect(summer.result).toMatchObject({
      assignedCourseCount: 0,
      totalRemainingCredits: 12,
      stopReasonCounts: { RESOURCE_UNKNOWN: 2 },
    });
    const foreign = await readSemesterAllocationPreview(users[0], scope(contexts[1]));
    expect(foreign.result).toMatchObject({
      studentCount: 1,
      assignedCourseCount: 0,
      totalTargetCredits: 6,
      stopReasonCounts: { NO_REMAINING_CHOICES: 1 },
      courses: [],
    });
    expect(
      (await readSemesterAllocationPreview(users[0], scope(contexts[2]))).result,
    ).toMatchObject({ studentCount: 0, totalTargetCredits: 0, courses: [] });
    expect((await get(scope(randomUUID()))).status).toBe(404);
    expect(
      (await get({ ...scope(), curriculumId: contexts[0].toUpperCase() })).body.data.result.scope,
    ).toEqual(scope());
  });

  it('distinguishes missing resources from zero configured capacity without changing the target', async () => {
    await prisma.schoolResource.deleteMany({ where: scope() });
    const missing = await readSemesterAllocationPreview(users[0], scope());
    await prisma.schoolResource.create({
      data: {
        ...scope(),
        classrooms: 0,
        professors: 0,
        maxStudentsPerSection: 2,
        updatedBy: users[0],
      },
    });
    const zero = await readSemesterAllocationPreview(users[0], scope());
    expect(missing.result).toMatchObject({
      totalRemainingCredits: 12,
      stopReasonCounts: { RESOURCE_UNKNOWN: 2, CAPACITY_EXHAUSTED: 0 },
    });
    expect(zero.result).toMatchObject({
      totalRemainingCredits: 12,
      stopReasonCounts: { RESOURCE_UNKNOWN: 0, CAPACITY_EXHAUSTED: 2 },
    });
  });

  it.each([
    [true, false],
    [false, false],
    [false, true],
  ])(
    'enforces every context prerequisite strict=%s/corequisite=%s and never unlocks it within this preview',
    async (isStrict, isCorequisite) => {
      await prisma.curriculumPrerequisite.create({
        data: {
          curriculumId: contexts[0],
          courseId: courses[1],
          prerequisiteId: courses[0],
          isStrict,
          isCorequisite,
        },
      });
      const initial = await produceSemesterAllocationPreview(users[0], scope());
      expect(
        initial.result.input.students.every(
          (student) => !student.candidates.some((choice) => choice.courseId === courses[1]),
        ),
      ).toBe(true);
      expect(
        initial.result.students.every((student) => !student.courseIds.includes(courses[1])),
      ).toBe(true);
      expect(
        initial.preview.result.courses.find((course) => course.courseId === courses[1])
          ?.demandStudentCount,
      ).toBe(0);
      await prisma.studentRecord.update({
        where: { userId_courseId: { userId: users[1], courseId: courses[0] } },
        data: { status: 'COMPLETED' },
      });
      const later = await produceSemesterAllocationPreview(users[0], scope());
      const eligible = later.result.input.students.find(
        (student) => student.studentId === users[1],
      )!;
      const blocked = later.result.input.students.find(
        (student) => student.studentId === users[2],
      )!;
      expect(eligible.candidates.some((choice) => choice.courseId === courses[1])).toBe(true);
      expect(blocked.candidates.some((choice) => choice.courseId === courses[1])).toBe(false);
    },
  );

  it('uses highest retakes and the exact numeric GPA path while deferring an unknown fork', async () => {
    await prisma.curriculum.update({ where: { id: contexts[0] }, data: { isGpaPath: true } });
    await addMember(4, 4, 2);
    await prisma.studentRecord.createMany({
      data: [users[1], users[2]].map((userId) => planned(userId, courses[4])),
    });
    const unknown = await produceSemesterAllocationPreview(users[0], scope());
    expect(
      unknown.result.input.students.every(
        (student) => !student.candidates.some((choice) => choice.courseId === courses[4]),
      ),
    ).toBe(true);
    await prisma.gradeAttempt.createMany({
      data: [20, 70, 30].map((score) => ({
        userId: users[1],
        courseId: courses[0],
        score,
        requestId: randomUUID(),
      })),
    });
    await prisma.gradeAttempt.create({
      data: { userId: users[1], courseId: courses[5], score: 100, requestId: randomUUID() },
    });
    const atBoundary = await produceSemesterAllocationPreview(users[0], scope());
    expect(
      atBoundary.result.input.students
        .find((student) => student.studentId === users[1])
        ?.candidates.some((choice) => choice.courseId === courses[4]),
    ).toBe(true);
    expect(
      atBoundary.result.input.students
        .find((student) => student.studentId === users[2])
        ?.candidates.some((choice) => choice.courseId === courses[4]),
    ).toBe(false);
    await prisma.gradeAttempt.create({
      data: { userId: users[1], courseId: courses[0], score: 70.00001, requestId: randomUUID() },
    });
    const highRetake = await produceSemesterAllocationPreview(users[0], scope());
    expect(
      highRetake.result.input.students.every(
        (student) => !student.candidates.some((choice) => choice.courseId === courses[4]),
      ),
    ).toBe(true);
  });

  it('retains physical training planning credits in the captured catalog and budget', async () => {
    const training = await prisma.course.findUniqueOrThrow({
      where: { id: physicalCourseId },
      select: { credits: true },
    });
    expect(training.credits).toBeGreaterThan(0);
    await prisma.curriculumCourse.deleteMany({ where: { curriculumId: contexts[0] } });
    const membership = await prisma.curriculumCourse.create({
      data: { curriculumId: contexts[0], courseId: physicalCourseId },
    });
    await prisma.curriculumPlacement.create({
      data: {
        curriculumCourseId: membership.id,
        academicYear: 1,
        academicSemester: 1,
        sourceOrder: 0,
      },
    });
    await prisma.studentRecord.createMany({
      data: [users[1], users[2]].map((userId) => planned(userId, physicalCourseId)),
    });
    config.cohortDemandPolicy = Object.freeze({ maxCredits: training.credits, maxDifficulty: 5 });
    const produced = await produceSemesterAllocationPreview(users[0], scope());
    expect(produced.result.input.courses).toEqual([
      { courseId: physicalCourseId, credits: training.credits },
    ]);
    expect(
      produced.result.students.every(
        (student) => student.assignedCredits === training.credits && student.remainingCredits === 0,
      ),
    ).toBe(true);
  });

  it('terminates finite zero-credit choices while reporting configured target shortfalls', async () => {
    await prisma.curriculumCourse.deleteMany({ where: { curriculumId: contexts[0] } });
    await addMember(3);
    config.cohortDemandPolicy = Object.freeze({ maxCredits: 1, maxDifficulty: 5 });
    const produced = await produceSemesterAllocationPreview(users[0], scope());
    expect(produced.result.input.courses).toEqual([{ courseId: courses[3], credits: 0 }]);
    expect(produced.preview.result).toMatchObject({
      studentCount: 2,
      assignedStudentCount: 2,
      assignedCourseCount: 2,
      totalTargetCredits: 2,
      totalAssignedCredits: 0,
      totalRemainingCredits: 2,
      rounds: 1,
      stopReasonCounts: { NO_REMAINING_CHOICES: 2 },
    });
  });

  it('captures current unlock utilities without completing prerequisites or exposing private scores', async () => {
    config.allocationUtilityPolicy = Object.freeze({
      difficultyFitWeight: 0,
      immediateUnlockWeight: 1,
    });
    await prisma.curriculumPrerequisite.create({
      data: {
        curriculumId: contexts[0],
        courseId: courses[1],
        prerequisiteId: courses[0],
        isStrict: false,
        isCorequisite: true,
      },
    });
    const before = await evidence();
    const produced = await produceSemesterAllocationPreview(users[0], scope());
    for (const student of produced.result.input.students) {
      expect(
        student.candidates.find((candidate) => candidate.courseId === courses[0])?.studentUtility,
      ).toBe(0.5);
      expect(
        student.candidates.find((candidate) => candidate.courseId === courses[2])?.studentUtility,
      ).toBe(0);
    }
    expect(produced.preview.utilityPolicy).toEqual(config.allocationUtilityPolicy);
    expect(JSON.stringify(produced.preview)).not.toContain('"studentUtility":');
    expect(await evidence()).toEqual(before);
  });

  it('uses Bayesian estimates and the curriculum vote prior for difficulty utility', async () => {
    config.allocationUtilityPolicy = Object.freeze({
      difficultyFitWeight: 1,
      immediateUnlockWeight: 0,
    });
    await prisma.courseRating.createMany({
      data: [
        { userId: users[1], courseId: courses[0], rating: 1 },
        { userId: users[1], courseId: courses[1], rating: 5 },
      ],
    });
    await prisma.course.update({
      where: { id: courses[0] },
      data: { avgRating: 1, ratingCount: 1 },
    });
    await prisma.course.update({
      where: { id: courses[1] },
      data: { avgRating: 5, ratingCount: 1 },
    });
    const before = await evidence();
    const produced = await produceSemesterAllocationPreview(users[0], scope());
    // Member votes give prior 3, strength 5: estimates 8/3, 10/3 and cold-start 3.
    for (const student of produced.result.input.students) {
      expect(
        student.candidates.find((candidate) => candidate.courseId === courses[0])?.studentUtility,
      ).toBeCloseTo(7 / 12, 12);
      expect(
        student.candidates.find((candidate) => candidate.courseId === courses[1])?.studentUtility,
      ).toBeCloseTo(5 / 12, 12);
      expect(
        student.candidates.find((candidate) => candidate.courseId === courses[2])?.studentUtility,
      ).toBeCloseTo(0.5, 12);
    }
    expect(await evidence()).toEqual(before);
  });

  it('holds credits, choices and resources in one production snapshot after a real writer commits', async () => {
    const initial = await readSemesterAllocationPreview(users[0], scope());
    let committed = false;
    afterTransactionalActorRead = async () => {
      await prisma.$transaction(async (write) => {
        await write.course.update({ where: { id: courses[0] }, data: { credits: 5 } });
        await write.schoolResource.updateMany({
          where: scope(),
          data: { professors: 1, classrooms: 1, maxStudentsPerSection: 1, revision: 2 },
        });
        await write.studentRecord.update({
          where: { userId_courseId: { userId: users[1], courseId: courses[1] } },
          data: { status: 'COMPLETED' },
        });
        await write.user.update({ where: { id: users[2] }, data: { curriculumId: contexts[1] } });
      });
      committed = true;
    };
    expect(await readSemesterAllocationPreview(users[0], scope())).toEqual(initial);
    expect(committed).toBe(true);
    const latest = await readSemesterAllocationPreview(users[0], scope());
    expect(latest.result).toMatchObject({
      studentCount: 1,
      envelope: { resourceRevision: 2 },
      totalTargetCredits: 6,
    });
    expect(latest.result.courses.find((course) => course.courseId === courses[0])?.credits).toBe(5);
    expect(latest).not.toEqual(initial);
  });

  it('freezes every configured policy before its first awaited actor SELECT', async () => {
    const initial = await readSemesterAllocationPreview(users[0], scope());
    afterTransactionalActorRead = async () => {
      config.cohortDemandPolicy = Object.freeze({ maxCredits: 3, maxDifficulty: 1 });
      config.simulationResourcePolicy = Object.freeze({
        ...original.envelope,
        classroomTimeBlocks: 0,
        sectionsPerProfessor: 0,
      });
      config.simulationAllocationPolicy = Object.freeze({
        studentUtilityWeight: 0,
        resourceFitWeight: 1,
        fairnessWeight: 0,
        congestionThreshold: 0,
      });
      config.allocationUtilityPolicy = Object.freeze({
        difficultyFitWeight: 0,
        immediateUnlockWeight: 1,
      });
    };
    expect(await readSemesterAllocationPreview(users[0], scope())).toEqual(initial);
    const latest = await readSemesterAllocationPreview(users[0], scope());
    expect(latest).toMatchObject({
      recommendationPolicy: { maxCredits: 3, maxDifficulty: 1 },
      utilityPolicy: { difficultyFitWeight: 0, immediateUnlockWeight: 1 },
      result: { totalTargetCredits: 6, envelope: { envelope: { sharedSectionCeiling: 0 } } },
    });
  });

  it('rejects over 500 scoped students before any progress or grade history query', async () => {
    const extra = Array.from({ length: 499 }, () => randomUUID());
    await prisma.user.createMany({
      data: extra.map((id) => ({
        id,
        studentId: id,
        email: `${id}@example.test`,
        name: 'Bounded cohort fixture',
        role: 'STUDENT',
        curriculumId: contexts[0],
      })),
    });
    try {
      const response = await get();
      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/500/);
      expect(historyReads).toBe(0);
      for (const id of extra) expect(JSON.stringify(response.body)).not.toContain(id);
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: extra } } });
    }
  });

  it('supports exactly 500 scoped students with small bounded choice sets', async () => {
    const extra = Array.from({ length: 498 }, () => randomUUID());
    await prisma.user.createMany({
      data: extra.map((id) => ({
        id,
        studentId: id,
        email: `${id}@example.test`,
        name: 'Boundary cohort fixture',
        role: 'STUDENT',
        curriculumId: contexts[0],
      })),
    });
    try {
      const preview = await readSemesterAllocationPreview(users[0], scope());
      expect(preview.result.studentCount).toBe(500);
      expect(preview.result.totalTargetCredits).toBe(3000);
      expect(preview.result.assignedCourseCount).toBeLessThanOrEqual(6);
      expect(JSON.stringify(preview)).not.toContain(extra[0]);
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: extra } } });
    }
  });

  it.each(['individual', 'total'] as const)(
    'rejects oversized %s supplied choice unions',
    async (kind) => {
      const extraCourses = Array.from({ length: kind === 'individual' ? 98 : 18 }, () =>
        randomUUID(),
      );
      const extraUsers = kind === 'total' ? Array.from({ length: 499 }, () => randomUUID()) : [];
      await prisma.course.createMany({
        data: extraCourses.map((id, index) => ({
          id,
          code: `${prefix}-bound-${index}`,
          name: 'Choice bound fixture',
          credits: 0,
          difficultyLevel: 2,
          semesterOffered: [],
        })),
      });
      await prisma.curriculumCourse.createMany({
        data: extraCourses.map((courseId) => ({ curriculumId: contexts[0], courseId })),
      });
      const placements = await prisma.curriculumCourse.findMany({
        where: { curriculumId: contexts[0], courseId: { in: extraCourses } },
        select: { id: true },
      });
      await prisma.curriculumPlacement.createMany({
        data: placements.map(({ id }, index) => ({
          curriculumCourseId: id,
          academicYear: 1,
          academicSemester: 1,
          sourceOrder: index + 10,
        })),
      });
      if (extraUsers.length) {
        // Keep the supported cohort at 500; twenty-one choices each exceed the total bound.
        await prisma.user.update({ where: { id: users[2] }, data: { curriculumId: contexts[1] } });
        await prisma.user.createMany({
          data: extraUsers.map((id) => ({
            id,
            studentId: id,
            email: `${id}@example.test`,
            name: 'Total choice fixture',
            role: 'STUDENT',
            curriculumId: contexts[0],
          })),
        });
      }
      const roster = kind === 'individual' ? [users[1]] : [users[1], ...extraUsers];
      await prisma.studentRecord.createMany({
        data: roster.flatMap((userId) => extraCourses.map((courseId) => planned(userId, courseId))),
      });
      if (kind === 'total')
        await prisma.studentRecord.createMany({
          data: extraUsers.flatMap((userId) =>
            courses.slice(0, 3).map((courseId) => planned(userId, courseId)),
          ),
        });
      try {
        const response = await get();
        expect(response.status).toBe(409);
        expect(response.body.error).toMatch(/100|10000/);
      } finally {
        await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
        await prisma.curriculumCourse.deleteMany({
          where: { curriculumId: contexts[0], courseId: { in: extraCourses } },
        });
        await prisma.course.deleteMany({ where: { id: { in: extraCourses } } });
      }
    },
  );

  it.each(['credits', 'policy'] as const)(
    'returns a private-free generic failure for unsupported %s',
    async (kind) => {
      if (kind === 'credits')
        await prisma.course.update({ where: { id: courses[0] }, data: { credits: 11 } });
      else
        config.allocationUtilityPolicy = Object.freeze({
          difficultyFitWeight: 1,
          immediateUnlockWeight: 1,
        });
      const before = await evidence();
      const response = await get();
      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        success: false,
        error: 'Could not load semester allocation preview',
      });
      for (const id of users) expect(JSON.stringify(response.body)).not.toContain(id);
      expect(await evidence()).toEqual(before);
    },
  );
});
