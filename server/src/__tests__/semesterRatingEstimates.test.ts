import { randomUUID } from 'crypto';
import express from 'express';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import router from '../routes/recommendations';
import SemesterPlanner from '../services/semesterPlanner';
import { decorateCourseDifficulties, readCourseRatings } from '../services/courseRatings';
import config from '../config';

const app = express();
app.use(express.json());
app.use('/api/recommendations', router);
const planner = new SemesterPlanner();
describe('semester rating estimates (PostgreSQL)', () => {
  const prefix = `semester-ratings-${randomUUID()}`;
  const userId = randomUUID();
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const projected = () =>
    prisma.$transaction(
      async (tx) =>
        decorateCourseDifficulties(
          tx,
          await tx.course.findMany({
            where: { id: { in: ids } },
            include: {
              prerequisites: true,
              isPrerequisiteFor: { include: { course: { select: { id: true } } } },
            },
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
        name: 'Semester rating test',
      },
    });
    await prisma.course.createMany({
      data: ids.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Semester rated course',
        credits: 9,
        category: 'CORE',
        difficultyLevel: index === 0 ? 1 : 5,
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
  it('prefers lower projected difficulty when placement/category/unlocks are equal', async () => {
    const courses = await projected();
    expect(courses[0].ratingDifficulty).toBeGreaterThan(courses[1].ratingDifficulty);
    expect(courses[0].difficultyLevel).toBeLessThan(courses[1].difficultyLevel);
    expect(planner.plan(courses.slice(0, 2), new Set(), 'low').nextRecommendedIds).toEqual([
      ids[1],
    ]);
  });
  it('uses a shared estimate for an unrated course instead of its seed', async () => {
    const course = (await projected())[2];
    expect(course.ratingCount).toBe(0);
    expect(course.ratingDifficulty).toBe(course.ratingPriorMean);
    expect(planner.plan([course], new Set(), 'low').nextRecommendedIds).toEqual([ids[2]]);
  });
  it('retains prerequisite priority when an easier dependent is blocked', async () => {
    const courses = await projected();
    const dependent = {
      ...courses[1],
      prerequisites: [
        {
          id: randomUUID(),
          courseId: ids[1],
          prerequisiteId: ids[0],
          isStrict: false,
          isCorequisite: true,
          createdAt: new Date(),
        },
      ],
    };
    const plan = planner.plan([courses[0], dependent], new Set(), 'low');
    expect(plan.nextRecommendedIds).toEqual([ids[0]]);
    expect(plan.semesters[1].recommendedCourseIds).toEqual([ids[1]]);
  });
  it('can disable the difficulty penalty through policy configuration', async () => {
    const previous = config.semesterDifficultyPenaltyWeight;
    try {
      config.semesterDifficultyPenaltyWeight = 0;
      expect(
        planner.plan((await projected()).slice(0, 2), new Set(), 'low').nextRecommendedIds,
      ).toEqual([ids[0]]);
    } finally {
      config.semesterDifficultyPenaltyWeight = previous;
    }
  });
  it('returns consistent rating metadata and actual slot IDs from the planning API', async () => {
    const other = await prisma.course.findMany({
      where: { id: { notIn: ids } },
      select: { id: true },
    });
    const response = await request(app)
      .post('/api/recommendations/plan-semester')
      .send({ intensityMode: 'low', completedCourseIds: other.map((course) => course.id) });
    expect(response.status).toBe(200);
    expect(response.body.data.nextRecommendedIds).toEqual([ids[1]]);
    const summary = await readCourseRatings(ids[1]);
    expect(response.body.data.nextRecommendedCourses[0]).toMatchObject({
      id: ids[1],
      ratingCount: 1,
      ratingDifficulty: summary.difficulty,
    });
    expect(response.body.data.semesters[0]).toMatchObject({
      recommendedCourseIds: [ids[1]],
      totalCredits: 9,
    });
    expect(response.body.data.semesters[0]).not.toHaveProperty('courses');
  });
});
