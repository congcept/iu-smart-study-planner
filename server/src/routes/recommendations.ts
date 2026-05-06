import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { CourseStatus, Semester, StudentRecord, Course, Prerequisite } from '@prisma/client';
import WorkloadBalancer from '../services/workloadBalancer';
import SemesterPlanner from '../services/semesterPlanner';
import { AnalyzeWorkloadSchema } from '@iu-study-planner/shared';
import { prisma } from '../db';

const router = Router();
const workloadBalancer = new WorkloadBalancer();
const semesterPlanner = new SemesterPlanner();

// Get course recommendations for a user
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { semester, maxCredits = '18', maxDifficulty = '3.5' } = req.query;

    // Get user's completed and in-progress courses
    const userRecords = await prisma.studentRecord.findMany({
      where: { userId },
      include: { course: true },
    });

    const userRecordsTyped = userRecords as (StudentRecord & { course: Course })[];

    const completedCourseIds = new Set(
      userRecordsTyped.filter((r) => r.status === CourseStatus.COMPLETED).map((r) => r.courseId),
    );

    const inProgressCourseIds = new Set(
      userRecordsTyped.filter((r) => r.status === CourseStatus.IN_PROGRESS).map((r) => r.courseId),
    );

    // Get all courses with prerequisites
    const allCourses = await prisma.course.findMany({
      include: {
        prerequisites: {
          include: {
            prerequisite: true,
          },
        },
      },
    });

    const allCoursesTyped = allCourses as (Course & { prerequisites: (Prerequisite & { prerequisite: Course })[] })[];

    // Filter available courses (prerequisites met and not already taken)
    const availableCourses = allCoursesTyped.filter((course) => {
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
      filteredCourses = availableCourses.filter((c) =>
        c.semesterOffered.includes(semester as Semester),
      );
    }

    // Calculate recommendations with workload balancing
    const recommendations = workloadBalancer.calculateRecommendations({
      availableCourses: filteredCourses,
      maxCredits: parseInt(maxCredits as string),
      maxDifficulty: parseFloat(maxDifficulty as string),
      userHistory: userRecordsTyped,
    });

    return res.json({
      success: true,
      data: {
        courses: recommendations,
        stats: {
          totalAvailable: availableCourses.length,
          filteredCount: filteredCourses.length,
          recommendedCount: recommendations.length,
          totalRecommendedCredits: recommendations.reduce((sum, c) => sum + c.credits, 0),
          averageDifficulty:
            recommendations.length > 0
              ? recommendations.reduce((sum, c) => sum + c.difficultyLevel, 0) /
                recommendations.length
              : 0,
        },
      },
    });
  } catch (error) {
    console.error('Error generating recommendations:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate recommendations',
    });
  }
});

// Analyze workload balance for a potential semester
router.post('/analyze-workload', async (req: Request, res: Response) => {
  try {
    const { courseIds } = AnalyzeWorkloadSchema.parse(req.body);

    const courses = await prisma.course.findMany({
      where: { id: { in: courseIds } },
    });

    const analysis = workloadBalancer.analyzeSemesterWorkload(courses);

    return res.json({
      success: true,
      data: analysis,
    });
  } catch (error) {
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
    type RawCourseNode = { id: string, code: string, name: string, credits: number, difficultyLevel: number, prerequisites?: { prerequisite: unknown }[], isPrerequisiteFor?: { course: unknown }[] }; // Fixed any use

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
            ?.map((p: { prerequisite: unknown }) => buildPrereqChain(p.prerequisite as RawCourseNode, depth + 1, new Set(visited)))
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
            ?.map((p: { course: unknown }) => buildDependentChain(p.course as RawCourseNode, depth + 1, new Set(visited)))
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
router.post('/plan-semester', async (req: Request, res: Response) => {
  try {
    const { intensityMode, completedCourseIds } = z.object({
      intensityMode: z.enum(['low', 'normal', 'high', 'max']),
      completedCourseIds: z.array(z.string()).optional(),
    }).parse(req.body);

    const completedSet = new Set(completedCourseIds ?? []);

    const allCourses = await prisma.course.findMany({
      include: {
        prerequisites: {
          include: {
            prerequisite: true,
          },
        },
        isPrerequisiteFor: {
          include: {
            course: {
              select: { id: true },
            },
          },
        },
      },
    });

    const coursesWithPrereqs = allCourses as (Course & {
      prerequisites: (Prerequisite & { prerequisite?: Course })[];
    })[];

    const plan = semesterPlanner.plan(coursesWithPrereqs, completedSet, intensityMode);

    const courseById = new Map(allCourses.map((c) => [c.id, c]));
    const nextRecommendedCourses = plan.nextRecommendedIds
      .map((id) => courseById.get(id))
      .filter(Boolean) as Course[];

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
    console.error('Error planning semester:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to plan semester',
    });
  }
});

export default router;
