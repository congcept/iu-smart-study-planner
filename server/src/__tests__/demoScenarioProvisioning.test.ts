import { randomUUID } from 'node:crypto';
import { CourseStatus, Semester } from '@prisma/client';
import { prisma } from '../index';
import { DEMO_ACCOUNTS } from '../services/demoAuthService';
import {
  applyDemoScenario,
  DEMO_SCENARIO,
  DemoProvisioningError,
  readDemoScenario,
  simulatedAttemptKey,
} from '../services/demoProvisioning';

const demoId = DEMO_ACCOUNTS.STUDENT.id;
const ratedCode = DEMO_SCENARIO.rating.code;

describe('simulated demonstration scenario (PostgreSQL)', () => {
  let otherUser = '';
  let courseCache: { id: string; avgRating: number | null; ratingCount: number } | null = null;

  const evidence = async () => ({
    records: await prisma.studentRecord.count({ where: { userId: demoId } }),
    attempts: await prisma.gradeAttempt.count({ where: { userId: demoId } }),
    ratings: await prisma.courseRating.count({ where: { userId: demoId } }),
    plans: await prisma.studyPlan.count({ where: { userId: demoId } }),
    user: await prisma.user.findUnique({
      where: { id: demoId },
      select: { curriculumId: true, role: true, email: true },
    }),
  });

  beforeAll(async () => {
    // Start from a clean slate so the missing-account path is deterministic.
    await prisma.user.deleteMany({ where: { id: demoId } });
    const course = await prisma.course.findUnique({
      where: { code: ratedCode },
      select: { id: true, avgRating: true, ratingCount: true },
    });
    courseCache = course;
    otherUser = randomUUID();
    await prisma.user.create({
      data: {
        id: otherUser,
        studentId: `demo-prov-${otherUser.slice(0, 8)}`,
        name: 'Untouched account',
        email: `demo-prov-${otherUser.slice(0, 8)}@example.test`,
        role: 'STUDENT',
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [demoId, otherUser] } } });
    if (courseCache) {
      // The scenario updates the cached aggregate; restore it so later suites are unaffected.
      await prisma.course.update({
        where: { id: courseCache.id },
        data: { avgRating: courseCache.avgRating, ratingCount: courseCache.ratingCount },
      });
    }
    await prisma.$disconnect();
  });

  it('refuses to inspect the scenario when the demo account does not exist yet', async () => {
    await expect(readDemoScenario()).rejects.toBeInstanceOf(DemoProvisioningError);
    expect(await prisma.user.count({ where: { id: demoId } })).toBe(0);
  });

  it('writes only simulated rows and never assigns a curriculum', async () => {
    const report = await applyDemoScenario();
    expect(report.mode).toBe('APPLIED');
    expect(report.simulated).toBe(true);
    expect(report.account.id).toBe(demoId);
    expect(report.curriculumId).toBeNull();
    expect(report.records.expected).toBe(10);
    expect(report.attempts.expected).toBe(11);
    expect(report.rating.present).toBe(true);
    expect(report.plan.present).toBe(true);
    expect(report.missingCourses).toEqual([]);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: demoId },
      select: { role: true, curriculumId: true, email: true },
    });
    expect(user).toEqual({
      role: 'STUDENT',
      curriculumId: null,
      email: DEMO_ACCOUNTS.STUDENT.email,
    });
    expect(await prisma.studentRecord.count({ where: { userId: demoId } })).toBe(10);
    expect(await prisma.gradeAttempt.count({ where: { userId: demoId } })).toBe(11);
  });

  it('keeps one attempt per simulated term, including the retake', async () => {
    const attempts = await prisma.gradeAttempt.findMany({
      where: { userId: demoId },
      select: { courseId: true, score: true, semester: true, year: true },
      orderBy: [{ year: 'asc' }, { semester: 'asc' }, { score: 'asc' }],
    });
    const it069 = await prisma.course.findUniqueOrThrow({
      where: { code: 'IT069IU' },
      select: { id: true },
    });
    const retakes = attempts.filter(({ courseId }) => courseId === it069.id);
    expect(retakes.map(({ score }) => score)).toEqual([64, 82]);
    expect(retakes.map(({ semester }) => semester)).toEqual([Semester.SPRING, Semester.SUMMER]);
    expect(new Set(attempts.map(({ courseId }) => courseId)).size).toBe(10);
  });

  it('marks every simulated result as a completed record', async () => {
    const records = await prisma.studentRecord.findMany({
      where: { userId: demoId },
      select: { status: true, electiveGroup: true },
    });
    expect(records).toHaveLength(10);
    expect(records.every(({ status }) => status === CourseStatus.COMPLETED)).toBe(true);
    expect(records.every(({ electiveGroup }) => electiveGroup === null)).toBe(true);
  });

  it('is idempotent and reports nothing new on a rerun', async () => {
    const before = await evidence();
    const report = await applyDemoScenario();
    expect(report.records.created).toBe(0);
    expect(report.attempts.created).toBe(0);
    expect(report.rating.created).toBe(false);
    expect(report.plan.created).toBe(false);
    expect(await evidence()).toEqual(before);
  });

  it('uses deterministic per-term attempt keys', () => {
    const keys = DEMO_SCENARIO.results.map((result) => simulatedAttemptKey(demoId, result));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => /^[0-9a-f-]{36}$/.test(key))).toBe(true);
    expect(simulatedAttemptKey(demoId, DEMO_SCENARIO.results[0])).toBe(keys[0]);
  });

  it('leaves another account completely untouched', async () => {
    const otherRecords = await prisma.studentRecord.count({ where: { userId: otherUser } });
    const otherAttempts = await prisma.gradeAttempt.count({ where: { userId: otherUser } });
    await applyDemoScenario();
    expect(await prisma.studentRecord.count({ where: { userId: otherUser } })).toBe(otherRecords);
    expect(await prisma.gradeAttempt.count({ where: { userId: otherUser } })).toBe(otherAttempts);
  });

  it('refuses a scenario that names a course the catalogue does not contain', async () => {
    const before = await evidence();
    await expect(
      applyDemoScenario({
        ...DEMO_SCENARIO,
        results: [
          ...DEMO_SCENARIO.results,
          { code: 'ZZ999IU', score: 80, semester: Semester.FALL, year: 2026 },
        ],
      }),
    ).rejects.toThrow(/ZZ999IU/);
    expect(await evidence()).toEqual(before);
  });

  it('refuses an out-of-range simulated score', async () => {
    await expect(
      applyDemoScenario({
        ...DEMO_SCENARIO,
        results: [{ ...DEMO_SCENARIO.results[0], score: 101 }],
      }),
    ).rejects.toThrow(/between 0 and 100/);
  });
});
