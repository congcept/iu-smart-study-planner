import { Prisma } from '@prisma/client';
import type {
  CurriculumDetailDTO,
  CurriculumPriorSource,
  CurriculumSummaryDTO,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import { estimateDifficulty } from './bayesianDifficulty';

const metadataSelect = {
  id: true,
  code: true,
  name: true,
  school: true,
  degree: true,
  programUrl: true,
  totalCredits: true,
  isGpaPath: true,
  sourceLabel: true,
  sourceUrl: true,
} as const;

export async function listCurriculumContexts(): Promise<CurriculumSummaryDTO[]> {
  const rows = await prisma.curriculum.findMany({
    select: metadataSelect,
    orderBy: { code: 'asc' },
  });
  return rows.map((row) => ({ ...row, usage: 'REFERENCE_ONLY' }));
}

/** Mean of votes on unique member courses; voters and cached course averages remain global. */
export async function readContextPrior(tx: Prisma.TransactionClient, curriculumId: string) {
  const memberCourseFilter = { curriculumCourses: { some: { curriculumId } } };
  const ratings = await tx.courseRating.aggregate({
    where: { course: memberCourseFilter },
    _avg: { rating: true },
  });
  if (ratings._avg.rating !== null) {
    return { mean: ratings._avg.rating, source: 'CURRICULUM_RATINGS' as CurriculumPriorSource };
  }
  const seed = await tx.course.aggregate({
    where: memberCourseFilter,
    _avg: { difficultyLevel: true },
  });
  if (seed._avg.difficultyLevel === null) throw new Error('Nonempty curriculum has no seed prior');
  return { mean: seed._avg.difficultyLevel, source: 'CURRICULUM_SEED' as CurriculumPriorSource };
}

/** Caller must use a consistent transaction; no legacy global edge/placement fallback. */
export async function readCurriculumSnapshot(
  tx: Prisma.TransactionClient,
  curriculumId: string,
): Promise<CurriculumDetailDTO | null> {
  const context = await tx.curriculum.findUnique({
    where: { id: curriculumId },
    select: {
      ...metadataSelect,
      courses: {
        orderBy: { course: { code: 'asc' } },
        select: {
          course: {
            select: {
              id: true,
              code: true,
              name: true,
              credits: true,
              difficultyLevel: true,
              description: true,
              semesterOffered: true,
              avgRating: true,
              ratingCount: true,
            },
          },
          placements: {
            orderBy: { sourceOrder: 'asc' },
            select: {
              id: true,
              academicYear: true,
              academicSemester: true,
              electiveGroup: true,
              electiveSelectCount: true,
              sourceOrder: true,
              sourceLabel: true,
            },
          },
          prerequisites: {
            orderBy: { prerequisite: { course: { code: 'asc' } } },
            select: {
              id: true,
              courseId: true,
              prerequisiteId: true,
              isStrict: true,
              isCorequisite: true,
            },
          },
        },
      },
      requirements: {
        orderBy: { sourceOrder: 'asc' },
        select: {
          id: true,
          kind: true,
          name: true,
          credits: true,
          academicYear: true,
          academicSemester: true,
          sourceOrder: true,
          sourceLabel: true,
        },
      },
    },
  });
  if (!context) return null;
  const { courses, ...metadata } = context;
  const prior = courses.length ? await readContextPrior(tx, curriculumId) : null;
  return {
    ...metadata,
    usage: 'REFERENCE_ONLY',
    ratingPrior: prior,
    courses: courses.map(({ course, placements }) => ({
      ...course,
      placements,
      ratingDifficulty: estimateDifficulty({
        average: course.avgRating,
        count: course.ratingCount,
        priorMean: prior!.mean,
      }).score,
      ratingPriorMean: prior!.mean,
      ratingPriorSource: prior!.source,
    })),
    prerequisites: courses.flatMap(({ prerequisites }) =>
      prerequisites.map((edge) => ({ ...edge, mandatory: true as const })),
    ),
  };
}

export function readCurriculumContext(curriculumId: string): Promise<CurriculumDetailDTO | null> {
  return prisma.$transaction((tx) => readCurriculumSnapshot(tx, curriculumId), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}
