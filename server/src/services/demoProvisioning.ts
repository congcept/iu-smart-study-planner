import { createHash } from 'node:crypto';
import { CourseStatus, Prisma, Semester } from '@prisma/client';
import config from '../config';
import { prisma } from '../db';
import { AUTH_USER_SELECT } from './authService';
import { DEMO_ACCOUNTS } from './demoAuthService';

export class DemoProvisioningError extends Error {}

/**
 * The demonstration scenario. Every value here is a simulated assumption attached to a
 * development-only demo identity; none of it is a real transcript, a verified completion or
 * an institutional record.
 */
export interface SimulatedResult {
  code: string;
  score: number;
  semester: Semester;
  year: number;
}

export interface DemoScenario {
  planName: string;
  results: SimulatedResult[];
  rating: { code: string; value: number };
  plan: { semester: Semester; year: number; codes: string[] }[];
}

export const DEMO_SCENARIO: DemoScenario = {
  planName: 'Simulated four-year plan (reference)',
  results: [
    { code: 'MA001IU', score: 78, semester: Semester.FALL, year: 2025 },
    { code: 'IT064IU', score: 85, semester: Semester.FALL, year: 2025 },
    { code: 'EN007IU', score: 72, semester: Semester.FALL, year: 2025 },
    { code: 'IT116IU', score: 81, semester: Semester.FALL, year: 2025 },
    { code: 'IT069IU', score: 64, semester: Semester.SPRING, year: 2026 },
    { code: 'IT153IU', score: 75, semester: Semester.SPRING, year: 2026 },
    { code: 'EN011IU', score: 70, semester: Semester.SPRING, year: 2026 },
    { code: 'IT091IU', score: 88, semester: Semester.SPRING, year: 2026 },
    // A retake: the higher score is the one the cumulative average uses.
    { code: 'IT069IU', score: 82, semester: Semester.SUMMER, year: 2026 },
    { code: 'MA003IU', score: 67, semester: Semester.FALL, year: 2026 },
    { code: 'IT013IU', score: 79, semester: Semester.FALL, year: 2026 },
  ],
  rating: { code: 'IT069IU', value: 4 },
  plan: [
    {
      semester: Semester.SPRING,
      year: 2027,
      codes: ['IT079IU', 'IT092IU', 'MA026IU', 'PE017IU'],
    },
    {
      semester: Semester.FALL,
      year: 2027,
      codes: ['IT159IU', 'IT076IU', 'PE018IU', 'PE021IU'],
    },
  ],
};

export interface DemoScenarioReport {
  mode: 'CHECK' | 'APPLIED';
  account: { id: string; studentId: string; email: string };
  simulated: true;
  notice: string;
  missingCourses: string[];
  records: { expected: number; present: number; created: number };
  attempts: { expected: number; present: number; created: number };
  rating: { expected: string; present: boolean; created: boolean };
  plan: { name: string; present: boolean; created: boolean };
  curriculumId: string | null;
}

