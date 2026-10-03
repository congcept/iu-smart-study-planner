import { randomUUID } from 'crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import router from '../routes/recommendations';
import WorkloadBalancer from '../services/workloadBalancer';
import { decorateCourseDifficulties, readCourseRatings } from '../services/courseRatings';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { buildNumericGradeHistory } from '../services/numericGradeFit';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/recommendations', router);
const balancer = new WorkloadBalancer();
describe('rating-based workload and recommendations', () => {
  const prefix = `rating-workload-${randomUUID()}`;
  const userId = randomUUID();
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const cookie = `${AUTH_COOKIE_NAME}=${issueToken(userId)}`;
  const recommendations = (query = '') =>
    request(app).get(`/api/recommendations/user/${userId}${query}`).set('Cookie', cookie);
  const analyzed = (courseIds = ids.slice(0, 2)) =>
    request(app).post('/api/recommendations/analyze-workload').send({ courseIds });
  const projected = () =>
    prisma.$transaction(
      async (tx) =>
        decorateCourseDifficulties(
          tx,
          await tx.course.findMany({
            where: { id: { in: ids } },
            include: { prerequisites: true, isPrerequisiteFor: true },
            orderBy: { code: 'asc' },
          }),
        ),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        studentId: prefix,
        email: `${prefix}@example.test`,
        name: 'Workload test',
      },
    });
    await prisma.course.createMany({
      data: ids.map((id, i) => ({
        id,
        code: `${prefix}-${i}`,
        name: 'Workload course',
        credits: 3,
        category: 'CORE',
        difficultyLevel: i === 0 ? 1 : 5,
        semesterOffered: ['FALL'],
      })),
    });
    await prisma.courseRating.createMany({
      data: [
        { userId, courseId: ids[0], rating: 5 },
        { userId, courseId: ids[1], rating: 1 },
      ],
    });
  });
  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.course.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });
  it('analyzes the server estimates instead of the retained seed values', async () => {
    const response = await analyzed();
    expect(response.status).toBe(200);
    const [a, b] = await Promise.all(ids.slice(0, 2).map(readCourseRatings));
    const average = (a.difficulty + b.difficulty) / 2;
    expect(response.body.data.averageDifficulty).toBe(Math.round(average * 100) / 100);
    expect(response.body.data.workloadScore).toBe(
      Math.round((6 * 0.4 + average * 6 * 0.6) * 100) / 100,
    );
    expect((await prisma.course.findUniqueOrThrow({ where: { id: ids[0] } })).difficultyLevel).toBe(
      1,
    );
  });
  it('uses the shared prior for an unrated course in workload analysis', async () => {
    const summary = await readCourseRatings(ids[2]);
    const response = await analyzed([ids[2]]);
    expect(response.body.data.averageDifficulty).toBe(Math.round(summary.priorMean * 100) / 100);
  });
  it('returns rating counts and uses projected values in recommendation statistics', async () => {
    const response = await recommendations('?maxCredits=30&maxDifficulty=5');
    expect(response.status).toBe(200);
    const courses = response.body.data.courses as {
      ratingDifficulty: number;
      ratingCount: number;
    }[];
    expect(courses.length).toBeGreaterThan(0);
    expect(
      courses.every(
        (course) =>
          Number.isFinite(course.ratingDifficulty) && Number.isInteger(course.ratingCount),
      ),
    ).toBe(true);
    expect(response.body.data.stats.averageDifficulty).toBeCloseTo(
      courses.reduce((sum, course) => sum + course.ratingDifficulty, 0) / courses.length,
      12,
    );
  });
  it.each([
    '?maxDifficulty=NaN',
    '?maxDifficulty=6',
    '?maxCredits=-1',
    '?maxCredits=2.5',
    '?semester=UNKNOWN',
  ])('rejects invalid constraints %s', async (query) => {
    expect((await recommendations(query)).status).toBe(400);
  });
  it('ranks a low projected difficulty above a high one despite inverted seeds', async () => {
    const courses = await projected();
    const hard = { ...courses[0], difficultyLevel: 1, ratingDifficulty: 4.8 };
    const easy = { ...courses[1], difficultyLevel: 5, ratingDifficulty: 1.2 };
    expect(
      balancer
        .calculateRecommendations({
          availableCourses: [hard, easy],
          maxCredits: 3,
          maxDifficulty: 5,
          numericHistory: [],
        })
        .map((course) => course.id),
    ).toEqual([easy.id]);
  });
  it('enforces the projected difficulty constraint after three courses', async () => {
    const courses = (await projected()).map((course, index) => ({
      ...course,
      difficultyLevel: 1,
      ratingDifficulty: index === 3 ? 5 : 2,
    }));
    expect(
      balancer.calculateRecommendations({
        availableCourses: courses,
        maxCredits: 18,
        maxDifficulty: 2.1,
        numericHistory: [],
      }),
    ).toHaveLength(3);
  });
  it('uses estimates in validation warnings instead of seeds', async () => {
    const courses = (await projected()).map((course) => ({
      ...course,
      difficultyLevel: 1,
      ratingDifficulty: 4.8,
    }));
    expect(balancer.validateSemesterPlan(courses, new Set()).warnings).toContain(
      'Very high average difficulty. Consider balancing workload',
    );
  });
  it('matches numeric evidence by category and nearby estimates without converting legacy grades', async () => {
    const courses = await projected();
    const record = await prisma.studentRecord.create({
      data: { userId, courseId: ids[3], status: 'COMPLETED', gradePoints: 2 },
    });
    const similar = { ...courses[0], ratingDifficulty: 2.2 };
    const different = { ...courses[1], ratingDifficulty: 3.2 };
    const historyCourse = { ...courses[3], ratingDifficulty: 2 };
    const input = { availableCourses: [different, similar], maxCredits: 3, maxDifficulty: 5 };
    expect(
      balancer.calculateRecommendations({
        ...input,
        numericHistory: buildNumericGradeHistory(
          [historyCourse],
          [{ courseId: record.courseId, score: 90 }],
        ),
      })[0].id,
    ).toBe(similar.id);
    expect(
      balancer.calculateRecommendations({
        ...input,
        numericHistory: buildNumericGradeHistory([historyCourse], []),
      })[0].id,
    ).toBe(different.id);
    expect(
      (await prisma.studentRecord.findUniqueOrThrow({ where: { id: record.id } })).gradePoints,
    ).toBe(2);
  });
  it('keeps empty workload defined without inventing course evidence', async () => {
    expect(balancer.analyzeSemesterWorkload([])).toMatchObject({
      totalCredits: 0,
      averageDifficulty: 0,
      workloadScore: 0,
      riskLevel: 'LOW',
    });
  });
});
