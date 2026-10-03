import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { CourseStatus, Semester, Prisma } from '@prisma/client';
import {
  AnalyzeWorkloadSchema,
  PlanSemesterSchema,
  type RecommendationStatsDTO,
} from '@iu-study-planner/shared';
import WorkloadBalancer from '../services/workloadBalancer';
import SemesterPlanner from '../services/semesterPlanner';
import { readCurriculumSemesterPreview } from '../services/curriculumSemesterPreview';
import { StudentRecordError } from '../services/studentRecordError';
import { prisma } from '../db';
import { optionalAuth, requireUserIdAccess } from '../middleware/auth';
import { decorateCourseDifficulties } from '../services/courseRatings';
import { buildNumericGradeHistory } from '../services/numericGradeFit';
import { calculateGradeSummary } from '../services/gradeSummary';
import { isCourseInGpaPath } from '../services/gpaPath';
import { readAccountWorkload, WorkloadContextError } from '../services/workloadContext';
import { readCurriculumSnapshot } from '../services/curriculumContexts';
import {
  recommendCurriculumCourses,
  RecommendationContextError,
} from '../services/curriculumRecommendations';

const router = Router();
const workloadBalancer = new WorkloadBalancer();
const semesterPlanner = new SemesterPlanner();

// Get course recommendations for a user
router.get('/user/:userId', requireUserIdAccess, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { semester, maxCredits, maxDifficulty } = z
      .object({
        semester: z.nativeEnum(Semester).optional(),
        maxCredits: z.coerce.number().int().min(1).max(30).default(18),
        maxDifficulty: z.coerce.number().min(1).max(5).default(3.5),
      })
      .parse(req.query);

    const snapshot = await prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { curriculumId: true },
        });
        if (!user) throw new RecommendationContextError('User not found');
        const userRecords = await tx.studentRecord.findMany({ where: { userId } });
        const attempts = await tx.gradeAttempt.findMany({
          where: { userId },
          select: { courseId: true, score: true },
        });
        if (user.curriculumId) {
          const context = await readCurriculumSnapshot(tx, user.curriculumId);
          if (!context) throw new RecommendationContextError('Curriculum not found');
          return {
            kind: 'CURRICULUM' as const,
            data: recommendCurriculumCourses(context, userRecords, attempts, {
              semester,
              maxCredits,
              maxDifficulty,
            }),
          };
        }
        const rows = await tx.course.findMany({
          include: { prerequisites: { include: { prerequisite: true } }, isPrerequisiteFor: true },
        });
        const allCourses = await decorateCourseDifficulties(tx, rows);
        return {
          kind: 'LEGACY' as const,
          userRecords,
          allCourses,
          numericHistory: buildNumericGradeHistory(allCourses, attempts),
          gpaPath: calculateGradeSummary(allCourses, attempts).gpaPath,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (snapshot.kind === 'CURRICULUM') return res.json({ success: true, data: snapshot.data });
    const { userRecords, allCourses, numericHistory, gpaPath } = snapshot;
    const completedCourseIds = new Set(
      userRecords.filter((r) => r.status === CourseStatus.COMPLETED).map((r) => r.courseId),
    );
    const inProgressCourseIds = new Set(
      userRecords.filter((r) => r.status === CourseStatus.IN_PROGRESS).map((r) => r.courseId),
    );

    // Filter available courses (prerequisites met and not already taken)
    const availableCourses = allCourses.filter((course) => {
      if (!isCourseInGpaPath(course, gpaPath)) return false;
      // Skip if already completed or in progress
      if (completedCourseIds.has(course.id) || inProgressCourseIds.has(course.id)) {
        return false;
      }

      // Check if all prerequisites are completed
      return course.prerequisites.every((prereq) => completedCourseIds.has(prereq.prerequisiteId));
    });

    // Apply semester filter if provided
    let filteredCourses = availableCourses;
    if (semester) {
      filteredCourses = availableCourses.filter((c) => c.semesterOffered.includes(semester));
    }

    // Calculate recommendations with workload balancing
    const recommendations = workloadBalancer.calculateRecommendations({
      availableCourses: filteredCourses,
      maxCredits,
      maxDifficulty,
      numericHistory,
    });

    return res.json({
      success: true,
      data: {
        courses: recommendations,
        stats: {
          gpaPath,
          totalAvailable: availableCourses.length,
          filteredCount: filteredCourses.length,
          recommendedCount: recommendations.length,
          totalRecommendedCredits: recommendations.reduce((sum, c) => sum + c.credits, 0),
          averageDifficulty:
            recommendations.length > 0
              ? recommendations.reduce((sum, c) => sum + c.ratingDifficulty, 0) /
                recommendations.length
              : 0,
        } satisfies RecommendationStatsDTO,
      },
    });
  } catch (error) {
    if (error instanceof RecommendationContextError)
      return res.status(error.status).json({ success: false, error: error.message });
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({ success: false, error: 'Validation error', details: error.errors });
    console.error('Error generating recommendations:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate recommendations',
    });
  }
});

