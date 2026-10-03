import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';

describe('contextual progress summary reads (PostgreSQL)', () => {
  const prefix = `progress-view-${randomUUID()}`;
  const courses: string[] = Array.from({ length: 7 }, () => randomUUID());
  const contexts: string[] = Array.from({ length: 3 }, () => randomUUID());
  const users: string[] = Array.from({ length: 5 }, () => randomUUID());
  const createdSources: string[] = [];
  let physical: string;
  let thesis: string;
  const cookie = (user = 0) => `${AUTH_COOKIE_NAME}=${issueToken(users[user])}`;
  const read = (owner = 0, session = owner, alias = false) =>
    request(app)
      .get(`/api/users/${alias ? `${prefix}-${owner}` : users[owner]}/progress`)
      .set('Cookie', cookie(session));
  const complete = (courseId = courses[0], user = 0) =>
    prisma.studentRecord.create({
      data: {
        userId: users[user],
        courseId,
        status: 'COMPLETED',
        grade: 'A',
        gradePoints: 4,
        electiveGroup: null,
      },
    });
  const grade = (courseId = courses[0], score = 80, user = 0) =>
    prisma.gradeAttempt.create({
      data: { userId: users[user], courseId, score, requestId: randomUUID() },
    });
  const courseIds = (rows: { id: string }[]): string[] => rows.map(({ id }) => id);
  beforeAll(async () => {
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated course',
        credits: 3,
        difficultyLevel: index % 2 ? 5 : 1,
        category: 'CORE',
        academicYear: 4,
        academicSemester: 2,
        electiveGroup: 'Wrong global group',
      })),
    });
    for (const code of ['PT001IU', 'IT058IU']) {
      let source = await prisma.course.findUnique({ where: { code } });
      if (!source) {
        source = await prisma.course.create({
          data: { code, name: code, credits: code === 'IT058IU' ? 10 : 2, difficultyLevel: 2 },
        });
        createdSources.push(source.id);
      }
      if (code === 'PT001IU') physical = source.id;
      else thesis = source.id;
    }
    await prisma.curriculum.createMany({
      data: contexts.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated context',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
        isGpaPath: index === 0,
      })),
    });
    const memberships = [
      [0, [courses[0], courses[2], courses[3], courses[5], courses[6], physical, thesis]],
      [1, [courses[1], courses[2]]],
    ] as const;
    for (const [context, ids] of memberships)
      for (const [index, courseId] of ids.entries()) {
        await prisma.curriculumCourse.create({
          data: {
            curriculumId: contexts[context],
            courseId,
            placements:
              courseId === courses[3]
                ? undefined
                : {
                    create: {
                      academicYear: courseId === thesis || courseId === courses[5] ? 4 : 1,
                      academicSemester: courseId === thesis || courseId === courses[5] ? 2 : 1,
                      sourceOrder: index,
                      sourceLabel: 'Simulated reference',
                    },
                  },
          },
        });
      }
    const repeated = await prisma.curriculumCourse.findUniqueOrThrow({
      where: { curriculumId_courseId: { curriculumId: contexts[0], courseId: courses[6] } },
    });
    await prisma.curriculumPlacement.create({
      data: {
        curriculumCourseId: repeated.id,
        academicYear: 4,
        academicSemester: 2,
        sourceOrder: 20,
        sourceLabel: 'Repeated occurrence',
        electiveGroup: 'Group 2',
        electiveSelectCount: 1,
      },
    });
    await prisma.curriculumRequirement.create({
      data: {
        curriculumId: contexts[0],
        name: 'Free elective',
        credits: 3,
        sourceOrder: 99,
        academicYear: 4,
        academicSemester: 2,
      },
    });
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
      data: { courseId: courses[2], prerequisiteId: courses[4] },
    });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        name: 'Simulated student',
        email: `${id}@example.test`,
        password: 'legacy-private',
        passwordHash: 'private-hash',
        curriculumId: index < 2 ? contexts[index] : index === 4 ? contexts[2] : null,
        role: index === 3 ? 'ADMIN' : 'STUDENT',
      })),
    });
  });
  beforeEach(async () => {
    await prisma.studentRecord.deleteMany({ where: { userId: { in: users } } });
    await prisma.gradeAttempt.deleteMany({ where: { userId: { in: users } } });
    await prisma.courseRating.deleteMany({ where: { userId: { in: users } } });
    await prisma.curriculum.update({ where: { id: contexts[0] }, data: { totalCredits: null } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: [...courses, ...createdSources] } } });
    await prisma.$disconnect();
  });

  it('scopes records/credits to members and retains nonmember history without global placement fields', async () => {
    const current = await complete();
    const history = await complete(courses[4]);
    await prisma.studentRecord.update({
      where: { id: history.id },
      data: { electiveGroup: 'Archived elective claim' },
    });
    const before = await prisma.studentRecord.findMany({
      where: { userId: users[0] },
      orderBy: { id: 'asc' },
    });
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.body.data.completed).toHaveLength(1);
    expect(response.body.data.completed[0]).toMatchObject({
      id: current.id,
      grade: 'A',
      gradePoints: 4,
    });
    expect(response.body.data.completed[0].course.placements[0]).toMatchObject({
      academicYear: 1,
      academicSemester: 1,
      electiveGroup: null,
    });
    expect(response.body.data.historicalRecords).toEqual([
      expect.objectContaining({
        id: history.id,
        courseId: courses[4],
        grade: 'A',
        electiveGroup: 'Archived elective claim',
        course: { id: courses[4], code: `${prefix}-4`, name: 'Simulated course', credits: 3 },
      }),
    ]);
    expect(response.body.data.progress).toMatchObject({
      completedCourses: 1,
      completedCredits: 3,
      totalCourses: 7,
      totalCredits: null,
      percentage: null,
    });
    expect(response.body.data.scope).toMatchObject({
      curriculumId: contexts[0],
      usage: 'REFERENCE_ONLY',
      degreeProgressAvailable: false,
    });
    expect(
      await prisma.studentRecord.findMany({ where: { userId: users[0] }, orderBy: { id: 'asc' } }),
    ).toEqual(before);
  });

  it('uses context-only mandatory prerequisites and matches recommendation availability', async () => {
    await complete();
    await grade();
    const response = await read();
    const recommendations = await request(app)
      .get(`/api/recommendations/user/${users[0]}`)
      .set('Cookie', cookie())
      .query({ maxCredits: 30, maxDifficulty: 5 });
    expect(courseIds(response.body.data.available)).toContain(courses[2]);
    expect(courseIds(response.body.data.available)).not.toContain(courses[3]);
    expect(courseIds(response.body.data.available)).not.toContain(courses[4]);
    expect(response.body.data.available.length).toBe(
      recommendations.body.data.stats.totalAvailable,
    );
    expect(response.body.data.scope.gpaPath).toBe(recommendations.body.data.stats.gpaPath);
    expect(response.body.data.scope.ratingPrior).toEqual(
      recommendations.body.data.scope.ratingPrior,
    );
    for (const row of response.body.data.available) expect(row).not.toHaveProperty('category');
  });

  it('does not union prerequisite rules between contexts for a shared course', async () => {
    await complete(courses[0], 1);
    expect(courseIds((await read(1)).body.data.available)).not.toContain(courses[2]);
    await complete(courses[1], 1);
    expect(courseIds((await read(1)).body.data.available)).toEqual([courses[2]]);
    expect(courseIds((await read()).body.data.available)).not.toContain(courses[2]);
  });

  it('categorizes planned/in-progress members while keeping archived statuses separate', async () => {
    await prisma.studentRecord.createMany({
      data: [
        { userId: users[0], courseId: courses[0], status: 'IN_PROGRESS' },
        { userId: users[0], courseId: courses[2], status: 'PLANNED' },
        { userId: users[0], courseId: courses[4], status: 'PLANNED' },
      ],
    });
    const response = await read();
    expect(response.body.data.inProgress.map((row: { courseId: string }) => row.courseId)).toEqual([
      courses[0],
    ]);
    expect(response.body.data.planned.map((row: { courseId: string }) => row.courseId)).toEqual([
      courses[2],
    ]);
    expect(response.body.data.historicalRecords[0].status).toBe('PLANNED');
    expect(courseIds(response.body.data.available)).not.toContain(courses[2]);
    await prisma.studentRecord.update({
      where: { userId_courseId: { userId: users[0], courseId: courses[0] } },
      data: { status: 'COMPLETED' },
    });
    const eligible = await read();
    expect(courseIds(eligible.body.data.available)).toContain(courses[2]);
    expect(eligible.body.data.planned[0].courseId).toBe(courses[2]);
  });

  it('excludes physical training from earned credits while retaining required completion records', async () => {
    await complete();
    await complete(physical);
    const response = await read();
    expect(response.body.data.progress).toMatchObject({ completedCourses: 2, completedCredits: 3 });
    expect(
      response.body.data.completed.some((row: { courseId: string }) => row.courseId === physical),
    ).toBe(true);
  });

  it('does not derive a degree percentage from repeated elective options or a provisional credit total', async () => {
    await complete();
    await prisma.curriculum.update({ where: { id: contexts[0] }, data: { totalCredits: 130 } });
    const response = await read();
    expect(response.body.data.progress).toMatchObject({
      totalCourses: 7,
      completedCredits: 3,
      totalCredits: 130,
      percentage: null,
    });
    expect(response.body.data.scope.degreeProgressAvailable).toBe(false);
  });

  it('uses highest member retakes for the GPA fork and preserves earlier elective appearances', async () => {
    await grade(courses[0], 50);
    await grade(courses[0], 90);
    await grade(courses[4], 0);
    const response = await read();
    expect(response.body.data.scope.gpaPath).toBe('THESIS');
    const available = courseIds(response.body.data.available);
    expect(available).toContain(thesis);
    expect(available).not.toContain(courses[5]);
    expect(available).toContain(courses[6]);
    expect(
      response.body.data.available.find((row: { id: string }) => row.id === courses[6]).placements,
    ).toHaveLength(1);
    expect(new Set(available).size).toBe(available.length);
  });

  it('uses the exact alternative boundary and preserves null/nonfork choices', async () => {
    await grade(courses[0], 70);
    let response = await read();
    expect(response.body.data.scope.gpaPath).toBe('ALTERNATIVE');
    expect(courseIds(response.body.data.available)).not.toContain(thesis);
    expect(courseIds(response.body.data.available)).toContain(courses[5]);
    await prisma.gradeAttempt.deleteMany({ where: { userId: users[0] } });
    response = await read();
    expect(response.body.data.scope.gpaPath).toBeNull();
    expect(courseIds(response.body.data.available)).toEqual(
      expect.arrayContaining([thesis, courses[5]]),
    );
    await grade(courses[1], 99, 1);
    expect((await read(1)).body.data.scope.gpaPath).toBeNull();
  });

  it('shares global vote evidence and a context prior without leaking private grades or passwords', async () => {
    await complete();
    const attempt = await grade();
    await prisma.courseRating.createMany({
      data: [
        { userId: users[2], courseId: courses[0], rating: 1 },
        { userId: users[2], courseId: courses[4], rating: 5 },
      ],
    });
    const response = await read();
    expect(response.body.data.scope.ratingPrior).toEqual({ mean: 1, source: 'CURRICULUM_RATINGS' });
    const detail = (await request(app).get(`/api/curricula/${contexts[0]}`)).body.data;
    expect(response.body.data.completed[0].course).toEqual(
      detail.courses.find((row: { id: string }) => row.id === courses[0]),
    );
    const serialized = JSON.stringify(response.body);
    for (const secret of [
      'legacy-private',
      'private-hash',
      attempt.id,
      attempt.requestId,
      users[1],
    ])
      expect(serialized).not.toContain(secret);
    expect(await prisma.gradeAttempt.findUnique({ where: { id: attempt.id } })).toEqual(attempt);
  });

  it('preserves owner aliases/admin access and rejects other students or absent sessions', async () => {
    expect((await read(0, 0, true)).body.data).toEqual((await read()).body.data);
    expect((await read(0, 3)).body.data).toEqual((await read()).body.data);
    expect((await read(0, 1)).status).toBe(403);
    expect((await request(app).get(`/api/users/${users[0]}/progress`)).status).toBe(401);
    expect(
      (await request(app).get(`/api/users/${randomUUID()}/progress`).set('Cookie', cookie(3)))
        .status,
    ).toBe(404);
  });

  it('returns an empty context with unknown degree progress and no global fallback', async () => {
    await complete(courses[4], 4);
    const response = await read(4);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      completed: [],
      planned: [],
      inProgress: [],
      available: [],
      progress: {
        totalCourses: 0,
        completedCourses: 0,
        completedCredits: 0,
        totalCredits: null,
        percentage: null,
      },
      scope: { curriculumId: contexts[2], ratingPrior: null },
    });
    expect(response.body.data.historicalRecords).toHaveLength(1);
  });

  it('retains the global legacy response for unassigned accounts', async () => {
    await complete(courses[4], 2);
    const response = await read(2);
    expect(response.status).toBe(200);
    expect(response.body.data).not.toHaveProperty('scope');
    expect(response.body.data).not.toHaveProperty('historicalRecords');
    expect(response.body.data.completed[0].course).toHaveProperty('category');
    expect(response.body.data.progress.completedCredits).toBe(3);
    expect(typeof response.body.data.progress.percentage).toBe('number');
  });
});
