import { Prisma } from '@prisma/client';
import {
  RateCourseSchema,
  type CourseDifficultyDTO,
  type CourseRatingsDTO,
  type SubmittedCourseRatingDTO,
} from '@iu-study-planner/shared';
import config from '../config';
import { prisma } from '../db';
import { estimateDifficulty } from './bayesianDifficulty';

export class CourseRatingError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

async function readGlobalPrior(tx: Prisma.TransactionClient) {
  const global = await tx.courseRating.aggregate({ _avg: { rating: true } });
  const seed =
    global._avg.rating === null
      ? await tx.course.aggregate({ _avg: { difficultyLevel: true } })
      : null;
  const mean = global._avg.rating ?? seed?._avg.difficultyLevel;
  if (mean === null || mean === undefined) throw new Error('No global difficulty prior available');
  const source: CourseDifficultyDTO['ratingPriorSource'] =
    global._avg.rating === null ? 'GLOBAL_SEED' : 'GLOBAL_RATINGS';
  return { mean, source };
}

/** Resolve one shared prior per collection, never one query per course. */
export async function decorateCourseDifficulties<
  T extends { avgRating: number | null; ratingCount: number },
>(tx: Prisma.TransactionClient, courses: readonly T[]): Promise<(T & CourseDifficultyDTO)[]> {
  if (courses.length === 0) return [];
  const prior = await readGlobalPrior(tx);
  return courses.map((course) => ({
    ...course,
    ratingDifficulty: estimateDifficulty({
      average: course.avgRating,
      count: course.ratingCount,
      priorMean: prior.mean,
    }).score,
    ratingPriorMean: prior.mean,
    ratingPriorSource: prior.source,
  }));
}

async function summarize(
  tx: Prisma.TransactionClient,
  courseId: string,
): Promise<CourseRatingsDTO> {
  const course = await tx.course.findUnique({
    where: { id: courseId },
    select: { avgRating: true, ratingCount: true },
  });
  if (!course) throw new CourseRatingError(404, 'Course not found');
  const distribution: CourseRatingsDTO['distribution'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const groups = await tx.courseRating.groupBy({
    by: ['rating'],
    where: { courseId },
    _count: true,
  });
  for (const group of groups) distribution[group.rating as 1 | 2 | 3 | 4 | 5] = group._count;
  const prior = await readGlobalPrior(tx);
  const priorMean = prior.mean;
  const estimate = estimateDifficulty({
    average: course.avgRating,
    count: course.ratingCount,
    priorMean,
  });
  return {
    average: course.avgRating,
    count: estimate.ratingCount,
    distribution,
    difficulty: estimate.score,
    priorMean,
    priorSource: prior.source,
  };
}

export function readCourseRatings(courseId: string): Promise<CourseRatingsDTO> {
  return prisma.$transaction((tx) => summarize(tx, courseId), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

/** Completion, quota, vote, cached aggregates and returned summary commit together. */
export async function submitCourseRating(
  userId: string,
  courseId: string,
  rating: number,
): Promise<SubmittedCourseRatingDTO> {
  const value = RateCourseSchema.parse({ rating }).rating;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // This also serializes a user's quota across different courses and API instances.
          const owners = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM users WHERE id=${userId} FOR NO KEY UPDATE`;
          if (owners.length === 0) throw new CourseRatingError(401, 'Authentication required');
          const course = await tx.course.findUnique({
            where: { id: courseId },
            select: { id: true },
          });
          if (!course) throw new CourseRatingError(404, 'Course not found');
          const completion = await tx.studentRecord.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { status: true },
          });
          if (completion?.status !== 'COMPLETED')
            throw new CourseRatingError(403, 'Complete this course before rating it');
          const existing = await tx.courseRating.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { rating: true },
          });
          if (existing?.rating !== value) {
            const now = Date.now();
            const windowStart = new Date(Math.floor(now / 3600000) * 3600000);
            const quota = await tx.ratingWriteLimit.findUnique({ where: { userId } });
            const used =
              quota?.windowStart.getTime() === windowStart.getTime() ? quota.writeCount : 0;
            if (used >= config.ratingWritesPerHour) {
              throw new CourseRatingError(
                429,
                'Hourly rating limit reached. Try again in the next hour.',
                Math.ceil((windowStart.getTime() + 3600000 - now) / 1000),
              );
            }
            await tx.ratingWriteLimit.upsert({
              where: { userId },
              create: { userId, windowStart, writeCount: 1 },
              update: { windowStart, writeCount: used + 1 },
            });
            await tx.courseRating.upsert({
              where: { userId_courseId: { userId, courseId } },
              create: { userId, courseId, rating: value },
              update: { rating: value },
            });
          }
          return { ...(await summarize(tx, courseId)), yourRating: value };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') continue;
      throw error;
    }
  }
  throw new CourseRatingError(409, 'Ratings changed during this request. Please retry.');
}
