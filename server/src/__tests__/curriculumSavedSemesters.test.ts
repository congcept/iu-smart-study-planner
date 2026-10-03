import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { createPlannedSemester, updatePlannedSemester } from '../services/plannedSemesters';

describe('curriculum-consistent saved semesters (PostgreSQL)', () => {
  const prefix = `saved-context-${randomUUID()}`;
  const courses: string[] = Array.from({ length: 4 }, () => randomUUID());
  const contexts: string[] = Array.from({ length: 3 }, () => randomUUID());
  const users: string[] = Array.from({ length: 5 }, () => randomUUID());
  let planId: string;
  let semesterId: string;
  let foreignSemesterId: string;
  const entries = (indices = [1, 0]) =>
    indices.map((index, position) => ({ courseId: courses[index], position }));
  const cookie = (user = 0) => `${AUTH_COOKIE_NAME}=${issueToken(users[user])}`;
  const create = (courses = entries(), user = 0) =>
    request(app)
      .post(`/api/study-plans/${planId}/semesters`)
      .set('Cookie', cookie(user))
      .send({ semester: 'SPRING', year: 2027, courses });
  const update = (body: Record<string, unknown>, user = 0) =>
    request(app)
      .put(`/api/study-plans/${planId}/semesters/${semesterId}`)
      .set('Cookie', cookie(user))
      .send(body);
  beforeAll(async () => {
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Simulated course',
        credits: index === 1 ? 4 : 3,
        difficultyLevel: [1, 5, 2, 3][index],
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
      })),
    });
    for (const [context, indices] of [
      [0, [0, 1, 3]],
      [1, [0, 2]],
    ] as const)
      for (const index of indices)
        await prisma.curriculumCourse.create({
          data: {
            curriculumId: contexts[context],
            courseId: courses[index],
            placements:
              index === 3
                ? undefined
                : {
                    create: {
                      sourceOrder: index,
                      sourceLabel: 'Simulated placement',
                      academicYear: 1,
                      academicSemester: 1,
                    },
                  },
          },
        });
    await prisma.user.createMany({
      data: users.map((id, index) => ({
        id,
        studentId: `${prefix}-${index}`,
        email: `${id}@example.test`,
        name: 'Simulated student',
        curriculumId: index === 3 ? null : contexts[index === 4 ? 2 : index === 2 ? 1 : index],
        role: index === 2 ? 'ADMIN' : 'STUDENT',
      })),
    });
  });
  beforeEach(async () => {
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[0] } });
    await prisma.courseRating.deleteMany({ where: { userId: { in: users } } });
    await prisma.studyPlan.deleteMany({ where: { userId: { in: users } } });
    const plan = await prisma.studyPlan.create({
      data: {
        userId: users[0],
        name: 'Simulated plan',
        semesters: {
          create: {
            semester: 'FALL',
            year: 2026,
            courses: entries([0]),
            totalCredits: 3,
            difficultyScore: 5,
          },
        },
      },
      include: { semesters: true },
    });
    planId = plan.id;
    semesterId = plan.semesters[0].id;
    const foreign = await prisma.studyPlan.create({
      data: {
        userId: users[1],
        name: 'Other plan',
        semesters: {
          create: {
            semester: 'FALL',
            year: 2026,
            courses: [],
            totalCredits: 0,
            difficultyScore: 0,
          },
        },
      },
      include: { semesters: true },
    });
    foreignSemesterId = foreign.semesters[0].id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.curriculum.deleteMany({ where: { id: { in: contexts } } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
    await prisma.$disconnect();
  });

  it('creates contextual authoritative totals matching signed-in workload analysis and preserves order', async () => {
    const response = await create();
    const workload = await request(app)
      .post('/api/recommendations/analyze-workload')
      .set('Cookie', cookie())
      .send({ courseIds: [courses[1], courses[0]] });
    expect(response.status).toBe(201);
    expect(workload.status).toBe(200);
    expect(response.body.data).toMatchObject({
      courses: entries(),
      totalCredits: 7,
      difficultyScore: 3,
    });
    expect(response.body.data.difficultyScore).toBe(workload.body.data.averageDifficulty);
    expect(
      (await prisma.plannedSemester.findUniqueOrThrow({ where: { id: response.body.data.id } }))
        .courses,
    ).toEqual(entries());
  });

  it('recalculates course-list updates from global vote evidence and the context prior', async () => {
    await prisma.courseRating.createMany({
      data: [
        { userId: users[3], courseId: courses[0], rating: 5 },
        { userId: users[3], courseId: courses[1], rating: 1 },
        { userId: users[3], courseId: courses[2], rating: 5 },
      ],
    });
    const response = await update({ courses: entries() });
    const workload = await request(app)
      .post('/api/recommendations/analyze-workload')
      .set('Cookie', cookie())
      .send({ courseIds: [courses[0], courses[1]] });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      totalCredits: 7,
      difficultyScore: 3,
      year: 2026,
      semester: 'FALL',
    });
    expect(response.body.data.difficultyScore).toBe(workload.body.data.averageDifficulty);
  });

  it.each([
    [2, 409],
    [3, 409],
    [-1, 400],
  ])(
    'rejects invalid course index %s without creating a partial semester',
    async (index, status) => {
      const coursesToSave = [
        ...entries([0]),
        { courseId: index < 0 ? randomUUID() : courses[index], position: 1 },
      ];
      const response = await create(coursesToSave);
      expect(response.status).toBe(status);
      expect(await prisma.plannedSemester.count({ where: { studyPlanId: planId } })).toBe(1);
    },
  );

  it('rejects an invalid course-list update without changing metadata or cached totals', async () => {
    const before = await prisma.plannedSemester.findUniqueOrThrow({ where: { id: semesterId } });
    expect((await update({ year: 2030, courses: entries([0, 2]) })).status).toBe(409);
    expect(await prisma.plannedSemester.findUniqueOrThrow({ where: { id: semesterId } })).toEqual(
      before,
    );
  });

  it('uses the plan owner context when an admin has a different curriculum', async () => {
    const response = await create(entries([1]), 2);
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ totalCredits: 4, difficultyScore: 3 });
  });

  it('keeps cached historical totals on metadata-only edits after context or rating changes', async () => {
    const first = await update({ courses: entries([1]) });
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[1] } });
    await prisma.courseRating.create({
      data: { userId: users[3], courseId: courses[1], rating: 1 },
    });
    const metadata = await update({ year: 2029 });
    expect(metadata.status).toBe(200);
    expect(metadata.body.data).toMatchObject({
      courses: entries([1]),
      totalCredits: 4,
      difficultyScore: first.body.data.difficultyScore,
      year: 2029,
    });
    expect((await update({ courses: entries([1]) })).status).toBe(409);
  });

  it('accepts an explicit empty list with zero totals even in an empty assigned context', async () => {
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: contexts[2] } });
    const response = await update({ courses: [] });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ courses: [], totalCredits: 0, difficultyScore: 0 });
    expect((await create(entries([0]))).status).toBe(409);
  });

  it('retains strict duplicate validation after uppercase UUID normalization', async () => {
    const response = await create([
      { courseId: courses[0], position: 0 },
      { courseId: courses[0].toUpperCase(), position: 1 },
    ]);
    expect(response.status).toBe(400);
    expect(await prisma.plannedSemester.count({ where: { studyPlanId: planId } })).toBe(1);
  });

  it('returns one creation and explicit conflicts for concurrent same-slot writes', async () => {
    const responses = await Promise.all(Array.from({ length: 3 }, () => create(entries([0]))));
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409, 409]);
    expect(
      await prisma.plannedSemester.count({
        where: { studyPlanId: planId, semester: 'SPRING', year: 2027 },
      }),
    ).toBe(1);
  });

  it('preserves full consistent snapshots during concurrent course-list updates', async () => {
    const responses = await Promise.all([
      update({ courses: entries([0]) }),
      update({ courses: entries([1]) }),
    ]);
    expect(responses.every(({ status }) => status === 200)).toBe(true);
    const snapshots = responses.map(({ body }) => body.data);
    expect(snapshots[0]).toMatchObject({
      courses: entries([0]),
      totalCredits: 3,
      difficultyScore: 3,
    });
    expect(snapshots[1]).toMatchObject({
      courses: entries([1]),
      totalCredits: 4,
      difficultyScore: 3,
    });
    const saved = await prisma.plannedSemester.findUniqueOrThrow({ where: { id: semesterId } });
    expect(
      snapshots.some(
        ({ courses, totalCredits, difficultyScore }) =>
          JSON.stringify(courses) === JSON.stringify(saved.courses) &&
          totalCredits === saved.totalCredits &&
          difficultyScore === saved.difficultyScore,
      ),
    ).toBe(true);
  });

  it('rechecks owner and nested-semester access inside the service transaction', async () => {
    const data = { semester: 'SPRING' as const, year: 2027, courses: entries([0]) };
    await expect(createPlannedSemester(planId, users[1], data)).rejects.toMatchObject({
      status: 403,
    });
    await expect(createPlannedSemester(randomUUID(), users[2], data)).rejects.toMatchObject({
      status: 404,
    });
    await expect(createPlannedSemester(planId, randomUUID(), data)).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      updatePlannedSemester(planId, foreignSemesterId, users[0], { year: 2028 }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await create(entries([0]), 1)).status).toBe(403);
  });

  it('keeps unassigned plans on the global prior', async () => {
    await prisma.user.update({ where: { id: users[0] }, data: { curriculumId: null } });
    const saved = await create(entries([2]));
    const workload = await request(app)
      .post('/api/recommendations/analyze-workload')
      .send({ courseIds: [courses[2]] });
    expect(saved.status).toBe(201);
    expect(Math.round(saved.body.data.difficultyScore * 100) / 100).toBe(
      workload.body.data.averageDifficulty,
    );
  });
});
