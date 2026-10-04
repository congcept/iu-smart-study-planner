import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  CreateSemesterSchema,
  UpdateSemesterSchema,
  type CreateSemesterDTO,
  type AccountWriteScopeDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import { decorateCourseDifficulties } from './courseRatings';

export class PlannedSemesterError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

async function writeSnapshot<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2034') {
          if (attempt < 4) continue;
          throw new PlannedSemesterError('Plan changed concurrently; please retry', 409);
        }
        if (error.code === 'P2002')
          throw new PlannedSemesterError('This plan already has that semester and year', 409);
      }
      throw error;
    }
  }
  throw new PlannedSemesterError('Plan changed concurrently; please retry', 409);
}

async function authorizePlan(tx: Prisma.TransactionClient, planId: string, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (!actor) throw new PlannedSemesterError('Authentication required', 401);
  const plan = await tx.studyPlan.findUnique({
    where: { id: planId },
    select: {
      userId: true,
      user: { select: { curriculumId: true } },
    },
  });
  if (!plan) throw new PlannedSemesterError('Study plan not found', 404);
  if (actor.role !== 'ADMIN' && plan.userId !== actorId)
    throw new PlannedSemesterError('Access forbidden', 403);
  return plan;
}

async function calculateTotals(
  tx: Prisma.TransactionClient,
  entries: CreateSemesterDTO['courses'],
  curriculumId: string | null,
) {
  const courseIds = entries.map(({ courseId }) => courseId);
  const rows = await tx.course.findMany({
    where: { id: { in: courseIds } },
    select: {
      id: true,
      credits: true,
      avgRating: true,
      ratingCount: true,
    },
  });
  const knownIds = new Set(rows.map(({ id }) => id));
  const missing = entries.flatMap(({ courseId }, index) =>
    knownIds.has(courseId)
      ? []
      : [
          {
            code: z.ZodIssueCode.custom,
            path: ['courses', index, 'courseId'],
            message: 'Course not found',
          },
        ],
  );
  if (missing.length) throw new z.ZodError(missing);
  if (curriculumId) {
    const members = await tx.curriculumCourse.findMany({
      where: {
        curriculumId,
        courseId: { in: courseIds },
        placements: { some: {} },
      },
      select: { courseId: true },
    });
    const memberIds = new Set(members.map(({ courseId }) => courseId));
    if (entries.some(({ courseId }) => !memberIds.has(courseId))) {
      throw new PlannedSemesterError(
        'One or more courses are not placed in the plan owner’s curriculum',
        409,
      );
    }
  }
  const courses = await decorateCourseDifficulties(tx, rows, curriculumId ?? undefined);
  return {
    totalCredits: courses.reduce((sum, course) => sum + course.credits, 0),
    difficultyScore:
      courses.reduce((sum, course) => sum + course.ratingDifficulty, 0) / (courses.length || 1),
  };
}

function assertExpectedScope(
  expected: AccountWriteScopeDTO | undefined,
  plan: { userId: string; user: { curriculumId: string | null } },
) {
  if (
    expected &&
    (expected.userId !== plan.userId || expected.curriculumId !== plan.user.curriculumId)
  )
    throw new PlannedSemesterError('Plan owner context changed; reload before saving', 409);
}

/** Owner context, membership, prior, authorization and save share one serializable snapshot. */
export async function createPlannedSemester(
  planId: string,
  actorId: string,
  data: CreateSemesterDTO,
) {
  const { expectedScope, ...fields } = CreateSemesterSchema.parse(data);
  return writeSnapshot(async (tx) => {
    const plan = await authorizePlan(tx, planId, actorId);
    assertExpectedScope(expectedScope, plan);
    const totals = await calculateTotals(tx, fields.courses, plan.user.curriculumId);
    return tx.plannedSemester.create({ data: { studyPlanId: planId, ...fields, ...totals } });
  });
}

export async function updatePlannedSemester(
  planId: string,
  semesterId: string,
  actorId: string,
  data: Partial<CreateSemesterDTO>,
) {
  const { expectedScope, ...fields } = UpdateSemesterSchema.parse(data);
  return writeSnapshot(async (tx) => {
    const plan = await authorizePlan(tx, planId, actorId);
    const semester = await tx.plannedSemester.findFirst({
      where: { id: semesterId, studyPlanId: planId },
      select: { id: true },
    });
    if (!semester) throw new PlannedSemesterError('Semester not found', 404);
    assertExpectedScope(expectedScope, plan);
    const totals = fields.courses
      ? await calculateTotals(tx, fields.courses, plan.user.curriculumId)
      : {};
    return tx.plannedSemester.update({
      where: { id: semester.id },
      data: { ...fields, ...totals },
    });
  });
}