// Analyze workload balance for a potential semester
router.post('/analyze-workload', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { courseIds } = AnalyzeWorkloadSchema.parse(req.body);

    const { courses, scope } = await readAccountWorkload(req.userId, courseIds);

    const analysis = workloadBalancer.analyzeSemesterWorkload(courses, scope);

    return res.json({
      success: true,
      data: { ...analysis, scope },
    });
  } catch (error) {
    if (error instanceof WorkloadContextError)
      return res.status(error.status).json({ success: false, error: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    console.error('Error analyzing workload:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to analyze workload',
    });
  }
});

// Get prerequisite chain visualization data
router.get('/prerequisite-chain/:courseId', async (req: Request, res: Response) => {
  try {
    const { courseId } = req.params;

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        prerequisites: {
          include: {
            prerequisite: {
              include: {
                prerequisites: {
                  include: {
                    prerequisite: true,
                  },
                },
              },
            },
          },
        },
        isPrerequisiteFor: {
          include: {
            course: {
              include: {
                isPrerequisiteFor: {
                  include: {
                    course: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    type FilteredPrereqNode = {
      id: string;
      code: string;
      name: string;
      credits: number;
      difficultyLevel: number;
      prerequisites?: FilteredPrereqNode[];
      dependents?: FilteredPrereqNode[];
    };
    type RawCourseNode = {
      id: string;
      code: string;
      name: string;
      credits: number;
      difficultyLevel: number;
      prerequisites?: { prerequisite: unknown }[];
      isPrerequisiteFor?: { course: unknown }[];
    }; // Fixed any use

    // Build prerequisite chain
    const buildPrereqChain = (
      c: RawCourseNode,
      depth = 0,
      visited = new Set<string>(),
    ): FilteredPrereqNode | null => {
      if (depth > 5 || visited.has(c.id)) return null;
      visited.add(c.id);

      return {
        id: c.id,
        code: c.code,
        name: c.name,
        credits: c.credits,
        difficultyLevel: c.difficultyLevel,
        prerequisites:
          c.prerequisites
            ?.map((p: { prerequisite: unknown }) =>
              buildPrereqChain(p.prerequisite as RawCourseNode, depth + 1, new Set(visited)),
            )
            .filter((p): p is FilteredPrereqNode => p !== null) || [],
      };
    };

    const buildDependentChain = (
      c: RawCourseNode,
      depth = 0,
      visited = new Set<string>(),
    ): FilteredPrereqNode | null => {
      if (depth > 5 || visited.has(c.id)) return null;
      visited.add(c.id);

      return {
        id: c.id,
        code: c.code,
        name: c.name,
        credits: c.credits,
        difficultyLevel: c.difficultyLevel,
        dependents:
          c.isPrerequisiteFor
            ?.map((p: { course: unknown }) =>
              buildDependentChain(p.course as RawCourseNode, depth + 1, new Set(visited)),
            )
            .filter((p): p is FilteredPrereqNode => p !== null) || [],
      };
    };

    return res.json({
      success: true,
      data: {
        course: {
          id: course.id,
          code: course.code,
          name: course.name,
          credits: course.credits,
          difficultyLevel: course.difficultyLevel,
        },
        prerequisiteChain: buildPrereqChain(course),
        dependentChain: buildDependentChain(course),
      },
    });
  } catch (error) {
    console.error('Error fetching prerequisite chain:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch prerequisite chain',
    });
  }
});

// Plan semester based on intensity and completed courses
router.post('/plan-semester', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { intensityMode, completedCourseIds } = PlanSemesterSchema.parse(req.body);
    const input = await readCurriculumSemesterPreview(req.userId, intensityMode);
    if (input.kind === 'CONTEXT') return res.json({ success: true, data: input.data });
    const completedSet = new Set(completedCourseIds ?? []);
    const allCourses = input.courses;
    const plan = semesterPlanner.plan(allCourses, completedSet, intensityMode);

    const courseById = new Map(allCourses.map((c) => [c.id, c]));
    const nextRecommendedCourses = plan.nextRecommendedIds
      .map((id) => courseById.get(id))
      .filter((course): course is (typeof allCourses)[number] => course !== undefined);

    return res.json({
      success: true,
      data: {
        nextRecommendedIds: plan.nextRecommendedIds,
        nextRecommendedCourses,
        semesters: plan.semesters,
        stats: plan.stats,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    if (error instanceof StudentRecordError) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    console.error('Error planning semester:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to plan semester',
    });
  }
});

export default router;
