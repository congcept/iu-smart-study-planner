import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { CurriculumDetailSchema } from '@iu-study-planner/shared';
import app, { prisma } from '../index';

const placement = (changes: Record<string, unknown> = {}) => ({
  academicYear: 2,
  academicSemester: 1,
  electiveGroup: 'Elective group 01',
  electiveSelectCount: null,
  electiveSelectCredits: null,
  sourceOrder: 1,
  ...changes,
});

describe('credit-stated elective pools (PostgreSQL)', () => {
  const prefix = `elective-credits-${randomUUID()}`;
  const context = randomUUID();
  const course = randomUUID();
  const block = randomUUID();
  const otherCourse = randomUUID();
  const otherBlock = randomUUID();

  beforeAll(async () => {
    await prisma.curriculum.create({
      data: {
        id: context,
        code: prefix.slice(-8),
        name: 'Simulated credit-pool reference',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/reference',
      },
    });
    await prisma.course.createMany({
      data: [
        { id: course, code: `${prefix}-A`, name: 'Pooled course', credits: 4, difficultyLevel: 2 },
        {
          id: otherCourse,
          code: `${prefix}-B`,
          name: 'Count-stated course',
          credits: 3,
          difficultyLevel: 2,
        },
      ],
    });
    await prisma.curriculumCourse.createMany({
      data: [
        { id: block, curriculumId: context, courseId: course },
        { id: otherBlock, curriculumId: context, courseId: otherCourse },
      ],
    });
    await prisma.curriculumPlacement.createMany({
      data: [
        { curriculumCourseId: block, ...placement({ electiveSelectCredits: 7 }) },
        {
          curriculumCourseId: otherBlock,
          ...placement({ electiveSelectCount: 2, sourceOrder: 2 }),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.curriculum.deleteMany({ where: { id: context } });
    await prisma.course.deleteMany({ where: { id: { in: [course, otherCourse] } } });
    await prisma.$disconnect();
  });

  it('stores a credit-stated pool alongside a count-stated pool', async () => {
    const rows = await prisma.curriculumPlacement.findMany({
      where: { curriculumCourseId: { in: [block, otherBlock] } },
      orderBy: { sourceOrder: 'asc' },
      select: { electiveSelectCount: true, electiveSelectCredits: true, electiveGroup: true },
    });
    expect(rows).toEqual([
      { electiveSelectCount: null, electiveSelectCredits: 7, electiveGroup: 'Elective group 01' },
      { electiveSelectCount: 2, electiveSelectCredits: null, electiveGroup: 'Elective group 01' },
    ]);
  });

  it('returns the credit-stated pool through the reference read', async () => {
    const response = await request(app).get(`/api/curricula/${context}`);
    expect(response.status).toBe(200);
    const parsed = CurriculumDetailSchema.safeParse(response.body.data);
    expect(parsed.success).toBe(true);
    const placements = parsed.data!.courses.find(({ id }) => id === course)!.placements;
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({
      electiveSelectCount: null,
      electiveSelectCredits: 7,
      electiveGroup: 'Elective group 01',
    });
  });

  it('rejects a placement that states both a count and a credit total', async () => {
    await expect(
      prisma.curriculumPlacement.create({
        data: {
          curriculumCourseId: block,
          ...placement({ electiveSelectCount: 2, electiveSelectCredits: 8, sourceOrder: 90 }),
        },
      }),
    ).rejects.toThrow(/curriculum_placements_elective_pool_check/);
    expect(await prisma.curriculumPlacement.count({ where: { curriculumCourseId: block } })).toBe(
      1,
    );
  });

  it('rejects a credit total without an elective group', async () => {
    await expect(
      prisma.curriculumPlacement.create({
        data: {
          curriculumCourseId: otherBlock,
          ...placement({ electiveGroup: null, electiveSelectCredits: 4, sourceOrder: 91 }),
        },
      }),
    ).rejects.toThrow(/curriculum_placements_elective_pool_check/);
  });

  it('rejects a non-positive credit total', async () => {
    await expect(
      prisma.curriculumPlacement.create({
        data: {
          curriculumCourseId: block,
          ...placement({ electiveSelectCredits: 0, sourceOrder: 92 }),
        },
      }),
    ).rejects.toThrow(/curriculum_placements_elective_pool_check/);
  });

  it('rejects both pools on the client contract too', () => {
    const shared = CurriculumDetailSchema.safeParse({
      id: context,
      code: 'SIM',
      name: 'Simulated',
      school: 'CSE',
      degree: 'Bachelor',
      programUrl: 'https://example.test/reference',
      totalCredits: null,
      isGpaPath: false,
      sourceLabel: null,
      sourceUrl: null,
      usage: 'REFERENCE_ONLY',
      courses: [
        {
          id: course,
          code: 'A',
          name: 'A',
          credits: 4,
          difficultyLevel: 2,
          description: null,
          semesterOffered: ['FALL'],
          avgRating: null,
          ratingCount: 0,
          ratingDifficulty: 2,
          ratingPriorMean: 2,
          ratingPriorSource: 'CURRICULUM_SEED',
          placements: [
            {
              id: randomUUID(),
              academicYear: 2,
              academicSemester: 1,
              electiveGroup: 'Group',
              electiveSelectCount: 2,
              electiveSelectCredits: 8,
              sourceOrder: 1,
              sourceLabel: null,
            },
          ],
        },
      ],
      requirements: [],
      prerequisites: [],
      ratingPrior: { mean: 2, source: 'CURRICULUM_SEED' },
    });
    expect(shared.success).toBe(false);
    if (!shared.success)
      expect(shared.error.issues.some((issue) => /never both/.test(issue.message))).toBe(true);
  });
});
