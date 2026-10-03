import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';

describe('account-scoped reference semester preview API (PostgreSQL)', () => {
  const prefix = `semester-preview-${randomUUID()}`;
  const contexts = Array.from({ length: 3 }, () => randomUUID());
  const users = Array.from({ length: 3 }, () => randomUUID());
  const ids = Array.from({ length: 6 }, () => randomUUID());
  const [parent, dependent, elective, outsider, unplaced, repeated] = ids;
  const createdSourceIds: string[] = [];
  let thesis: string;
  let alternative: string;
  const cookie = (actor = 0) => `${AUTH_COOKIE_NAME}=${issueToken(users[actor])}`;
  const preview = (actor: number | null = 0, body: object = { intensityMode: 'normal' }) => {
    const query = request(app).post('/api/recommendations/plan-semester');
    if (actor !== null) query.set('Cookie', cookie(actor));
    return query.send(body);
  };
  const record = (courseId: string, status: 'PLANNED' | 'COMPLETED' | 'IN_PROGRESS', actor = 0) =>
    prisma.studentRecord.create({
      data: {
        userId: users[actor],
        courseId,
        status,
        grade: 'B+',
        gradePoints: 3.5,
        electiveGroup: 'Stored private claim',
      },
    });
  const grade = (courseId: string, score: number, actor = 0) =>
    prisma.gradeAttempt.create({
      data: { userId: users[actor], courseId, score, requestId: randomUUID() },
    });
  const scheduledIds = (slots: { courseIds: string[] }[]) =>
    slots.flatMap(({ courseIds }) => courseIds);

  beforeAll(async () => {
    await prisma.course.createMany({
      data: ids.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated preview course',
        credits: 3,
        difficultyLevel: 2,
        academicYear: 4,
        academicSemester: 2,
        electiveGroup: 'Wrong global placement',
        category: 'CORE',
      })),
    });
    for (const code of ['IT058IU', 'IT168IU']) {
      let course = await prisma.course.findUnique({ where: { code } });
      if (!course) {
        course = await prisma.course.create({
          data: { code, name: code, credits: code === 'IT058IU' ? 10 : 3, difficultyLevel: 2 },
        });
        createdSourceIds.push(course.id);
      }
      if (code === 'IT058IU') thesis = course.id;
      else alternative = course.id;
    }
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated preview context',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference-preview',
        isGpaPath: index === 0,
      })),
    });
    for (const [contextIndex, members] of [
      [0, [parent, dependent, elective, unplaced, repeated, thesis, alternative]],
      [1, [parent, dependent, outsider]],
    ] as const) {
      for (const [index, courseId] of members.entries()) {
        const membership = await prisma.curriculumCourse.create({
          data: { curriculumId: contexts[contextIndex], courseId },
        });
        if (courseId === unplaced) continue;
        await prisma.curriculumPlacement.create({
          data: {
            curriculumCourseId: membership.id,
            academicYear: courseId === thesis || courseId === alternative ? 4 : contextIndex + 1,
            academicSemester:
              courseId === dependent || courseId === thesis || courseId === alternative ? 2 : 1,
            sourceOrder: index,
            electiveGroup:
              courseId === elective || courseId === repeated ? 'Simulated option group' : null,
            electiveSelectCount: courseId === elective || courseId === repeated ? 1 : null,
          },
        });
        if (courseId === repeated) {
          await prisma.curriculumPlacement.create({
            data: {
              curriculumCourseId: membership.id,
              academicYear: 3,
              academicSemester: 2,
              sourceOrder: 20,
              electiveGroup: 'Later option group',
              electiveSelectCount: 1,
            },
          });
        }
      }
    }
    await prisma.curriculumPrerequisite.createMany({
      data: [
        {
          curriculumId: contexts[0],
          courseId: dependent,
          prerequisiteId: parent,
          isStrict: false,
          isCorequisite: true,
        },
        {
          curriculumId: contexts[1],
          courseId: dependent,
          prerequisiteId: outsider,
          isStrict: false,
        },
      ],
    });
    await prisma.prerequisite.create({ data: { courseId: dependent, prerequisiteId: elective } });
    await prisma.curriculumRequirement.create({
      data: {
        curriculumId: contexts[0],
        name: 'Unresolved free elective',
        credits: 3,
        academicYear: 3,
        academicSemester: 2,
        sourceOrder: 99,
        sourceLabel: 'Unverified reference requirement',
      },
    });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        name: 'Simulated preview student',
        email: `${id}@example.test`,
        password: 'private-preview-password',
        passwordHash: 'private-preview-hash',
        curriculumId: index < 2 ? contexts[index] : null,
      })),
    });
  });

  beforeEach(async () => {
    await prisma.studentRecord.deleteMany({ where: { userId: { in: users } } });
    await prisma.gradeAttempt.deleteMany({ where: { userId: { in: users } } });
    await prisma.courseRating.deleteMany({ where: { userId: { in: users } } });
    await prisma.studyPlan.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[0] } });
    await prisma.curriculum.update({ where: { id: contexts[0] }, data: { isGpaPath: true } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: [...ids, ...createdSourceIds] } } });
    await prisma.$disconnect();
  });

  it('previews only stored planned members and uses earlier context slots to unlock dependents', async () => {
    await record(parent, 'PLANNED');
    await record(dependent, 'PLANNED');
    const response = await preview();
    expect(response.status).toBe(200);
    expect(scheduledIds(response.body.data.slots)).toEqual([parent, dependent]);
    expect(response.body.data.slots).toMatchObject([
      { academicYear: 1, academicSemester: 1, courseIds: [parent], totalCredits: 3 },
      { academicYear: 1, academicSemester: 2, courseIds: [dependent], totalCredits: 3 },
    ]);
    expect(response.body.data.courses.map((course: { id: string }) => course.id)).toEqual([
      parent,
      dependent,
    ]);
    expect(response.body.data.courses[0]).not.toHaveProperty('category');
    expect(response.body.data.courses[0]).not.toHaveProperty('academicYear');
    expect(response.body.data.unscheduled).toEqual([]);
    expect(response.body.data.stats).toMatchObject({
      selectedCourseCount: 2,
      scheduledCourseCount: 2,
      selectedCredits: 6,
    });
  });

  it('ignores forged completion IDs for an assigned session and cannot unlock a missing parent', async () => {
    await record(dependent, 'PLANNED');
    const response = await preview(0, {
      intensityMode: 'normal',
      completedCourseIds: [parent, elective, outsider],
    });
    expect(response.status).toBe(200);
    expect(response.body.data.slots).toEqual([]);
    expect(response.body.data.unscheduled).toEqual([
      { courseId: dependent, reason: 'UNMET_PREREQUISITE' },
    ]);
    expect(response.body.data.stats.scheduledCourseCount).toBe(0);
  });

  it('uses saved completion and all contextual prerequisite flags without unioning global edges', async () => {
    await record(parent, 'COMPLETED');
    await record(dependent, 'PLANNED');
    const response = await preview(0, { intensityMode: 'normal', completedCourseIds: [] });
    expect(response.status).toBe(200);
    expect(scheduledIds(response.body.data.slots)).toEqual([dependent]);
    expect(response.body.data.unscheduled).toEqual([]);
  });

  it('resolves each cookie account own context and prerequisite set', async () => {
    await record(dependent, 'PLANNED');
    await record(outsider, 'COMPLETED', 1);
    await record(dependent, 'PLANNED', 1);
    const other = await preview(1);
    expect(other.status).toBe(200);
    expect(other.body.data.scope.curriculumId).toBe(contexts[1]);
    expect(other.body.data.slots).toMatchObject([
      { academicYear: 2, academicSemester: 2, courseIds: [dependent] },
    ]);
    const owner = await preview();
    expect(owner.body.data.scope.curriculumId).toBe(contexts[0]);
    expect(owner.body.data.slots).toEqual([]);
  });

  it('projects global vote evidence using only the active context prior', async () => {
    await record(elective, 'PLANNED');
    await prisma.courseRating.createMany({
      data: [
        { userId: users[2], courseId: parent, rating: 1 },
        { userId: users[2], courseId: outsider, rating: 5 },
      ],
    });
    const response = await preview();
    expect(response.status).toBe(200);
    expect(response.body.data.scope.ratingPrior).toEqual({ mean: 1, source: 'CURRICULUM_RATINGS' });
    expect(response.body.data.courses[0]).toMatchObject({
      ratingCount: 0,
      ratingDifficulty: 1,
      ratingPriorMean: 1,
      ratingPriorSource: 'CURRICULUM_RATINGS',
    });
    expect(response.body.data.slots[0].averageDifficulty).toBe(1);
  });

  it('uses highest member retakes for the GPA fork and ignores nonmember or other-account grades', async () => {
    await record(thesis, 'PLANNED');
    await record(alternative, 'PLANNED');
    await grade(parent, 40);
    await grade(parent, 90);
    await grade(parent, 50);
    await grade(outsider, 0);
    await grade(parent, 0, 1);
    const response = await preview();
    expect(response.status).toBe(200);
    expect(response.body.data.gpaPath).toBe('THESIS');
    expect(scheduledIds(response.body.data.slots)).toEqual([thesis]);
    expect(response.body.data.unscheduled).toEqual([
      { courseId: alternative, reason: 'GPA_EXCLUDED' },
    ]);
  });

  it('preserves exact-70 alternative eligibility and null/nonfork choices', async () => {
    await record(thesis, 'PLANNED');
    await record(alternative, 'PLANNED');
    await grade(parent, 70);
    let response = await preview();
    expect(response.body.data.gpaPath).toBe('ALTERNATIVE');
    expect(scheduledIds(response.body.data.slots)).toEqual([alternative]);
    await prisma.gradeAttempt.deleteMany({ where: { userId: users[0] } });
    response = await preview();
    expect(response.body.data.gpaPath).toBeNull();
    expect(scheduledIds(response.body.data.slots).sort()).toEqual([thesis, alternative].sort());
    await grade(parent, 99);
    await prisma.curriculum.update({ where: { id: contexts[0] }, data: { isGpaPath: false } });
    response = await preview();
    expect(response.body.data.gpaPath).toBeNull();
    expect(scheduledIds(response.body.data.slots).sort()).toEqual([thesis, alternative].sort());
  });

  it('counts repeated elective appearances once and excludes in-progress courses from selection', async () => {
    await record(repeated, 'PLANNED');
    await record(parent, 'IN_PROGRESS');
    const response = await preview();
    expect(response.status).toBe(200);
    expect(scheduledIds(response.body.data.slots)).toEqual([repeated]);
    expect(response.body.data.courses).toHaveLength(1);
    expect(response.body.data.courses[0].placements).toHaveLength(2);
    expect(response.body.data.stats).toMatchObject({
      selectedCourseCount: 1,
      scheduledCourseCount: 1,
      selectedCredits: 3,
      scheduledCredits: 3,
    });
  });

  it('reports unplaced selection and separates nonmember planned history without global fallback', async () => {
    await record(unplaced, 'PLANNED');
    await record(outsider, 'PLANNED');
    const response = await preview();
    expect(response.status).toBe(200);
    expect(response.body.data.slots).toEqual([]);
    expect(response.body.data.courses.map((course: { id: string }) => course.id)).toEqual([
      unplaced,
    ]);
    expect(response.body.data.ignoredPlannedIds).toEqual([outsider]);
    expect(response.body.data.unscheduled).toEqual([{ courseId: unplaced, reason: 'UNPLACED' }]);
  });

  it('returns an empty assigned context rather than the legacy global catalog', async () => {
    await record(parent, 'PLANNED');
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[2] } });
    const response = await preview();
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      scope: { curriculumId: contexts[2], ratingPrior: null },
      courses: [],
      slots: [],
      unscheduled: [],
      ignoredPlannedIds: [parent],
      stats: { selectedCourseCount: 0, scheduledCourseCount: 0 },
    });
  });

  it('retains unresolved requirements and unknown degree/calendar outcomes even for a fully scheduled selection', async () => {
    await record(elective, 'PLANNED');
    const response = await preview();
    expect(response.status).toBe(200);
    expect(response.body.data.scope).toMatchObject({
      usage: 'REFERENCE_ONLY',
      planningBasis: 'SELECTED_COURSES',
      electiveRequirementsValidated: false,
      calendarDatesAvailable: false,
      offeringValidationAvailable: false,
    });
    expect(response.body.data.requirements).toEqual([
      expect.objectContaining({
        kind: 'FREE_ELECTIVE',
        name: 'Unresolved free elective',
        credits: 3,
        sourceLabel: 'Unverified reference requirement',
      }),
    ]);
    expect(response.body.data.stats).toMatchObject({
      scheduledCourseCount: 1,
      unscheduledCourseCount: 0,
      totalRemainingCredits: null,
      semestersToCompletion: null,
      estimatedGraduation: null,
    });
    expect(response.body.data.stats).not.toHaveProperty('planningComplete');
  });

  it('rejects unknown body identities and invalid input rather than accepting account overrides', async () => {
    for (const body of [
      { intensityMode: 'normal', userId: users[1] },
      { intensityMode: 'normal', curriculumId: contexts[1] },
      { intensityMode: 'normal', plannedCourseIds: [dependent] },
      { intensityMode: 'normal', completedCourseIds: [42] },
      { intensityMode: 'invalid' },
      {},
    ]) {
      expect((await preview(0, body)).status).toBe(400);
    }
  });

  it('rejects invalid cookies and preserves guest/unassigned legacy response compatibility', async () => {
    const invalid = await request(app)
      .post('/api/recommendations/plan-semester')
      .set('Cookie', `${AUTH_COOKIE_NAME}=invalid`)
      .send({ intensityMode: 'normal' });
    expect(invalid.status).toBe(401);
    const deleted = await request(app)
      .post('/api/recommendations/plan-semester')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(randomUUID())}`)
      .send({ intensityMode: 'normal' });
    expect(deleted.status).toBe(401);
    const all = await prisma.course.findMany({ select: { id: true } });
    for (const actor of [null, 2]) {
      const response = await preview(actor, {
        intensityMode: 'normal',
        completedCourseIds: all.map(({ id }) => id),
      });
      expect(response.status).toBe(200);
      expect(response.body.data).not.toHaveProperty('scope');
      expect(response.body.data.semesters).toEqual([]);
      expect(response.body.data.nextRecommendedIds).toEqual([]);
      expect(response.body.data.nextRecommendedCourses).toEqual([]);
      expect(response.body.data.stats).toMatchObject({
        planningComplete: true,
        totalRemainingCredits: 0,
        estimatedGraduationSemester: null,
      });
    }
  });

  it('does not disclose private record/attempt/identity data or mutate any saved account history', async () => {
    await record(parent, 'COMPLETED');
    await record(dependent, 'PLANNED');
    const attempt = await grade(parent, 80.123);
    await prisma.studyPlan.create({
      data: {
        userId: users[0],
        name: 'Untouched saved plan',
        semesters: {
          create: {
            semester: 'FALL',
            year: 2026,
            courses: [{ courseId: outsider, position: 5 }],
            totalCredits: 777,
            difficultyScore: 4.7,
          },
        },
      },
    });
    const snapshot = async () => ({
      records: await prisma.studentRecord.findMany({
        where: { userId: users[0] },
        orderBy: { id: 'asc' },
      }),
      attempts: await prisma.gradeAttempt.findMany({
        where: { userId: users[0] },
        orderBy: { id: 'asc' },
      }),
      plans: await prisma.studyPlan.findMany({
        where: { userId: users[0] },
        include: { semesters: true },
        orderBy: { id: 'asc' },
      }),
      owner: await prisma.user.findUnique({ where: { id: users[0] } }),
    });
    const before = await snapshot();
    const response = await preview();
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(response.body);
    for (const secret of [
      'private-preview-password',
      'private-preview-hash',
      'Stored private claim',
      'Untouched saved plan',
      attempt.id,
      attempt.requestId,
      ...users,
    ])
      expect(serialized).not.toContain(secret);
    expect(response.body.data.courses[0]).not.toHaveProperty('grade');
    expect(response.body.data.courses[0]).not.toHaveProperty('score');
    expect(await snapshot()).toEqual(before);
  });
});
