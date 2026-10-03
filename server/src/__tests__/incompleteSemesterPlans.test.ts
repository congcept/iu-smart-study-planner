import { randomUUID } from 'crypto';
import express from 'express';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import router from '../routes/recommendations';
import { decorateCourseDifficulties } from '../services/courseRatings';
import SemesterPlanner from '../services/semesterPlanner';

const planner = new SemesterPlanner();
const app = express();
app.use(express.json());
app.use('/api/recommendations', router);

describe('incomplete semester schedules (PostgreSQL)', () => {
  const prefix = `planner-gaps-${randomUUID()}`;
  const ids = Array.from({ length: 11 }, () => randomUUID());
  const catalog = () =>
    prisma.$transaction(
      async (tx) =>
        decorateCourseDifficulties(
          tx,
          await tx.course.findMany({
            where: { id: { in: ids } },
            include: { prerequisites: true },
            orderBy: { code: 'asc' },
          }),
        ),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  const cycle = () =>
    prisma.prerequisite.createMany({
      data: [
        { courseId: ids[0], prerequisiteId: ids[1] },
        { courseId: ids[1], prerequisiteId: ids[0] },
      ],
    });

  beforeAll(async () => {
    await prisma.course.createMany({
      data: ids.map((id, index) => ({
        id,
        code: `${prefix}-${String(index).padStart(2, '0')}`,
        name: 'Incomplete planner test',
        credits: 3,
        difficultyLevel: 2,
        category: 'CORE',
      })),
    });
  });
  beforeEach(async () => {
    await prisma.prerequisite.deleteMany({ where: { courseId: { in: ids } } });
  });
  afterAll(async () => {
    await prisma.course.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it('reports an empty catalog complete without inventing a graduation date', () => {
    expect(planner.plan([], new Set(), 'normal').stats).toEqual({
      totalRemainingCredits: 0,
      planningComplete: true,
      unplannedCourseIds: [],
      plannedSemesterCount: 0,
      semestersToCompletion: 0,
      estimatedGraduationSemester: null,
    });
  });
  it('reports no remaining work when every course is completed', async () => {
    expect(planner.plan(await catalog(), new Set(ids), 'normal').stats).toMatchObject({
      planningComplete: true,
      totalRemainingCredits: 0,
      unplannedCourseIds: [],
      semestersToCompletion: 0,
      estimatedGraduationSemester: null,
    });
  });
  it('keeps estimates for a fully scheduled prerequisite chain', async () => {
    await prisma.prerequisite.create({ data: { courseId: ids[1], prerequisiteId: ids[0] } });
    const result = planner.plan((await catalog()).slice(0, 2), new Set(), 'normal');
    expect(result.stats).toMatchObject({
      planningComplete: true,
      unplannedCourseIds: [],
      plannedSemesterCount: 2,
      semestersToCompletion: 2,
      estimatedGraduationSemester: expect.stringMatching(/^(Spring|Fall) \d{4}$/),
    });
  });
  it('reports every course trapped in a closed cycle', async () => {
    await cycle();
    expect(planner.plan((await catalog()).slice(0, 2), new Set(), 'normal').stats).toEqual({
      totalRemainingCredits: 6,
      planningComplete: false,
      unplannedCourseIds: ids.slice(0, 2),
      plannedSemesterCount: 0,
      semestersToCompletion: null,
      estimatedGraduationSemester: null,
    });
  });
  it('reports missing prerequisites instead of claiming immediate graduation', async () => {
    await prisma.prerequisite.create({ data: { courseId: ids[1], prerequisiteId: ids[0] } });
    expect(planner.plan([(await catalog())[1]], new Set(), 'normal').stats).toMatchObject({
      planningComplete: false,
      unplannedCourseIds: [ids[1]],
      semestersToCompletion: null,
      estimatedGraduationSemester: null,
    });
  });
  it('reports an oversized course that never fits the requested credit cap', async () => {
    const [course] = await catalog();
    expect(planner.plan([{ ...course, credits: 10 }], new Set(), 'low').stats).toMatchObject({
      planningComplete: false,
      unplannedCourseIds: [course.id],
      plannedSemesterCount: 0,
      semestersToCompletion: null,
      estimatedGraduationSemester: null,
    });
  });
  it('retains feasible suggestions while marking the remaining cycle incomplete', async () => {
    await cycle();
    const result = planner.plan((await catalog()).slice(0, 3), new Set(), 'normal');
    expect(result.nextRecommendedIds).toEqual([ids[2]]);
    expect(result.stats).toMatchObject({
      planningComplete: false,
      unplannedCourseIds: ids.slice(0, 2),
      plannedSemesterCount: 1,
      semestersToCompletion: null,
      estimatedGraduationSemester: null,
    });
  });
  it('reports courses beyond the horizon without changing prerequisite ordering', async () => {
    await prisma.prerequisite.createMany({
      data: ids.slice(1).map((courseId, index) => ({ courseId, prerequisiteId: ids[index] })),
    });
    const result = planner.plan(await catalog(), new Set(), 'high');
    expect(result.semesters.map((slot) => slot.recommendedCourseIds)).toEqual(
      ids.slice(0, 10).map((id) => [id]),
    );
    expect(result.stats).toMatchObject({
      planningComplete: false,
      unplannedCourseIds: [ids[10]],
      plannedSemesterCount: 10,
      semestersToCompletion: null,
      estimatedGraduationSemester: null,
    });
  });
  it('exposes the gaps through the API while keeping valid next-course suggestions', async () => {
    await cycle();
    const other = await prisma.course.findMany({
      where: { id: { notIn: ids.slice(0, 3) } },
      select: { id: true },
    });
    const response = await request(app)
      .post('/api/recommendations/plan-semester')
      .send({ intensityMode: 'normal', completedCourseIds: other.map((course) => course.id) });
    expect(response.status).toBe(200);
    expect(response.body.data.nextRecommendedIds).toEqual([ids[2]]);
    expect(response.body.data.stats).toMatchObject({
      planningComplete: false,
      unplannedCourseIds: expect.arrayContaining(ids.slice(0, 2)),
      plannedSemesterCount: 1,
      semestersToCompletion: null,
      estimatedGraduationSemester: null,
    });
    expect(response.body.data.stats.unplannedCourseIds).toHaveLength(2);
  });
});
