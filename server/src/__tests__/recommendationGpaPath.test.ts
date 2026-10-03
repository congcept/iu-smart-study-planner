import { randomUUID } from 'crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { prisma } from '../db';
import router from '../routes/recommendations';
import { AUTH_COOKIE_NAME, issueToken } from '../services/authService';
import { calculateGradeSummary } from '../services/gradeSummary';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/recommendations', router);

describe('GPA path in personalized recommendations (PostgreSQL)', () => {
  const prefix = `recommendation-gpa-${randomUUID()}`;
  const owner = randomUUID();
  const other = randomUUID();
  const admin = randomUUID();
  const alternative = randomUUID();
  const springAlternative = randomUUID();
  const earlierElective = randomUUID();
  const blocked = randomUUID();
  const missingParent = randomUUID();
  const historyFive = randomUUID();
  const historyTwo = randomUUID();
  const zeroCredit = randomUUID();
  const ids = [
    alternative,
    springAlternative,
    earlierElective,
    blocked,
    missingParent,
    historyFive,
    historyTwo,
    zeroCredit,
  ];
  let thesisId: string;
  let thesisCredits: number;
  let physicalId: string;
  const createdSourceIds: string[] = [];
  const cookie = (id: string) => `${AUTH_COOKIE_NAME}=${issueToken(id)}`;
  const read = (userId = owner, session = owner, query = '?maxCredits=30&maxDifficulty=5') =>
    request(app).get(`/api/recommendations/user/${userId}${query}`).set('Cookie', cookie(session));
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
        name: 'Recommendation GPA fixture',
        role: id === admin ? 'ADMIN' : 'STUDENT',
      })),
    });
    let thesis = await prisma.course.findUnique({ where: { code: 'IT058IU' } });
    if (!thesis) {
      thesis = await prisma.course.create({
        data: {
          code: 'IT058IU',
          name: 'Thesis fixture',
          credits: 10,
          category: 'REQUIRED',
          difficultyLevel: 3,
          academicYear: 4,
          academicSemester: 2,
          semesterOffered: ['FALL', 'SPRING'],
        },
      });
      createdSourceIds.push(thesis.id);
    }
    // A pre-existing reference course is never rewritten to suit this fixture.
    expect(thesis).toMatchObject({ academicYear: 4, academicSemester: 2 });
    thesisId = thesis.id;
    thesisCredits = thesis.credits;
    let physical = await prisma.course.findUnique({ where: { code: 'PT001IU' } });
    if (!physical) {
      physical = await prisma.course.create({
        data: {
          code: 'PT001IU',
          name: 'Physical training fixture',
          credits: 2,
          category: 'GENERAL_EDUCATION',
          difficultyLevel: 2,
          semesterOffered: ['FALL'],
        },
      });
      createdSourceIds.push(physical.id);
    }
    physicalId = physical.id;
    await prisma.course.createMany({
      data: [
        {
          id: alternative,
          code: `${prefix}-alternative`,
          name: 'Alternative project',
          credits: thesisCredits,
          category: 'REQUIRED',
          academicYear: 4,
          academicSemester: 2,
          difficultyLevel: 2,
          semesterOffered: ['FALL', 'SPRING'],
        },
        {
          id: springAlternative,
          code: `${prefix}-spring`,
          name: 'Spring alternative',
          credits: 3,
          category: 'MAJOR_ELECTIVE',
          academicYear: 4,
          academicSemester: 2,
          difficultyLevel: 2,
          semesterOffered: ['SPRING'],
        },
        {
          id: earlierElective,
          code: `${prefix}-group03`,
          name: 'Earlier shared elective',
          credits: 3,
          category: 'MAJOR_ELECTIVE',
          academicYear: 4,
          academicSemester: 1,
          electiveGroup: 'Group 03',
          electiveSelectCount: 1,
          difficultyLevel: 2,
          semesterOffered: ['FALL', 'SPRING'],
        },
        {
          id: blocked,
          code: `${prefix}-blocked`,
          name: 'Blocked alternative',
          credits: 3,
          category: 'REQUIRED',
          academicYear: 4,
          academicSemester: 2,
          difficultyLevel: 2,
          semesterOffered: ['FALL', 'SPRING'],
        },
        {
          id: missingParent,
          code: `${prefix}-parent`,
          name: 'Unfinished prerequisite',
          credits: 3,
          category: 'CORE',
          difficultyLevel: 2,
          semesterOffered: ['FALL'],
        },
        {
          id: historyFive,
          code: `${prefix}-five`,
          name: 'Five credit score',
          credits: 5,
          category: 'GENERAL_EDUCATION',
          difficultyLevel: 2,
          semesterOffered: ['FALL'],
        },
        {
          id: historyTwo,
          code: `${prefix}-two`,
          name: 'Two credit score',
          credits: 2,
          category: 'GENERAL_EDUCATION',
          difficultyLevel: 2,
          semesterOffered: ['FALL'],
        },
        {
          id: zeroCredit,
          code: `${prefix}-zero-credit`,
          name: 'Zero credit record',
          credits: 0,
          category: 'GENERAL_EDUCATION',
          difficultyLevel: 2,
          semesterOffered: ['FALL'],
        },
      ],
    });
    await prisma.prerequisite.createMany({
      data: [
        { courseId: blocked, prerequisiteId: missingParent, isStrict: false, isCorequisite: true },
        // This unlock bonus makes the excluded alternative outrank the thesis if
        // filtering happens after selection or after spending its credit budget.
        { courseId: blocked, prerequisiteId: alternative, isStrict: false, isCorequisite: false },
      ],
    });
    const excluded = [
      thesisId,
      alternative,
      springAlternative,
      earlierElective,
      blocked,
      missingParent,
    ];
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
  });

  beforeEach(async () => {
    await prisma.gradeAttempt.deleteMany({ where: { userId: { in: [owner, other, admin] } } });
    await prisma.studentRecord.deleteMany({
      where: {
        userId: { in: [owner, other, admin] },
        courseId: { in: [thesisId, alternative, springAlternative, earlierElective, blocked] },
      },
    });
    await prisma.studentRecord.updateMany({
      where: { userId: owner, courseId: historyFive },
      data: { grade: null, gradePoints: null, status: 'COMPLETED' },
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [owner, other, admin] } } });
    await prisma.course.deleteMany({ where: { id: { in: [...ids, ...createdSourceIds] } } });
    await prisma.$disconnect();
  });

  it.each([
    [70, 'ALTERNATIVE'],
    [70.004, 'THESIS'],
    [0, 'ALTERNATIVE'],
  ] as const)('selects %s using the exact score, before display rounding', async (score, path) => {
    await attempt(historyFive, score);
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.body.data.stats.gpaPath).toBe(path);
    expect(response.body.data.stats.totalAvailable).toBe(path === 'THESIS' ? 2 : 3);
    if (path === 'THESIS') {
      expect(resultIds(response)).toEqual(expect.arrayContaining([thesisId, earlierElective]));
      expect(resultIds(response)).not.toContain(alternative);
      expect(resultIds(response)).not.toContain(springAlternative);
    } else {
      expect(resultIds(response)).toEqual(
        expect.arrayContaining([alternative, springAlternative, earlierElective]),
      );
      expect(resultIds(response)).not.toContain(thesisId);
    }
  });

  it('keeps an exact weighted 70 on the alternative path', async () => {
    await attempt(historyFive, 98);
    await attempt(historyTwo, 0);
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.body.data.stats.gpaPath).toBe('ALTERNATIVE');
    expect(resultIds(response)).not.toContain(thesisId);
  });

  it('uses the true above-70 path even when the serialized weighted GPA equals 70', async () => {
    await attempt(historyFive, 98);
    await attempt(historyTwo, Number.MIN_VALUE);
    const rows = await prisma.gradeAttempt.findMany({
      where: { userId: owner },
      select: { courseId: true, score: true },
    });
    const summary = calculateGradeSummary(
      [
        { id: historyFive, code: `${prefix}-five`, credits: 5 },
        { id: historyTwo, code: `${prefix}-two`, credits: 2 },
      ],
      rows,
    );
    expect(summary.gpa100).toBe(70);
    expect(summary.gpaPath).toBe('THESIS');
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.body.data.stats.gpaPath).toBe('THESIS');
    expect(resultIds(response)).toContain(thesisId);
    expect(resultIds(response)).not.toContain(alternative);
  });

  it('uses highest retakes instead of the last score or attempt average', async () => {
    await attempt(historyFive, 40);
    await attempt(historyFive, 80);
    await attempt(historyFive, 50);
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.body.data.stats.gpaPath).toBe('THESIS');
    expect(resultIds(response)).toContain(thesisId);
  });

  it('returns null and retains both paths when no eligible numeric score exists', async () => {
    await attempt(physicalId, 100);
    await attempt(zeroCredit, 100);
    await prisma.studentRecord.update({
      where: { userId_courseId: { userId: owner, courseId: historyFive } },
      data: { grade: 'A', gradePoints: 4 },
    });
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.body.data.stats.gpaPath).toBeNull();
    expect(response.body.data.stats.totalAvailable).toBe(4);
    expect(resultIds(response)).toEqual(
      expect.arrayContaining([thesisId, alternative, springAlternative, earlierElective]),
    );
  });

  it('excludes physical training from an otherwise exact boundary GPA', async () => {
    await attempt(historyFive, 70);
    await attempt(physicalId, 100);
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.body.data.stats.gpaPath).toBe('ALTERNATIVE');
    expect(resultIds(response)).not.toContain(thesisId);
  });

  it('filters path courses before counting statistics and spending the recommendation budget', async () => {
    await attempt(historyFive, 80);
    const response = await read(owner, owner, `?maxCredits=${thesisCredits}&maxDifficulty=5`);
    expect(response.status).toBe(200);
    expect(resultIds(response)).toEqual([thesisId]);
    expect(response.body.data.stats).toMatchObject({
      gpaPath: 'THESIS',
      totalAvailable: 2,
      filteredCount: 2,
      recommendedCount: 1,
      totalRecommendedCredits: thesisCredits,
    });
  });

  it('preserves earlier Group 03 placement while applying GPA and semester filters to Y4S2', async () => {
    await attempt(historyFive, 70);
    const response = await read(owner, owner, '?semester=FALL&maxCredits=30&maxDifficulty=5');
    expect(response.status).toBe(200);
    expect(response.body.data.stats).toMatchObject({
      gpaPath: 'ALTERNATIVE',
      totalAvailable: 3,
      filteredCount: 2,
    });
    expect(resultIds(response)).toEqual(expect.arrayContaining([alternative, earlierElective]));
    expect(resultIds(response)).not.toContain(springAlternative);
    expect(resultIds(response)).not.toContain(thesisId);
  });

  it('never allows grade history or a matching path to bypass mandatory prerequisites', async () => {
    await attempt(historyFive, 70);
    await attempt(missingParent, 70);
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.body.data.stats.gpaPath).toBe('ALTERNATIVE');
    expect(resultIds(response)).not.toContain(blocked);
    expect(resultIds(response)).not.toContain(missingParent);
    expect(response.body.data.stats.totalAvailable).toBe(3);
  });

  it('excludes completed and in-progress courses after resolving the eligible path', async () => {
    await attempt(historyFive, 80);
    await prisma.studentRecord.create({
      data: { userId: owner, courseId: thesisId, status: 'COMPLETED' },
    });
    const thesis = await read();
    expect(thesis.status).toBe(200);
    expect(resultIds(thesis)).toEqual([earlierElective]);
    expect(thesis.body.data.stats.totalAvailable).toBe(1);
    await prisma.gradeAttempt.deleteMany({ where: { userId: owner } });
    await attempt(historyFive, 70);
    await prisma.studentRecord.create({
      data: { userId: owner, courseId: alternative, status: 'IN_PROGRESS' },
    });
    const otherPath = await read();
    expect(otherPath.status).toBe(200);
    expect(resultIds(otherPath)).toEqual(
      expect.arrayContaining([springAlternative, earlierElective]),
    );
    expect(resultIds(otherPath)).not.toContain(alternative);
    expect(resultIds(otherPath)).not.toContain(thesisId);
    expect(otherPath.body.data.stats.totalAvailable).toBe(2);
  });

  it('resolves the requested owner GPA for admin access and rejects other-account access', async () => {
    await attempt(historyFive, 80, owner);
    await attempt(historyFive, 60, other);
    await attempt(historyFive, 0, admin);
    const allowed = await read(owner, admin);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.stats.gpaPath).toBe('THESIS');
    expect(resultIds(allowed)).toContain(thesisId);
    const own = await read(other, other);
    expect(own.status).toBe(200);
    expect(own.body.data.stats.gpaPath).toBe('ALTERNATIVE');
    expect(resultIds(own)).not.toContain(thesisId);
    expect((await read(owner, other)).status).toBe(403);
    expect((await request(app).get(`/api/recommendations/user/${owner}`)).status).toBe(401);
  });

  it('ignores forged numeric/path query overrides in favor of recorded owner scores', async () => {
    await attempt(historyFive, 70);
    const response = await read(
      owner,
      owner,
      '?maxCredits=30&maxDifficulty=5&gpa100=100&gpaPath=THESIS',
    );
    expect(response.status).toBe(200);
    expect(response.body.data.stats.gpaPath).toBe('ALTERNATIVE');
    expect(resultIds(response)).not.toContain(thesisId);
  });
});
