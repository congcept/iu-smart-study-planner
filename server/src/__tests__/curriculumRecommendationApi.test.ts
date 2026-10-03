import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';

describe('curriculum-specific personalized recommendations (PostgreSQL)', () => {
  const prefix = `recommend-context-${randomUUID()}`;
  const courses: string[] = Array.from({ length: 6 }, () => randomUUID());
  const contexts: string[] = Array.from({ length: 3 }, () => randomUUID());
  const users: string[] = Array.from({ length: 5 }, () => randomUUID());
  const read = (owner = 0, session = owner, query: Record<string, unknown> = {}) =>
    request(app)
      .get(`/api/recommendations/user/${users[owner]}`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(users[session])}`)
      .query({ maxCredits: 30, maxDifficulty: 5, ...query });
  const record = (
    course: number,
    user = 0,
    status: 'COMPLETED' | 'IN_PROGRESS' | 'PLANNED' = 'COMPLETED',
  ) =>
    prisma.studentRecord.create({
      data: { userId: users[user], courseId: courses[course], status },
    });
  const ids = (response: request.Response): string[] =>
    response.body.data.courses.map((row: { id: string }) => row.id);
  beforeAll(async () => {
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated course',
        credits: 3,
        difficultyLevel: [1, 5, 1, 5, 2, 5][index],
        category: index === 2 ? 'ELECTIVE' : 'REQUIRED',
        academicYear: 4,
        academicSemester: 2,
        electiveGroup: 'Wrong global group',
        semesterOffered: index === 5 ? ['SPRING'] : ['FALL'],
      })),
    });
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated context',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
        isGpaPath: false,
      })),
    });
    for (const [context, indices] of [
      [0, [0, 2, 4, 5]],
      [1, [1, 2]],
    ] as const) {
      for (const index of indices)
        await prisma.curriculumCourse.create({
          data: {
            curriculumId: contexts[context],
            courseId: courses[index],
            placements:
              index === 4
                ? undefined
                : {
                    create: {
                      academicYear: 1,
                      academicSemester: 1,
                      sourceOrder: index,
                      sourceLabel: 'Simulated source',
                    },
                  },
          },
        });
    }
    await prisma.curriculumPrerequisite.createMany({
      data: [
        {
          curriculumId: contexts[0],
          courseId: courses[2],
          prerequisiteId: courses[0],
          isStrict: false,
          isCorequisite: true,
        },
        {
          curriculumId: contexts[1],
          courseId: courses[2],
          prerequisiteId: courses[1],
          isStrict: false,
        },
      ],
    });
    await prisma.prerequisite.create({
      data: { courseId: courses[2], prerequisiteId: courses[3] },
    });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        name: 'Simulated student',
        email: `${id}@example.test`,
        curriculumId: index < 2 ? contexts[index] : index === 4 ? contexts[2] : null,
        role: index === 3 ? 'ADMIN' : 'STUDENT',
      })),
    });
  });
  beforeEach(async () => {
    await prisma.studentRecord.deleteMany({ where: { userId: { in: users } } });
    await prisma.gradeAttempt.deleteMany({ where: { userId: { in: users } } });
    await prisma.courseRating.deleteMany({ where: { userId: { in: users } } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
    await prisma.$disconnect();
  });

  it('uses assigned context edges instead of the conflicting global prerequisite', async () => {
    await record(0);
    const response = await read();
    expect(response.status).toBe(200);
    expect(ids(response)).toEqual([courses[2], courses[5]]);
    expect(response.body.data.stats).toMatchObject({
      totalAvailable: 2,
      totalRecommendedCredits: 6,
      gpaPath: null,
    });
    const row = response.body.data.courses[0];
    expect(row.placements[0]).toMatchObject({
      academicYear: 1,
      academicSemester: 1,
      electiveGroup: null,
    });
    for (const key of [
      'category',
      'academicYear',
      'academicSemester',
      'electiveGroup',
      'isPrerequisiteFor',
      'prerequisites',
    ])
      expect(row).not.toHaveProperty(key);
  });

  it('does not union different majors prerequisite sets for a shared course', async () => {
    await record(0, 1);
    expect(ids(await read(1))).not.toContain(courses[2]);
    await record(1, 1);
    expect(ids(await read(1))).toEqual([courses[2]]);
    expect(ids(await read(0))).not.toContain(courses[2]);
  });

  it('enforces recommended/corequisite edges and ignores unrelated historical completions', async () => {
    await record(0, 0, 'IN_PROGRESS');
    await record(3);
    expect(ids(await read())).not.toContain(courses[2]);
    expect(ids(await read())).not.toContain(courses[0]);
    await prisma.studentRecord.update({
      where: { userId_courseId: { userId: users[0], courseId: courses[0] } },
      data: { status: 'COMPLETED' },
    });
    expect(ids(await read())).toContain(courses[2]);
  });

  it('matches contextual rating projections without global category or grade-fit bonuses', async () => {
    await record(0);
    const before = await read(0, 0, { maxCredits: 3 });
    await prisma.gradeAttempt.create({
      data: { userId: users[0], courseId: courses[5], score: 100, requestId: randomUUID() },
    });
    const after = await read(0, 0, { maxCredits: 3 });
    expect(ids(before)).toEqual([courses[2]]);
    expect(after.body.data).toEqual(before.body.data);
    const detail = (await request(app).get(`/api/curricula/${contexts[0]}`)).body.data;
    const expected = detail.courses.find((row: { id: string }) => row.id === courses[2]);
    expect(after.body.data.courses[0]).toEqual(expected);
    expect(after.body.data.scope).toEqual({
      curriculumId: contexts[0],
      usage: 'REFERENCE_ONLY',
      categoryPersonalizationAvailable: false,
      ratingPrior: detail.ratingPrior,
    });
  });

  it('uses global member votes while excluding unrelated votes from the context prior', async () => {
    await record(0);
    await prisma.courseRating.createMany({
      data: [
        { userId: users[2], courseId: courses[0], rating: 1 },
        { userId: users[2], courseId: courses[3], rating: 5 },
      ],
    });
    const response = await read();
    expect(response.body.data.scope.ratingPrior).toEqual({ mean: 1, source: 'CURRICULUM_RATINGS' });
    expect(response.body.data.stats.averageDifficulty).toBe(1);
    expect(
      response.body.data.courses.every((row: { ratingCount: number }) => row.ratingCount === 0),
    ).toBe(true);
  });

  it('counts repeated placements once in availability, recommendations and credits', async () => {
    await record(0);
    const member = await prisma.curriculumCourse.findUniqueOrThrow({
      where: { curriculumId_courseId: { curriculumId: contexts[0], courseId: courses[2] } },
    });
    const placement = await prisma.curriculumPlacement.create({
      data: {
        curriculumCourseId: member.id,
        sourceOrder: 99,
        sourceLabel: 'Repeated',
        electiveGroup: 'Group 1',
        electiveSelectCount: 1,
      },
    });
    try {
      const response = await read();
      expect(response.body.data.stats).toMatchObject({
        totalAvailable: 2,
        recommendedCount: 2,
        totalRecommendedCredits: 6,
      });
      expect(
        response.body.data.courses.find((row: { id: string }) => row.id === courses[2]).placements,
      ).toHaveLength(2);
    } finally {
      await prisma.curriculumPlacement.delete({ where: { id: placement.id } });
    }
  });

  it('excludes unplaced members and returns no fallback for an empty assigned context', async () => {
    expect(ids(await read())).not.toContain(courses[4]);
    const empty = await read(4);
    expect(empty.status).toBe(200);
    expect(ids(empty)).toEqual([]);
    expect(empty.body.data.stats).toMatchObject({
      totalAvailable: 0,
      recommendedCount: 0,
      averageDifficulty: 0,
    });
    expect(empty.body.data.scope.ratingPrior).toBeNull();
  });

  it('keeps planned courses available while excluding completed/in-progress courses', async () => {
    await record(0);
    await record(2, 0, 'PLANNED');
    expect(ids(await read())).toContain(courses[2]);
    await prisma.studentRecord.update({
      where: { userId_courseId: { userId: users[0], courseId: courses[2] } },
      data: { status: 'IN_PROGRESS' },
    });
    expect(ids(await read())).toEqual([courses[5]]);
  });

  it('applies offering and credit constraints using context availability', async () => {
    await record(0);
    const response = await read(0, 0, { semester: 'SPRING', maxCredits: 3 });
    expect(ids(response)).toEqual([courses[5]]);
    expect(response.body.data.stats).toMatchObject({
      totalAvailable: 2,
      filteredCount: 1,
      totalRecommendedCredits: 3,
    });
  });

  it('uses the requested owner context for admins and rejects other students or absent sessions', async () => {
    await record(0);
    expect((await read(0, 3)).body.data).toEqual((await read()).body.data);
    expect((await read(0, 1)).status).toBe(403);
    expect((await request(app).get(`/api/recommendations/user/${users[0]}`)).status).toBe(401);
  });

  it('ignores forged owner/context/GPA query values', async () => {
    const response = await read(0, 0, {
      curriculumId: contexts[1],
      userId: users[1],
      gpaPath: 'THESIS',
      gpa100: 100,
    });
    expect(response.body.data).toEqual((await read()).body.data);
    expect(response.body.data.stats.gpaPath).toBeNull();
  });

  it('does not expose record, student or grade history in recommendations', async () => {
    const recordRow = await record(0);
    const attempt = await prisma.gradeAttempt.create({
      data: { userId: users[0], courseId: courses[3], score: 98, requestId: randomUUID() },
    });
    const response = await read();
    const serialized = JSON.stringify(response.body);
    for (const value of [users[0], users[1], recordRow.id, attempt.id, attempt.requestId])
      expect(serialized).not.toContain(value);
    expect(await prisma.gradeAttempt.findUnique({ where: { id: attempt.id } })).toEqual(attempt);
  });

  it('retains the legacy response and catalog for unassigned accounts', async () => {
    const response = await read(2);
    expect(response.status).toBe(200);
    expect(response.body.data).not.toHaveProperty('scope');
    expect(response.body.data.courses[0]).toHaveProperty('category');
    expect(response.body.data.courses[0]).not.toHaveProperty('placements');
  });

  it('returns 404 for a missing requested owner instead of a global recommendation fallback', async () => {
    const response = await request(app)
      .get(`/api/recommendations/user/${randomUUID()}`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${issueToken(users[3])}`);
    expect(response.status).toBe(404);
  });
});
