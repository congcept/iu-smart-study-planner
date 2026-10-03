import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import type { CourseDifficultyDTO } from '@iu-study-planner/shared';
import { prisma } from '../db';
import router from '../routes/courses';
import { decorateCourseDifficulties, readCourseRatings } from '../services/courseRatings';

const app = express();
app.use('/api/courses', router);
type ProjectedCourse = CourseDifficultyDTO & {
  id: string;
  code: string;
  difficultyLevel: number;
  prerequisites: { prerequisiteId: string }[];
};
describe('batched course difficulty projections (PostgreSQL)', () => {
  const prefix = `projection-${randomUUID()}`;
  const userId = randomUUID();
  const courses = [randomUUID(), randomUUID()];
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        studentId: prefix,
        email: `${prefix}@example.test`,
        name: 'Projection test',
      },
    });
    await prisma.course.createMany({
      data: courses.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Projection course',
        credits: 3,
        difficultyLevel: index + 1,
      })),
    });
    await prisma.prerequisite.create({
      data: {
        courseId: courses[1],
        prerequisiteId: courses[0],
        isStrict: false,
        isCorequisite: true,
      },
    });
  });
  beforeEach(async () => {
    await prisma.courseRating.deleteMany({ where: { userId } });
  });
  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.course.deleteMany({ where: { id: { in: courses } } });
    await prisma.$disconnect();
  });
  const vote = () =>
    prisma.courseRating.create({ data: { userId, courseId: courses[0], rating: 5 } });
  it('projects the same raw aggregate, confidence and estimate as the ratings API', async () => {
    await vote();
    const summary = await readCourseRatings(courses[0]);
    const response = await request(app).get(`/api/courses/${courses[0]}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      avgRating: summary.average,
      ratingCount: summary.count,
      ratingDifficulty: summary.difficulty,
      ratingPriorMean: summary.priorMean,
      ratingPriorSource: summary.priorSource,
      difficultyLevel: 1,
    });
  });
  it('includes shared cold-start estimates and keeps prerequisite metadata in collection reads', async () => {
    await vote();
    const response = await request(app).get('/api/courses');
    const data = response.body.data as ProjectedCourse[];
    const first = data.find((course) => course.id === courses[0])!;
    const second = data.find((course) => course.id === courses[1])!;
    expect(first.ratingCount).toBe(1);
    expect(second.ratingCount).toBe(0);
    expect(second.avgRating).toBeNull();
    expect(second.ratingDifficulty).toBe(first.ratingPriorMean);
    expect(second.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prerequisiteId: courses[0],
          isStrict: false,
          isCorequisite: true,
        }),
      ]),
    );
    expect(second.difficultyLevel).toBe(2);
  });
  it('retains the existing missing-course response', async () => {
    expect((await request(app).get(`/api/courses/${randomUUID()}`)).status).toBe(404);
  });
  it('returns the mean exactly for an unvoted course rather than its raw seed', async () => {
    const response = await request(app).get(`/api/courses/${courses[1]}`);
    expect(response.body.data.ratingCount).toBe(0);
    expect(response.body.data.ratingDifficulty).toBe(response.body.data.ratingPriorMean);
  });
  it('does not mutate source metadata while decorating a collection', async () => {
    const rows = await prisma.course.findMany({
      where: { id: { in: courses } },
      orderBy: { id: 'asc' },
    });
    const before = structuredClone(rows);
    const projected = await prisma.$transaction((tx) => decorateCourseDifficulties(tx, rows));
    expect(rows).toEqual(before);
    expect(projected).toHaveLength(2);
    expect(projected[0].id).toBe(rows[0].id);
  });
  it('handles an empty collection without trying to invent a prior', async () => {
    const projected = await prisma.$transaction((tx) => decorateCourseDifficulties(tx, []));
    expect(projected).toEqual([]);
  });
  it('keeps all courses in a projection on one prior', async () => {
    await vote();
    const rows = await prisma.course.findMany({ where: { id: { in: courses } } });
    const projected = await prisma.$transaction((tx) => decorateCourseDifficulties(tx, rows));
    expect(new Set(projected.map((course) => course.ratingPriorMean)).size).toBe(1);
  });
  it('resolves the rated prior once for fifty projections', async () => {
    const client = new PrismaClient({ log: [{ level: 'query', emit: 'event' }] });
    const queries: string[] = [];
    client.$on('query', (event) => queries.push(event.query));
    try {
      const rows = await client.course.findMany({ where: { id: { in: courses } } });
      queries.length = 0;
      await client.$transaction((tx) =>
        decorateCourseDifficulties(
          tx,
          Array.from({ length: 50 }, (_, index) => rows[index % rows.length]),
        ),
      );
      expect(
        queries.filter((query) => query.includes('AVG(') && query.includes('course_ratings')),
      ).toHaveLength(1);
    } finally {
      await client.$disconnect();
    }
  });
  it('keeps cached counts and the prior on one snapshot during a concurrent vote', async () => {
    await prisma.$transaction(
      async (tx) => {
        const rows = await tx.course.findMany({ where: { id: { in: courses } } });
        const global = await tx.courseRating.aggregate({ _avg: { rating: true } });
        const seed = await tx.course.aggregate({ _avg: { difficultyLevel: true } });
        await vote();
        const projected = await decorateCourseDifficulties(tx, rows);
        expect(projected.every((course) => course.ratingCount === 0)).toBe(true);
        expect(
          projected.every(
            (course) =>
              course.ratingPriorMean === (global._avg.rating ?? seed._avg.difficultyLevel),
          ),
        ).toBe(true);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    expect((await readCourseRatings(courses[0])).count).toBe(1);
  });
  it('decorates real curriculum rows consistently, including duplicate elective placements', async () => {
    const response = await request(app).get('/api/courses/curriculum');
    expect(response.status).toBe(200);
    const rows = response.body.data.flatMap(
      (group: { courses: ProjectedCourse[] }) => group.courses,
    ) as ProjectedCourse[];
    const dbIds = new Set(
      (await prisma.course.findMany({ select: { id: true } })).map((course) => course.id),
    );
    const valid = rows.filter((course) => dbIds.has(course.id));
    expect(valid.length).toBeGreaterThan(0);
    for (const row of valid) {
      expect(Number.isFinite(row.ratingDifficulty)).toBe(true);
      expect(Number.isInteger(row.ratingCount)).toBe(true);
      if (row.ratingCount === 0) expect(row.ratingDifficulty).toBe(row.ratingPriorMean);
    }
    const placements = new Map<string, ProjectedCourse[]>();
    for (const row of valid) placements.set(row.id, [...(placements.get(row.id) ?? []), row]);
    for (const group of placements.values())
      expect(
        new Set(
          group.map((course) =>
            JSON.stringify([
              course.avgRating,
              course.ratingCount,
              course.ratingDifficulty,
              course.ratingPriorMean,
            ]),
          ),
        ).size,
      ).toBe(1);
  });
});
