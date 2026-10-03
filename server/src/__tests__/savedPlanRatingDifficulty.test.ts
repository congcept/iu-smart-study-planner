import { randomUUID } from 'crypto';
import request from 'supertest';
import app, { prisma } from '../index';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { readCourseRatings } from '../services/courseRatings';

// Scores are cached at a course-list save, not silently rewritten on metadata-only edits.
describe('saved-plan rating difficulty (PostgreSQL)', () => {
  const prefix = `plan-rating-${randomUUID()}`;
  const userId = randomUUID();
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  let planId: string;
  let semesterId: string;
  const cookie = () => `${AUTH_COOKIE_NAME}=${issueToken(userId)}`;
  const entries = [
    { courseId: ids[1], position: 7 },
    { courseId: ids[0], position: 2 },
    { courseId: ids[2], position: 0 },
  ];
  const create = (courses = entries) =>
    request(app)
      .post(`/api/study-plans/${planId}/semesters`)
      .set('Cookie', cookie())
      .send({ semester: 'SPRING', year: 2027, courses });
  const update = (body: Record<string, unknown>) =>
    request(app)
      .put(`/api/study-plans/${planId}/semesters/${semesterId}`)
      .set('Cookie', cookie())
      .send(body);

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, studentId: prefix, email: `${prefix}@example.test`, name: 'Plan test' },
    });
    await prisma.course.createMany({
      data: ids.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Plan rating course',
        credits: index + 2,
        difficultyLevel: index === 0 ? 5 : 1,
      })),
    });
  });
  beforeEach(async () => {
    await prisma.courseRating.deleteMany({ where: { userId } });
    await prisma.courseRating.createMany({
      data: [
        { userId, courseId: ids[0], rating: 1 },
        { userId, courseId: ids[1], rating: 5 },
      ],
    });
    await prisma.studyPlan.deleteMany({ where: { userId } });
    const plan = await prisma.studyPlan.create({
      data: {
        userId,
        name: 'Saved rating plan',
        semesters: {
          create: {
            semester: 'FALL',
            year: 2026,
            courses: [{ courseId: ids[0], position: 0 }],
            totalCredits: 2,
            difficultyScore: 5,
          },
        },
      },
      include: { semesters: true },
    });
    planId = plan.id;
    semesterId = plan.semesters[0].id;
  });
  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.course.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it('creates authoritative totals from rated and unrated estimates, preserving order', async () => {
    const prior = (await readCourseRatings(ids[0])).priorMean;
    const expected = ((1 + 5 * prior) / 6 + (5 + 5 * prior) / 6 + prior) / 3;
    const response = await create();
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ courses: entries, totalCredits: 9 });
    expect(response.body.data.difficultyScore).toBeCloseTo(expected, 12);
    const saved = await prisma.plannedSemester.findUnique({ where: { id: response.body.data.id } });
    expect(saved?.difficultyScore).toBeCloseTo(expected, 12);
    expect(saved?.courses).toEqual(entries);
  });
  it('updates course lists using the same estimates as the workload API', async () => {
    const response = await update({ courses: entries });
    const workload = await request(app)
      .post('/api/recommendations/analyze-workload')
      .send({ courseIds: ids });
    expect(response.status).toBe(200);
    expect(workload.status).toBe(200);
    expect(Math.round(response.body.data.difficultyScore * 100) / 100).toBe(
      workload.body.data.averageDifficulty,
    );
    expect(response.body.data).toMatchObject({ year: 2026, semester: 'FALL', totalCredits: 9 });
  });
  it('uses the shared prior for a zero-vote course instead of its individual seed', async () => {
    const summary = await readCourseRatings(ids[2]);
    const response = await create([{ courseId: ids[2], position: 0 }]);
    expect(response.status).toBe(201);
    expect(response.body.data.difficultyScore).toBeCloseTo(summary.priorMean, 12);
    expect(response.body.data.difficultyScore).not.toBe(1);
  });
  it('recalculates an unchanged course list after a vote changes', async () => {
    const first = await update({ courses: [{ courseId: ids[0], position: 0 }] });
    await prisma.courseRating.update({
      where: { userId_courseId: { userId, courseId: ids[0] } },
      data: { rating: 5 },
    });
    const summary = await readCourseRatings(ids[0]);
    const second = await update({ courses: [{ courseId: ids[0], position: 0 }] });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.difficultyScore).toBeCloseTo(summary.difficulty, 12);
    expect(second.body.data.difficultyScore).toBeGreaterThan(first.body.data.difficultyScore);
  });
  it('preserves cached difficulty on a metadata-only edit after ratings change', async () => {
    const first = await update({ courses: entries });
    await prisma.courseRating.updateMany({ where: { userId }, data: { rating: 5 } });
    const response = await update({ year: 2028 });
    expect(response.status).toBe(200);
    expect(response.body.data.difficultyScore).toBe(first.body.data.difficultyScore);
    expect(response.body.data.courses).toEqual(entries);
    expect(response.body.data.totalCredits).toBe(9);
  });
  it('returns the cached saved estimate on authorized plan reads', async () => {
    const saved = await update({ courses: entries });
    const response = await request(app).get(`/api/study-plans/${planId}`).set('Cookie', cookie());
    expect(response.status).toBe(200);
    expect(response.body.data.semesters[0].difficultyScore).toBe(saved.body.data.difficultyScore);
  });
  it('rejects unknown courses without partially updating totals or metadata', async () => {
    const before = await prisma.plannedSemester.findUnique({ where: { id: semesterId } });
    const response = await update({
      year: 2029,
      courses: [...entries, { courseId: randomUUID(), position: 8 }],
    });
    expect(response.status).toBe(400);
    expect(await prisma.plannedSemester.findUnique({ where: { id: semesterId } })).toEqual(before);
  });
});
