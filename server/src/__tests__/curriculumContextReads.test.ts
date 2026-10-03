import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import type {
  ApiResponse,
  CurriculumDetailDTO,
  CurriculumSummaryDTO,
} from '@iu-study-planner/shared';
import app from '../index';
import { prisma } from '../db';
import { readCurriculumContext, readCurriculumSnapshot } from '../services/curriculumContexts';

describe('isolated curriculum context reads (PostgreSQL)', () => {
  const prefix = `context-read-${randomUUID()}`;
  const courseIds: string[] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const curriculumIds: string[] = [randomUUID(), randomUUID(), randomUUID()];
  const userId = randomUUID();
  const secondUserId = randomUUID();

  beforeAll(async () => {
    await prisma.course.createMany({
      data: courseIds.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: `Simulated course ${index}`,
        credits: 3,
        difficultyLevel: [1, 5, 2, 4][index],
        academicYear: 4,
        academicSemester: 2,
        electiveGroup: 'Global legacy group',
        electiveSelectCount: 9,
      })),
    });
    await prisma.curriculum.createMany({
      data: curriculumIds.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: `Simulated context ${index}`,
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
        sourceLabel: 'Simulated reference',
      })),
    });
    await prisma.user.create({
      data: {
        id: userId,
        studentId: prefix,
        name: 'Simulated student',
        email: `${prefix}@example.test`,
        curriculumId: curriculumIds[1],
      },
    });
    await prisma.user.create({
      data: {
        id: secondUserId,
        studentId: `${prefix}-second`,
        name: 'Second simulated student',
        email: `${prefix}-second@example.test`,
      },
    });
    for (const [index, members] of [
      [courseIds[0], courseIds[1]],
      [courseIds[0], courseIds[2]],
    ].entries()) {
      for (const [sourceOrder, courseId] of members.entries()) {
        const member = await prisma.curriculumCourse.create({
          data: { curriculumId: curriculumIds[index], courseId },
        });
        await prisma.curriculumPlacement.create({
          data: {
            curriculumCourseId: member.id,
            academicYear: index ? 4 : 1,
            academicSemester: 1,
            sourceOrder,
          },
        });
        if (index === 0 && sourceOrder === 0) {
          await prisma.curriculumPlacement.create({
            data: {
              curriculumCourseId: member.id,
              academicYear: 2,
              academicSemester: 2,
              electiveGroup: 'Context elective',
              electiveSelectCount: 1,
              sourceOrder: 2,
            },
          });
        }
      }
    }
    await prisma.curriculumRequirement.createMany({
      data: [
        {
          curriculumId: curriculumIds[0],
          name: 'Free elective',
          credits: 3,
          academicYear: 3,
          academicSemester: 2,
          sourceOrder: 3,
        },
        { curriculumId: curriculumIds[1], name: 'Free elective', credits: 4, sourceOrder: 2 },
      ],
    });
    await prisma.curriculumPrerequisite.createMany({
      data: [
        {
          curriculumId: curriculumIds[0],
          courseId: courseIds[1],
          prerequisiteId: courseIds[0],
          isStrict: false,
          isCorequisite: true,
        },
        { curriculumId: curriculumIds[1], courseId: courseIds[0], prerequisiteId: courseIds[2] },
      ],
    });
    await prisma.prerequisite.create({
      data: { courseId: courseIds[0], prerequisiteId: courseIds[3] },
    });
  });
  beforeEach(() =>
    prisma.courseRating.deleteMany({ where: { userId: { in: [userId, secondUserId] } } }),
  );
  afterAll(async () => {
    await prisma.curriculum.deleteMany({ where: { id: { in: curriculumIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, secondUserId] } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.$disconnect();
  });
  const vote = (index: number, rating: number) =>
    prisma.courseRating.create({ data: { userId, courseId: courseIds[index], rating } });
  async function detail(index = 0) {
    const response = await request(app).get(`/api/curricula/${curriculumIds[index]}`);
    expect(response.status).toBe(200);
    return (response.body as ApiResponse<CurriculumDetailDTO>).data!;
  }

  it('lists only reference metadata in code order with unknown totals preserved', async () => {
    const response = await request(app).get('/api/curricula');
    expect(response.status).toBe(200);
    const rows = (response.body as ApiResponse<CurriculumSummaryDTO[]>).data!;
    expect(rows.map(({ code }) => code)).toEqual([...rows.map(({ code }) => code)].sort());
    const fixtureRows = rows.filter(({ id }) => curriculumIds.includes(id));
    expect(fixtureRows).toHaveLength(3);
    expect(
      fixtureRows.every(
        ({ usage, totalCredits }) => usage === 'REFERENCE_ONLY' && totalCredits === null,
      ),
    ).toBe(true);
    expect(fixtureRows[0]).not.toHaveProperty('users');
  });

  it('keeps unique identities and repeated context placements without legacy column fallback', async () => {
    const saved = await detail();
    expect(saved.courses.map(({ id }) => id)).toEqual([courseIds[0], courseIds[1]]);
    const first = saved.courses[0];
    expect(first.placements).toMatchObject([
      { academicYear: 1, academicSemester: 1, electiveGroup: null, sourceOrder: 0 },
      {
        academicYear: 2,
        academicSemester: 2,
        electiveGroup: 'Context elective',
        electiveSelectCount: 1,
        sourceOrder: 2,
      },
    ]);
    expect(first).not.toHaveProperty('academicYear');
    expect(first).not.toHaveProperty('electiveGroup');
    expect(first).not.toHaveProperty('category');
    expect(saved.requirements).toMatchObject([
      { kind: 'FREE_ELECTIVE', credits: 3, academicYear: 3, sourceOrder: 3 },
    ]);
    expect(saved.courses.every(({ code }) => code !== '')).toBe(true);
  });

  it('uses only context prerequisites and treats every preserved flag combination as mandatory', async () => {
    const first = await detail();
    const second = await detail(1);
    expect(first.prerequisites).toHaveLength(1);
    expect(first.prerequisites[0]).toMatchObject({
      courseId: courseIds[1],
      prerequisiteId: courseIds[0],
      isStrict: false,
      isCorequisite: true,
      mandatory: true,
    });
    expect(second.prerequisites).toHaveLength(1);
    expect(second.prerequisites[0]).toMatchObject({
      courseId: courseIds[0],
      prerequisiteId: courseIds[2],
      mandatory: true,
    });
    expect(first.prerequisites.some(({ prerequisiteId }) => prerequisiteId === courseIds[3])).toBe(
      false,
    );
  });

  it('does not leak courses, requirements or placements between contexts sharing an identity', async () => {
    const first = await detail();
    const second = await detail(1);
    const firstAgain = await detail();
    expect(firstAgain).toEqual(first);
    expect(second.courses.map(({ id }) => id)).toEqual([courseIds[0], courseIds[2]]);
    expect(second.courses[0].placements).toHaveLength(1);
    expect(second.courses[0].placements[0].academicYear).toBe(4);
    expect(second.requirements).toMatchObject([{ credits: 4, academicYear: null }]);
  });

  it('uses the unique member-course seed mean with no votes, unaffected by repeated placements', async () => {
    const first = await detail();
    const second = await detail(1);
    expect(first.ratingPrior).toEqual({ mean: 3, source: 'CURRICULUM_SEED' });
    expect(second.ratingPrior).toEqual({ mean: 1.5, source: 'CURRICULUM_SEED' });
    expect(
      first.courses.every(
        ({ ratingCount, ratingDifficulty }) => ratingCount === 0 && ratingDifficulty === 3,
      ),
    ).toBe(true);
    expect(first.courses[0].difficultyLevel).toBe(1);
  });

  it('ignores unrelated global votes instead of falling back to a global rated mean', async () => {
    await vote(3, 1);
    expect((await detail()).ratingPrior).toEqual({ mean: 3, source: 'CURRICULUM_SEED' });
  });

  it('uses votes on member courses from any student while retaining global course evidence', async () => {
    await vote(0, 5);
    await vote(1, 3);
    await vote(2, 1);
    await vote(3, 1);
    const first = await detail();
    const second = await detail(1);
    expect(first.ratingPrior).toEqual({ mean: 4, source: 'CURRICULUM_RATINGS' });
    expect(second.ratingPrior).toEqual({ mean: 3, source: 'CURRICULUM_RATINGS' });
    expect(first.courses[0]).toMatchObject({
      avgRating: 5,
      ratingCount: 1,
      ratingPriorMean: 4,
      ratingPriorSource: 'CURRICULUM_RATINGS',
    });
    expect(second.courses[0]).toMatchObject({ avgRating: 5, ratingCount: 1 });
    expect(first.courses[0].ratingDifficulty).toBeCloseTo(4 + 1 / 6, 12);
    expect(second.courses[0].ratingDifficulty).toBeCloseTo(3 + 2 / 6, 12);
  });

  it('uses the context mean exactly for an unvoted member after another course receives a vote', async () => {
    await vote(0, 5);
    expect((await detail()).courses[1]).toMatchObject({
      avgRating: null,
      ratingCount: 0,
      ratingDifficulty: 5,
      ratingPriorMean: 5,
    });
  });

  it('weights the prior by actual votes rather than averaging cached course means', async () => {
    await vote(0, 5);
    await vote(1, 1);
    await prisma.courseRating.create({
      data: { userId: secondUserId, courseId: courseIds[0], rating: 1 },
    });
    const saved = await detail();
    expect(saved.ratingPrior?.mean).toBeCloseTo(7 / 3, 12);
    expect(saved.courses[0]).toMatchObject({ avgRating: 3, ratingCount: 2 });
    expect(saved.courses[0].ratingDifficulty).toBeCloseTo(7 / 3 + ((3 - 7 / 3) * 2) / 7, 12);
  });

  it('returns empty reference contexts without an invented prior', async () => {
    expect(await detail(2)).toMatchObject({
      courses: [],
      prerequisites: [],
      requirements: [],
      ratingPrior: null,
      usage: 'REFERENCE_ONLY',
    });
  });

  it('rejects malformed IDs and retains a separate missing-context response', async () => {
    expect((await request(app).get('/api/curricula/not-a-uuid')).status).toBe(400);
    expect((await request(app).get(`/api/curricula/${randomUUID()}`)).status).toBe(404);
    const uppercase = await request(app).get(`/api/curricula/${curriculumIds[0].toUpperCase()}`);
    expect(uppercase.status).toBe(200);
    expect(uppercase.body.data.id).toBe(curriculumIds[0]);
  });

  it('keeps cached course evidence and prior in one snapshot during a concurrent vote', async () => {
    await prisma.$transaction(
      async (tx) => {
        const before = await readCurriculumSnapshot(tx, curriculumIds[0]);
        await vote(0, 5);
        expect(await readCurriculumSnapshot(tx, curriculumIds[0])).toEqual(before);
        expect(before?.ratingPrior).toEqual({ mean: 3, source: 'CURRICULUM_SEED' });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    expect((await readCurriculumContext(curriculumIds[0]))?.courses[0].ratingCount).toBe(1);
  });

  it('resolves one rated prior for the full collection instead of per-course aggregation', async () => {
    await vote(0, 5);
    const db = new PrismaClient({ log: [{ level: 'query', emit: 'event' }] });
    const queries: string[] = [];
    db.$on('query', ({ query }) => queries.push(query));
    try {
      await db.$transaction((tx) => readCurriculumSnapshot(tx, curriculumIds[0]), {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
      expect(
        queries.filter((query) => query.includes('AVG(') && query.includes('course_ratings')),
      ).toHaveLength(1);
      expect(
        queries.filter((query) => query.includes('AVG(') && query.includes('difficulty_level')),
      ).toHaveLength(0);
    } finally {
      await db.$disconnect();
    }
  });

  it('reading a context does not assign students or modify source/catalog rows', async () => {
    const beforeUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const beforeCourses = await prisma.course.findMany({
      where: { id: { in: courseIds } },
      orderBy: { code: 'asc' },
    });
    await detail();
    await detail(1);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toEqual(beforeUser);
    expect(
      await prisma.course.findMany({ where: { id: { in: courseIds } }, orderBy: { code: 'asc' } }),
    ).toEqual(beforeCourses);
  });
});
