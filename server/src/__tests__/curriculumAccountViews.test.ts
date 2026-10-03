import { randomUUID } from 'crypto';
import request from 'supertest';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';

describe('contextual account profile and raw record views (PostgreSQL)', () => {
  const prefix = `account-context-${randomUUID()}`;
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const adminId = randomUUID();
  const aliasId = randomUUID();
  const userIds = [ownerId, otherId, adminId, aliasId];
  const contextId = randomUUID();
  const otherContextId = randomUUID();
  const emptyContextId = randomUUID();
  const courseA = randomUUID();
  const courseB = randomUUID();
  const historicalId = randomUUID();
  const zeroId = randomUUID();
  const ownedCourseIds = [courseA, courseB, historicalId, zeroId];
  let ptId: string;
  let createdPt = false;
  const cookie = (id: string = ownerId) => `${AUTH_COOKIE_NAME}=${issueToken(id)}`;
  const get = (suffix = '', identifier: string = ownerId, actor: string = ownerId) =>
    request(app).get(`/api/users/${identifier}${suffix}`).set('Cookie', cookie(actor));
  const attempt = (courseId: string, score: number) =>
    prisma.gradeAttempt.create({
      data: { userId: ownerId, courseId, score, requestId: randomUUID() },
    });

  beforeAll(async () => {
    await prisma.curriculum.createMany({
      data: [contextId, otherContextId, emptyContextId].map((id) => ({
        id,
        code: `${prefix}-${id}`,
        name: 'Simulated account context',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/simulated',
        isGpaPath: true,
      })),
    });
    await prisma.user.createMany({
      data: userIds.map((id) => ({
        id,
        studentId: id === aliasId ? ownerId : `${prefix}-${id}`,
        email: `${prefix}-${id}@example.test`,
        name: 'Account context fixture',
        password: 'legacy-private-value',
        passwordHash: 'hash-private-value',
        role: id === adminId ? 'ADMIN' : 'STUDENT',
        curriculumId: id === ownerId ? contextId : null,
      })),
    });
    await prisma.course.createMany({
      data: ownedCourseIds.map((id) => ({
        id,
        code: `${prefix}-${id}`,
        name: 'Shared global course',
        credits: id === courseB ? 4 : id === historicalId ? 9 : id === zeroId ? 0 : 3,
        difficultyLevel: 2,
        academicYear: 4,
        academicSemester: 2,
        electiveGroup: 'Legacy global group',
      })),
    });
    const existing = await prisma.course.findUnique({ where: { code: 'PT001IU' } });
    if (existing) ptId = existing.id;
    else {
      ptId = randomUUID();
      await prisma.course.create({
        data: {
          id: ptId,
          code: 'PT001IU',
          name: 'Physical Training 1',
          credits: 3,
          difficultyLevel: 2,
        },
      });
      createdPt = true;
    }
    await prisma.curriculumCourse.createMany({
      data: [courseA, courseB, zeroId, ptId].map((courseId) => ({
        curriculumId: contextId,
        courseId,
      })),
    });
    await prisma.curriculumCourse.createMany({
      data: [courseA, historicalId].map((courseId) => ({
        curriculumId: otherContextId,
        courseId,
      })),
    });
    for (const curriculumId of [contextId, otherContextId]) {
      const member = await prisma.curriculumCourse.findUniqueOrThrow({
        where: { curriculumId_courseId: { curriculumId, courseId: courseA } },
      });
      await prisma.curriculumPlacement.create({
        data: {
          curriculumCourseId: member.id,
          sourceOrder: 0,
          academicYear: curriculumId === contextId ? 1 : 3,
          academicSemester: 1,
          electiveGroup:
            curriculumId === contextId ? 'Active context group' : 'Other context group',
          electiveSelectCount: 1,
        },
      });
    }
    await prisma.prerequisite.create({
      data: { courseId: courseA, prerequisiteId: historicalId },
    });
  });

  beforeEach(async () => {
    await prisma.user.update({ where: { id: ownerId }, data: { curriculumId: contextId } });
    await prisma.curriculum.update({ where: { id: contextId }, data: { isGpaPath: true } });
    await prisma.courseRating.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.gradeAttempt.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.studentRecord.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.studyPlan.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.studentRecord.createMany({
      data: [
        {
          userId: ownerId,
          courseId: courseA,
          status: 'COMPLETED',
          grade: 'B+',
          gradePoints: 3.5,
          electiveGroup: 'Stored legacy claim',
        },
        {
          userId: ownerId,
          courseId: courseB,
          status: 'PLANNED',
          electiveGroup: 'Saved plan claim',
        },
        {
          userId: ownerId,
          courseId: historicalId,
          status: 'COMPLETED',
          grade: 'A',
          gradePoints: 4,
          electiveGroup: 'Historical claim',
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.curriculum.deleteMany({
      where: { id: { in: [contextId, otherContextId, emptyContextId] } },
    });
    await prisma.course.deleteMany({ where: { id: { in: ownedCourseIds } } });
    if (createdPt) await prisma.course.deleteMany({ where: { id: ptId } });
    await prisma.$disconnect();
  });

  it('uses active membership placements instead of global or another context metadata', async () => {
    const profile = await get();
    expect(profile.status).toBe(200);
    expect(profile.body.data.studentRecords).toHaveLength(2);
    const record = profile.body.data.studentRecords.find(
      (item: { courseId: string }) => item.courseId === courseA,
    );
    expect(record.course).toMatchObject({
      id: courseA,
      placements: [{ academicYear: 1, academicSemester: 1, electiveGroup: 'Active context group' }],
    });
    expect(record.course).not.toHaveProperty('academicYear');
    expect(record.course).not.toHaveProperty('electiveGroup');
    expect(record.course).not.toHaveProperty('prerequisites');
    expect(profile.body.data.stats).toMatchObject({
      totalCourses: 2,
      completedCourses: 1,
      totalCredits: 3,
    });
  });

  it('separates nonmember history while preserving original letter grades and elective claims', async () => {
    for (const suffix of ['', '/records']) {
      const response = await get(suffix);
      expect(response.status).toBe(200);
      const active = suffix ? response.body.data.records : response.body.data.studentRecords;
      expect(active.find((item: { courseId: string }) => item.courseId === courseA)).toMatchObject({
        grade: 'B+',
        gradePoints: 3.5,
        electiveGroup: 'Stored legacy claim',
      });
      expect(response.body.data.historicalRecords).toHaveLength(1);
      expect(response.body.data.historicalRecords[0]).toMatchObject({
        courseId: historicalId,
        grade: 'A',
        gradePoints: 4,
        electiveGroup: 'Historical claim',
      });
      expect(Object.keys(response.body.data.historicalRecords[0].course).sort()).toEqual([
        'code',
        'credits',
        'id',
        'name',
      ]);
    }
  });

  it('returns a scoped records object with an active-only envelope count', async () => {
    const response = await get('/records');
    expect(response.status).toBe(200);
    expect(response.body.count).toBe(2);
    expect(response.body.data.records).toHaveLength(2);
    expect(response.body.data.scope).toMatchObject({
      curriculumId: contextId,
      usage: 'REFERENCE_ONLY',
    });
    expect(
      response.body.data.records.map((item: { status: string }) => item.status).sort(),
    ).toEqual(['COMPLETED', 'PLANNED']);
  });

  it('does not fall back to the global catalog for an empty assigned context', async () => {
    await prisma.user.update({ where: { id: ownerId }, data: { curriculumId: emptyContextId } });
    const profile = await get();
    expect(profile.status).toBe(200);
    expect(profile.body.data.studentRecords).toEqual([]);
    expect(profile.body.data.historicalRecords).toHaveLength(3);
    expect(profile.body.data.stats).toMatchObject({
      totalCourses: 0,
      completedCourses: 0,
      totalCredits: 0,
      gpa100: null,
      gpaPath: null,
      gradedCredits: 0,
      gradedCourseCount: 0,
    });
    expect(profile.body.data.scope.ratingPrior).toBeNull();
    const records = await get('/records');
    expect(records.body.count).toBe(0);
    expect(records.body.data.records).toEqual([]);
    expect(records.body.data.historicalRecords).toHaveLength(3);
  });

  it('uses highest numeric retakes and member credit weights even for planned records', async () => {
    await attempt(courseA, 40);
    await attempt(courseA, 80);
    await attempt(courseA, 60);
    await attempt(courseB, 60);
    await attempt(historicalId, 100);
    await prisma.gradeAttempt.create({
      data: { userId: otherId, courseId: courseA, requestId: randomUUID(), score: 100 },
    });
    const profile = await get();
    expect(profile.status).toBe(200);
    expect(profile.body.data.stats).toMatchObject({
      gradedCredits: 7,
      gradedCourseCount: 2,
      gpaPath: 'ALTERNATIVE',
    });
    expect(profile.body.data.stats.gpa100).toBeCloseTo((80 * 3 + 60 * 4) / 7, 12);
    expect(profile.body.data.stats).not.toHaveProperty('gpa');
    expect(
      profile.body.data.studentRecords.find(
        (item: { courseId: string }) => item.courseId === courseA,
      ),
    ).toMatchObject({ grade: 'B+', gradePoints: 3.5 });
  });

  it('excludes PT and zero credits from GPA and PT from earned totals', async () => {
    await prisma.studentRecord.createMany({
      data: [ptId, zeroId].map((courseId) => ({ userId: ownerId, courseId, status: 'COMPLETED' })),
    });
    await attempt(courseA, 80);
    await attempt(ptId, 0);
    await attempt(zeroId, 0);
    const profile = await get();
    expect(profile.status).toBe(200);
    expect(profile.body.data.stats).toMatchObject({
      totalCourses: 4,
      completedCourses: 3,
      totalCredits: 3,
      gpa100: 80,
      gradedCredits: 3,
      gradedCourseCount: 1,
      gpaPath: 'THESIS',
    });
  });

  it('uses exact server GPA eligibility rather than the rounded display value', async () => {
    await attempt(courseA, 70);
    expect((await get()).body.data.stats).toMatchObject({ gpa100: 70, gpaPath: 'ALTERNATIVE' });
    await attempt(courseA, 70.000001);
    const stats = (await get()).body.data.stats;
    expect(stats).toMatchObject({ gpa100: 70.000001, gpaPath: 'THESIS' });
    expect(Math.round(stats.gpa100 * 100) / 100).toBe(70);
  });

  it('leaves the path null for a nonfork curriculum or absent member numeric grades', async () => {
    expect((await get()).body.data.stats).toMatchObject({
      gpa100: null,
      gpaPath: null,
      gradedCredits: 0,
    });
    await attempt(historicalId, 100);
    expect((await get()).body.data.stats).toMatchObject({ gpa100: null, gpaPath: null });
    await attempt(courseA, 80);
    await prisma.curriculum.update({ where: { id: contextId }, data: { isGpaPath: false } });
    expect((await get()).body.data.stats).toMatchObject({ gpa100: 80, gpaPath: null });
  });

  it('uses context vote priors and never exposes password fields', async () => {
    await prisma.courseRating.createMany({
      data: [
        { userId: ownerId, courseId: courseA, rating: 5 },
        { userId: otherId, courseId: historicalId, rating: 1 },
      ],
    });
    for (const suffix of ['', '/records']) {
      const response = await get(suffix);
      expect(response.status).toBe(200);
      expect(response.body.data.scope.ratingPrior).toEqual({
        mean: 5,
        source: 'CURRICULUM_RATINGS',
      });
      const active = suffix ? response.body.data.records : response.body.data.studentRecords;
      const member = active.find((item: { courseId: string }) => item.courseId === courseB);
      expect(member.course).toMatchObject({
        ratingDifficulty: 5,
        ratingPriorMean: 5,
        ratingPriorSource: 'CURRICULUM_RATINGS',
        ratingCount: 0,
      });
      expect(JSON.stringify(response.body)).not.toContain('private-value');
      expect(response.body.data).not.toHaveProperty('password');
      expect(response.body.data).not.toHaveProperty('passwordHash');
    }
  });

  it('preserves active historical plan snapshots without validating or recalculating them', async () => {
    const saved = await prisma.studyPlan.create({
      data: {
        userId: ownerId,
        name: 'Old active plan',
        semesters: {
          create: {
            semester: 'FALL',
            year: 2026,
            courses: [{ courseId: historicalId, position: 7 }],
            totalCredits: 987,
            difficultyScore: 4.75,
          },
        },
      },
      include: { semesters: true },
    });
    await prisma.studyPlan.create({
      data: { userId: ownerId, name: 'Hidden inactive plan', isActive: false },
    });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body.data.studyPlans).toEqual(JSON.parse(JSON.stringify([saved])));
    expect(response.body.data.scope.studyPlansValidated).toBe(false);
    expect(
      await prisma.studyPlan.findUniqueOrThrow({
        where: { id: saved.id },
        include: { semesters: true },
      }),
    ).toEqual(saved);
  });

  it('preserves owner aliases and admin reads while blocking unauthorized or invalid sessions', async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    for (const suffix of ['', '/records']) {
      expect((await get(suffix)).status).toBe(200);
      expect((await get(suffix, owner.studentId)).status).toBe(200);
      expect((await get(suffix, ownerId, adminId)).status).toBe(200);
      expect((await get(suffix, ownerId, otherId)).status).toBe(403);
      expect((await get(suffix, ownerId, aliasId)).status).toBe(403);
      expect((await request(app).get(`/api/users/${ownerId}${suffix}`)).status).toBe(401);
      expect(
        (
          await request(app)
            .get(`/api/users/${ownerId}${suffix}`)
            .set('Cookie', `${AUTH_COOKIE_NAME}=invalid`)
        ).status,
      ).toBe(401);
      expect((await get(suffix, randomUUID(), adminId)).status).toBe(404);
    }
  });

  it('retains legacy profile GPA and raw record arrays for unassigned accounts', async () => {
    await prisma.user.update({ where: { id: ownerId }, data: { curriculumId: null } });
    const profile = await get();
    expect(profile.status).toBe(200);
    expect(profile.body.data.studentRecords).toHaveLength(3);
    expect(profile.body.data.stats).toEqual({
      totalCourses: 3,
      completedCourses: 2,
      totalCredits: 12,
      gpa: 3.75,
    });
    expect(profile.body.data).not.toHaveProperty('scope');
    expect(profile.body.data).not.toHaveProperty('historicalRecords');
    const records = await get('/records');
    expect(records.status).toBe(200);
    expect(Array.isArray(records.body.data)).toBe(true);
    expect(records.body.count).toBe(3);
    const active = records.body.data.find(
      (item: { courseId: string }) => item.courseId === courseA,
    );
    expect(active.course).toMatchObject({
      academicYear: 4,
      electiveGroup: 'Legacy global group',
      prerequisites: [{ prerequisiteId: historicalId, prerequisite: { id: historicalId } }],
      isPrerequisiteFor: [],
    });
    expect(active.course).not.toHaveProperty('placements');
  });
});