/** Deterministic per-account attempt keys keep a rerun idempotent. */
export function simulatedAttemptKey(
  userId: string,
  { code, semester, year }: SimulatedResult,
): string {
  const hex = createHash('sha256').update(`${userId}:${code}:${semester}:${year}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

const NOTICE =
  'Simulated demonstration data for a development-only demo identity. Nothing here is a real transcript, a verified completion, an institutional record or a curriculum assignment.';

async function resolveCourses(scenario: DemoScenario) {
  const codes = [...new Set(scenario.results.map((result) => result.code))];
  const rows = await prisma.course.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true, credits: true },
  });
  const byCode = new Map(rows.map((row) => [row.code, row]));
  return {
    byCode,
    missing: codes.filter((code) => !byCode.has(code)),
  };
}

async function ensureAccount() {
  const profile = DEMO_ACCOUNTS.STUDENT;
  const user = await prisma.user.upsert({
    where: { id: profile.id },
    create: profile,
    update: {},
    select: AUTH_USER_SELECT,
  });
  if (
    user.role !== profile.role ||
    user.email !== profile.email ||
    user.studentId !== profile.studentId
  ) {
    throw new DemoProvisioningError(
      'The demo account identity does not match its configured profile; refusing to write',
    );
  }
  return user;
}

/** Read-only inspection: reports what the scenario would need without writing anything. */
export async function readDemoScenario(
  scenario: DemoScenario = DEMO_SCENARIO,
): Promise<DemoScenarioReport> {
  const account = await ensureReadableAccount();
  const { missing } = await resolveCourses(scenario);
  const codes = [...new Set(scenario.results.map((result) => result.code))];
  const records = await prisma.studentRecord.count({
    where: { userId: account.id, course: { code: { in: codes } } },
  });
  const attemptKeys = scenario.results.map((result) => simulatedAttemptKey(account.id, result));
  const attempts = await prisma.gradeAttempt.count({
    where: { userId: account.id, requestId: { in: attemptKeys } },
  });
  const ratingCode = scenario.rating.code;
  const rating = await prisma.courseRating.count({
    where: { userId: account.id, course: { code: ratingCode } },
  });
  const plan = await prisma.studyPlan.count({
    where: { userId: account.id, name: scenario.planName },
  });
  return {
    mode: 'CHECK',
    account: { id: account.id, studentId: account.studentId, email: account.email },
    simulated: true,
    notice: NOTICE,
    missingCourses: missing,
    records: { expected: codes.length, present: records, created: 0 },
    attempts: { expected: attemptKeys.length, present: attempts, created: 0 },
    rating: { expected: ratingCode, present: rating > 0, created: false },
    plan: { name: scenario.planName, present: plan > 0, created: false },
    curriculumId: account.curriculumId,
  };
}

async function ensureReadableAccount() {
  const profile = DEMO_ACCOUNTS.STUDENT;
  const user = await prisma.user.findUnique({
    where: { id: profile.id },
    select: AUTH_USER_SELECT,
  });
  if (user) {
    if (user.studentId !== profile.studentId || user.email !== profile.email) {
      throw new DemoProvisioningError(
        'The demo account identity does not match its configured profile',
      );
    }
    return user;
  }
  throw new DemoProvisioningError(
    'The demo student account does not exist yet. Sign in once with the development demo student, or apply the scenario.',
  );
}

/**
 * Writes the scenario for the demo identity only. Never assigns a curriculum: that is the
 * administrator control's job, and the demonstration is supposed to exercise it.
 */
export async function applyDemoScenario(
  scenario: DemoScenario = DEMO_SCENARIO,
): Promise<DemoScenarioReport> {
  if (config.nodeEnv === 'production') {
    throw new DemoProvisioningError('The demonstration scenario never runs in production');
  }
  if (scenario.results.some(({ score }) => !Number.isFinite(score) || score < 0 || score > 100)) {
    throw new DemoProvisioningError('Simulated scores must be between 0 and 100');
  }
  const account = await ensureAccount();
  const { byCode, missing } = await resolveCourses(scenario);
  if (missing.length) {
    throw new DemoProvisioningError(
      `The catalogue is missing required course codes: ${missing.join(', ')}`,
    );
  }

  let createdRecords = 0;
  let createdAttempts = 0;

  for (const result of scenario.results) {
    const course = byCode.get(result.code)!;
    const existing = await prisma.studentRecord.findUnique({
      where: { userId_courseId: { userId: account.id, courseId: course.id } },
      select: { id: true },
    });
    if (!existing) {
      await prisma.studentRecord.create({
        data: {
          userId: account.id,
          courseId: course.id,
          status: CourseStatus.COMPLETED,
          semester: result.semester,
          year: result.year,
        },
      });
      createdRecords += 1;
    }
    const requestId = simulatedAttemptKey(account.id, result);
    const attempt = await prisma.gradeAttempt.findUnique({
      where: { userId_requestId: { userId: account.id, requestId } },
      select: { id: true },
    });
    if (!attempt) {
      await prisma.gradeAttempt.create({
        data: {
          userId: account.id,
          courseId: course.id,
          requestId,
          score: result.score,
          semester: result.semester,
          year: result.year,
        },
      });
      createdAttempts += 1;
    }
  }

  const ratingCourse = byCode.get(scenario.rating.code);
  if (!ratingCourse) {
    throw new DemoProvisioningError(
      `The catalogue is missing the rated course: ${scenario.rating.code}`,
    );
  }
  let createdRating = false;
  const existingRating = await prisma.courseRating.findUnique({
    where: { userId_courseId: { userId: account.id, courseId: ratingCourse.id } },
    select: { id: true },
  });
  if (!existingRating) {
    const aggregate = await prisma.courseRating.aggregate({
      where: { courseId: ratingCourse.id },
      _avg: { rating: true },
      _count: { rating: true },
    });
    const count = aggregate._count.rating + 1;
    const average =
      ((aggregate._avg.rating ?? 0) * aggregate._count.rating + scenario.rating.value) / count;
    await prisma.$transaction([
      prisma.courseRating.create({
        data: { userId: account.id, courseId: ratingCourse.id, rating: scenario.rating.value },
      }),
      prisma.course.update({
        where: { id: ratingCourse.id },
        data: { avgRating: average, ratingCount: count },
      }),
    ]);
    createdRating = true;
  }

  let createdPlan = false;
  const existingPlan = await prisma.studyPlan.findFirst({
    where: { userId: account.id, name: scenario.planName },
    select: { id: true },
  });
  if (!existingPlan) {
    const planCodes = [...new Set(scenario.plan.flatMap(({ codes }) => codes))];
    const planCourses = await prisma.course.findMany({
      where: { code: { in: planCodes } },
      select: { id: true, code: true, credits: true },
    });
    const planByCode = new Map(planCourses.map((row) => [row.code, row]));
    const missingPlanCodes = planCodes.filter((code) => !planByCode.has(code));
    if (missingPlanCodes.length) {
      throw new DemoProvisioningError(
        `The catalogue is missing planned course codes: ${missingPlanCodes.join(', ')}`,
      );
    }
    const semesterData = scenario.plan.map(({ semester, year, codes }) => {
      const rows = codes.map((code) => planByCode.get(code)!);
      return {
        semester,
        year,
        courses: rows.map((row, position) => ({
          courseId: row.id,
          position,
        })) as Prisma.InputJsonValue,
        totalCredits: rows.reduce((total, row) => total + row.credits, 0),
      };
    });
    await prisma.studyPlan.create({
      data: {
        userId: account.id,
        name: scenario.planName,
        description: 'Simulated reference plan; not a validated degree plan.',
        semesters: { create: semesterData },
      },
    });
    createdPlan = true;
  }

  const report = await readDemoScenario(scenario);
  return {
    ...report,
    mode: 'APPLIED',
    records: { ...report.records, created: createdRecords },
    attempts: { ...report.attempts, created: createdAttempts },
    rating: { ...report.rating, created: createdRating },
    plan: { ...report.plan, created: createdPlan },
  };
}
