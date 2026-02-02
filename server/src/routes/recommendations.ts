import { Router, Request, Response } from 'express';
import { PrismaClient, CourseStatus } from '@prisma/client';
import WorkloadBalancer from '../services/workloadBalancer';

const router = Router();
const prisma = new PrismaClient();
const workloadBalancer = new WorkloadBalancer();

// Get course recommendations for a user
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { semester, year, maxCredits = '18', maxDifficulty = '3.5' } = req.query;

    // Get user's completed and in-progress courses
    const userRecords = await prisma.studentRecord.findMany({
      where: { userId },
      include: { course: true },
    });

    const completedCourseIds = new Set(
      userRecords
        .filter(r => r.status === CourseStatus.COMPLETED)
        .map(r => r.courseId)
    );

    const inProgressCourseIds = new Set(
      userRecords
        .filter(r => r.status === CourseStatus.IN_PROGRESS)
        .map(r => r.courseId)
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

    // Filter available courses (prerequisites met and not already taken)
    const availableCourses = allCourses.filter(course => {
      // Skip if already completed or in progress
      if (completedCourseIds.has(course.id) || inProgressCourseIds.has(course.id)) {
        return false;
      }

      // Check if all prerequisites are completed
      return course.prerequisites.every(prereq => 
        completedCourseIds.has(prereq.prerequisiteId)
      );
    });

    // Apply semester filter if provided
    let filteredCourses = availableCourses;
    if (semester) {
      filteredCourses = availableCourses.filter(c => 
        c.semesterOffered.includes(semester as any)
      );
    }

    // Calculate recommendations with workload balancing
    const recommendations = workloadBalancer.calculateRecommendations({
      availableCourses: filteredCourses,
      maxCredits: parseInt(maxCredits as string),
      maxDifficulty: parseFloat(maxDifficulty as string),
      userHistory: userRecords,
    });

    res.json({
      success: true,
      data: {
        recommendations,
        stats: {
          totalAvailable: availableCourses.length,
          filteredCount: filteredCourses.length,
          recommendedCount: recommendations.length,
          totalRecommendedCredits: recommendations.reduce((sum, c) => sum + c.credits, 0),
          averageDifficulty: recommendations.length > 0
            ? recommendations.reduce((sum, c) => sum + c.difficultyLevel, 0) / recommendations.length
            : 0,
        },
      },
    });
  } catch (error) {
    console.error('Error generating recommendations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate recommendations',
    });
  }
});

// Analyze workload balance for a potential semester
router.post('/analyze-workload', async (req: Request, res: Response) => {
  try {
    const { courseIds } = req.body;

    if (!Array.isArray(courseIds) || courseIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'courseIds must be a non-empty array',
      });
    }

    const courses = await prisma.course.findMany({
      where: { id: { in: courseIds } },
    });

    const analysis = workloadBalancer.analyzeSemesterWorkload(courses);

    res.json({
      success: true,
      data: analysis,
    });
  } catch (error) {
    console.error('Error analyzing workload:', error);
    res.status(500).json({
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

    // Build prerequisite chain
    const buildPrereqChain = (c: any, depth = 0, visited = new Set()): any => {
      if (depth > 5 || visited.has(c.id)) return null;
      visited.add(c.id);

      return {
        id: c.id,
        code: c.code,
        name: c.name,
        credits: c.credits,
        difficultyLevel: c.difficultyLevel,
        prerequisites: c.prerequisites?.map((p: any) => 
          buildPrereqChain(p.prerequisite, depth + 1, new Set(visited))
        ).filter(Boolean) || [],
      };
    };

    const buildDependentChain = (c: any, depth = 0, visited = new Set()): any => {
      if (depth > 5 || visited.has(c.id)) return null;
      visited.add(c.id);

      return {
        id: c.id,
        code: c.code,
        name: c.name,
        credits: c.credits,
        difficultyLevel: c.difficultyLevel,
        dependents: c.isPrerequisiteFor?.map((p: any) => 
          buildDependentChain(p.course, depth + 1, new Set(visited))
        ).filter(Boolean) || [],
      };
    };

    res.json({
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
    res.status(500).json({
      success: false,
      error: 'Failed to fetch prerequisite chain',
    });
  }
});

export default router;
