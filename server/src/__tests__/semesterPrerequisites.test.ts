import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { decorateCourseDifficulties } from '../services/courseRatings';
import { prisma } from '../db';
import SemesterPlanner from '../services/semesterPlanner';

const planner = new SemesterPlanner();
describe('database-authoritative semester prerequisites', () => {
  const prefix = `planner-prereqs-${randomUUID()}`;
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const courses = () =>
    prisma.$transaction(
      async (tx) =>
        decorateCourseDifficulties(
          tx,
          await tx.course.findMany({
            where: { id: { in: ids } },
            include: {
              prerequisites: { include: { prerequisite: true } },
              isPrerequisiteFor: { include: { course: { select: { id: true } } } },
            },
            orderBy: { code: 'asc' },
          }),
        ),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  beforeAll(async () => {
    await prisma.course.createMany({
      data: ids.map((id, index) => ({
        id,
        code: `${prefix}-${index}`,
        name: 'Planner prerequisite course',
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
  it.each([
    { isStrict: true, isCorequisite: false },
    { isStrict: false, isCorequisite: false },
    { isStrict: false, isCorequisite: true },
  ])('requires an earlier completed/scheduled prerequisite for %j', async (flags) => {
    await prisma.prerequisite.create({
      data: { courseId: ids[1], prerequisiteId: ids[0], ...flags },
    });
    const all = await courses();
    const plan = planner.plan(all.slice(0, 2), new Set(), 'normal');
    expect(plan.nextRecommendedIds).toEqual([ids[0]]);
    expect(plan.semesters[1].recommendedCourseIds).toEqual([ids[1]]);
    expect(planner.plan(all.slice(0, 2), new Set([ids[0]]), 'normal').nextRecommendedIds).toEqual([
      ids[1],
    ]);
  });
  it('schedules a transitive chain in successive semesters', async () => {
    await prisma.prerequisite.createMany({
      data: ids.slice(1).map((courseId, index) => ({
        courseId,
        prerequisiteId: ids[index],
        isStrict: false,
        isCorequisite: index === 1,
      })),
    });
    expect(
      planner
        .plan(await courses(), new Set(), 'normal')
        .semesters.map((slot) => slot.recommendedCourseIds),
    ).toEqual(ids.map((id) => [id]));
  });
  it('requires every parent rather than any one completed parent', async () => {
    await prisma.prerequisite.createMany({
      data: [
        { courseId: ids[2], prerequisiteId: ids[0] },
        { courseId: ids[2], prerequisiteId: ids[1] },
      ],
    });
    const plan = planner.plan((await courses()).slice(0, 3), new Set([ids[0]]), 'normal');
    expect(plan.nextRecommendedIds).toEqual([ids[1]]);
    expect(plan.semesters[1].recommendedCourseIds).toEqual([ids[2]]);
  });
  it('does not invent a missing relationship from a legacy course code', async () => {
    const [course] = await courses();
    const renamed = { ...course, code: 'PH015IU' };
    expect(planner.plan([renamed], new Set(), 'normal').nextRecommendedIds).toEqual([course.id]);
  });
  it('honors a changed database relationship without source edits', async () => {
    const dependency = await prisma.prerequisite.create({
      data: { courseId: ids[1], prerequisiteId: ids[0] },
    });
    const chosen = (await courses()).slice(0, 2);
    expect(planner.plan(chosen, new Set(), 'normal').nextRecommendedIds).toEqual([ids[0]]);
    await prisma.prerequisite.delete({ where: { id: dependency.id } });
    expect(
      planner.plan((await courses()).slice(0, 2), new Set(), 'normal').nextRecommendedIds,
    ).toEqual([ids[0], ids[1]]);
  });
  it('does not schedule a course whose dependency is absent from the catalog and progress', async () => {
    await prisma.prerequisite.create({ data: { courseId: ids[1], prerequisiteId: ids[0] } });
    const dependent = (await courses())[1];
    expect(planner.plan([dependent], new Set(), 'normal').semesters).toEqual([]);
  });
  it('terminates safely for a closed dependency cycle', async () => {
    await prisma.prerequisite.createMany({
      data: [
        { courseId: ids[0], prerequisiteId: ids[1] },
        { courseId: ids[1], prerequisiteId: ids[0] },
      ],
    });
    expect(planner.plan((await courses()).slice(0, 2), new Set(), 'normal').semesters).toEqual([]);
  });
  it('does not schedule a self-dependent course', async () => {
    await prisma.prerequisite.create({ data: { courseId: ids[0], prerequisiteId: ids[0] } });
    expect(planner.plan((await courses()).slice(0, 1), new Set(), 'normal').semesters).toEqual([]);
  });
  it('keeps already completed courses out of every suggested slot', async () => {
    const plan = planner.plan(await courses(), new Set([ids[0], ids[1]]), 'normal');
    expect(plan.semesters.flatMap((slot) => slot.recommendedCourseIds)).toEqual([ids[2], ids[3]]);
  });
});
