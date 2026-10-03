import { randomUUID } from 'crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { CourseCategory } from '@prisma/client';
import { prisma } from '../db';
import router from '../routes/recommendations';
import WorkloadBalancer from '../services/workloadBalancer';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/recommendations', router);

describe('numeric grade fit in recommendations (PostgreSQL)', () => {
  const prefix = `numeric-fit-${randomUUID()}`;
  const owner = randomUUID();
  const other = randomUUID();
  const admin = randomUUID();
  const general = randomUUID();
  const elective = randomUUID();
  const historyGeneral = randomUUID();
  const historyWeighted = randomUUID();
  const historyElective = randomUUID();
  const historyOtherCategory = randomUUID();
  const blocked = randomUUID();
  const missingParent = randomUUID();
  const springOnly = randomUUID();
  const oversized = randomUUID();
  const ownedCourseIds = [
    general,
    elective,
    historyGeneral,
    historyWeighted,
    historyElective,
    historyOtherCategory,
    blocked,
    missingParent,
    springOnly,
    oversized,
  ];
  let physicalId: string;
  let createdPhysical = false;
  let scoring: jest.SpyInstance<
    ReturnType<WorkloadBalancer['calculateRecommendations']>,
    Parameters<WorkloadBalancer['calculateRecommendations']>
  >;
  const cookie = (id: string) => `${AUTH_COOKIE_NAME}=${issueToken(id)}`;
  const read = (
    userId = owner,
    session = owner,
    query = '?semester=FALL&maxCredits=3&maxDifficulty=5',
  ) =>
    request(app).get(`/api/recommendations/user/${userId}${query}`).set('Cookie', cookie(session));
  const numericInput = () => scoring.mock.calls[scoring.mock.calls.length - 1][0].numericHistory;
  const resultIds = (response: request.Response) =>
    (response.body.data.courses as { id: string }[]).map(({ id }) => id);
  const attempt = (courseId: string, score: number, userId = owner) =>
    prisma.gradeAttempt.create({ data: { userId, courseId, score, requestId: randomUUID() } });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [owner, other, admin].map((id) => ({
        id,
        studentId: `${prefix}-${id}`,
        email: `${prefix}-${id}@example.test`,
        name: 'Numeric recommendation fixture',
        role: id === admin ? 'ADMIN' : 'STUDENT',
      })),
    });
    const definitions: {
      id: string;
      category: CourseCategory;
      credits?: number;
      spring?: boolean;
    }[] = [
      { id: general, category: 'GENERAL_EDUCATION' },
      { id: elective, category: 'MAJOR_ELECTIVE' },
      { id: historyGeneral, category: 'GENERAL_EDUCATION', credits: 1 },
      { id: historyWeighted, category: 'GENERAL_EDUCATION', credits: 4 },
      { id: historyElective, category: 'MAJOR_ELECTIVE' },
      { id: historyOtherCategory, category: 'CORE' },
      { id: blocked, category: 'GENERAL_EDUCATION' },
      { id: missingParent, category: 'GENERAL_EDUCATION' },
      { id: springOnly, category: 'GENERAL_EDUCATION', spring: true },
      { id: oversized, category: 'GENERAL_EDUCATION', credits: 4 },
    ];
    await prisma.course.createMany({
      data: definitions.map((definition, i) => ({
        id: definition.id,
        code: `${prefix}-${i}`,
        name: 'Numeric fit course',
        credits: definition.credits ?? 3,
        category: definition.category,
        difficultyLevel: 2,
        semesterOffered: definition.spring ? ['SPRING'] : ['FALL'],
      })),
    });
    const existingPhysical = await prisma.course.findUnique({ where: { code: 'PT001IU' } });
    if (existingPhysical) physicalId = existingPhysical.id;
    else {
      physicalId = randomUUID();
      createdPhysical = true;
      await prisma.course.create({
        data: {
          id: physicalId,
          code: 'PT001IU',
          name: 'Physical training fixture',
          credits: 2,
          category: 'GENERAL_EDUCATION',
          difficultyLevel: 2,
          semesterOffered: ['FALL'],
        },
      });
    }
    await prisma.prerequisite.create({
      data: {
        courseId: blocked,
        prerequisiteId: missingParent,
        isStrict: false,
        isCorequisite: true,
      },
    });
    const excluded = [general, elective, blocked, missingParent, springOnly, oversized];
    const complete = await prisma.course.findMany({
      where: { id: { notIn: excluded } },
      select: { id: true },
    });
    for (const userId of [owner, other, admin]) {
      await prisma.studentRecord.createMany({
        data: complete.map(({ id }) => ({
          userId,
          courseId: id,
          status: 'COMPLETED' as const,
        })),
      });
      await prisma.studentRecord.create({
        data: { userId, courseId: missingParent, status: 'IN_PROGRESS' },
      });
    }
    // This is a call-through spy on the scorer boundary: all database reads and
    // ranking remain real, while its normalized evidence can be checked directly.
    scoring = jest.spyOn(WorkloadBalancer.prototype, 'calculateRecommendations');
  });

  beforeEach(async () => {
    await prisma.gradeAttempt.deleteMany({ where: { userId: { in: [owner, other, admin] } } });
    await prisma.studentRecord.updateMany({
      where: {
        userId: owner,
        courseId: { in: [historyGeneral, historyWeighted, historyElective, historyOtherCategory] },
      },
      data: { status: 'COMPLETED', grade: null, gradePoints: null },
    });
    scoring.mockClear();
  });
  afterAll(async () => {
    scoring?.mockRestore();
    await prisma.user.deleteMany({ where: { id: { in: [owner, other, admin] } } });
    await prisma.course.deleteMany({
      where: { id: { in: [...ownedCourseIds, ...(createdPhysical ? [physicalId] : [])] } },
    });
    await prisma.$disconnect();
  });

  it('uses the highest retake, not latest or an average, to favor the matching category', async () => {
    await attempt(historyGeneral, 40);
    await attempt(historyGeneral, 90);
    await attempt(historyGeneral, 50);
    const response = await read();
    expect(response.status).toBe(200);
    expect(resultIds(response)).toEqual([general]);
    expect(numericInput()).toEqual([
      expect.objectContaining({
        courseId: historyGeneral,
        score: 90,
        credits: 1,
        category: 'GENERAL_EDUCATION',
      }),
    ]);
    expect(numericInput()[0].ratingDifficulty).toBeGreaterThanOrEqual(1);
    expect(numericInput()[0].ratingDifficulty).toBeLessThanOrEqual(5);
    expect(await prisma.gradeAttempt.count({ where: { userId: owner } })).toBe(3);
  });

  it('passes distinct course credit weights through the real route instead of weighting attempts', async () => {
    await attempt(historyGeneral, 80);
    await attempt(historyGeneral, 90);
    await attempt(historyWeighted, 30);
    const response = await read();
    expect(response.status).toBe(200);
    expect(resultIds(response)).toEqual([general]);
    expect(numericInput()).toHaveLength(2);
    expect(numericInput()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ courseId: historyGeneral, score: 90, credits: 1 }),
        expect.objectContaining({ courseId: historyWeighted, score: 30, credits: 4 }),
      ]),
    );
  });

  it('preserves a real zero as evidence, without turning it into a positive grade-fit bonus', async () => {
    const baseline = await read();
    await attempt(historyGeneral, 0);
    const response = await read();
    expect(response.status).toBe(200);
    expect(numericInput()).toEqual([
      expect.objectContaining({ courseId: historyGeneral, score: 0 }),
    ]);
    expect(resultIds(response)).toEqual(resultIds(baseline));
  });

  it('does not apply strong scores from a different category to either candidate', async () => {
    const baseline = await read();
    await attempt(historyOtherCategory, 100);
    const response = await read();
    expect(response.status).toBe(200);
    expect(numericInput()).toEqual([expect.objectContaining({ category: 'CORE', score: 100 })]);
    expect(resultIds(response)).toEqual(resultIds(baseline));
  });

  it('excludes physical-training scores and does not invent scores for completed courses', async () => {
    await attempt(physicalId, 100);
    const response = await read();
    expect(response.status).toBe(200);
    expect(numericInput()).toEqual([]);
    expect(
      await prisma.gradeAttempt.count({ where: { userId: owner, courseId: physicalId } }),
    ).toBe(1);
  });

  it('preserves legacy A/4 metadata without silently converting it to a numeric score', async () => {
    const baseline = await read();
    await prisma.studentRecord.update({
      where: { userId_courseId: { userId: owner, courseId: historyGeneral } },
      data: { grade: 'A', gradePoints: 4 },
    });
    const response = await read();
    expect(response.status).toBe(200);
    expect(numericInput()).toEqual([]);
    expect(resultIds(response)).toEqual(resultIds(baseline));
    expect(
      await prisma.studentRecord.findUniqueOrThrow({
        where: { userId_courseId: { userId: owner, courseId: historyGeneral } },
      }),
    ).toMatchObject({ grade: 'A', gradePoints: 4 });
  });

  it('keeps historical numeric evidence after uncompletion without treating scores as prerequisites', async () => {
    await attempt(historyGeneral, 100);
    await attempt(missingParent, 100);
    await prisma.studentRecord.update({
      where: { userId_courseId: { userId: owner, courseId: historyGeneral } },
      data: { status: 'DROPPED' },
    });
    const response = await read(owner, owner, '?semester=FALL&maxCredits=30&maxDifficulty=5');
    expect(response.status).toBe(200);
    expect(numericInput()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ courseId: historyGeneral, score: 100 }),
        expect.objectContaining({ courseId: missingParent, score: 100 }),
      ]),
    );
    expect(resultIds(response)).not.toContain(blocked);
    expect(resultIds(response)).not.toContain(missingParent);
  });

  it('uses the requested owner history for admin reads and never mixes another account scores', async () => {
    await attempt(historyGeneral, 80, owner);
    await attempt(historyElective, 100, other);
    await attempt(historyElective, 100, admin);
    const ownerResponse = await read();
    expect(resultIds(ownerResponse)).toEqual([general]);
    const adminResponse = await read(owner, admin);
    expect(adminResponse.status).toBe(200);
    expect(resultIds(adminResponse)).toEqual([general]);
    expect(numericInput()).toEqual([
      expect.objectContaining({ courseId: historyGeneral, score: 80 }),
    ]);
    const otherResponse = await read(other, other);
    expect(otherResponse.status).toBe(200);
    expect(resultIds(otherResponse)).toEqual([elective]);
    expect(numericInput()).toEqual([
      expect.objectContaining({ courseId: historyElective, score: 100 }),
    ]);
    scoring.mockClear();
    expect((await read(owner, other)).status).toBe(403);
    expect(scoring).not.toHaveBeenCalled();
    expect((await request(app).get(`/api/recommendations/user/${owner}`)).status).toBe(401);
  });

  it('retains authoritative semester and credit filters when matching grades are strong', async () => {
    await attempt(historyGeneral, 100);
    const response = await read();
    expect(response.status).toBe(200);
    expect(resultIds(response)).toEqual([general]);
    expect(resultIds(response)).not.toContain(springOnly);
    expect(resultIds(response)).not.toContain(oversized);
    expect(response.body.data.stats.totalRecommendedCredits).toBe(3);
    const spring = await read(owner, owner, '?semester=SPRING&maxCredits=3&maxDifficulty=5');
    expect(spring.status).toBe(200);
    expect(resultIds(spring)).toEqual([springOnly]);
    const tooSmall = await read(owner, owner, '?semester=FALL&maxCredits=2&maxDifficulty=5');
    expect(tooSmall.status).toBe(200);
    expect(resultIds(tooSmall)).toEqual([]);
  });
});
