import { Router, Request, Response } from 'express';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { CourseStatus } from '@prisma/client';
import { z } from 'zod';
import { CreateUserSchema, UpdateStudentRecordSchema } from '@iu-study-planner/shared';
import { prisma } from '../db';

async function findUserByIdentifier(identifier: string) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) {
    return prisma.user.findUnique({ where: { id: identifier } });
  }
  return prisma.user.findUnique({ where: { studentId: identifier } });
}

const router = Router();

// Get all users
router.get('/', async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        studentId: true,
        name: true,
        email: true,
        major: true,
        enrollmentYear: true,
        targetGraduationYear: true,
        createdAt: true,
        _count: {
          select: {
            studentRecords: true,
            studyPlans: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return res.json({
      success: true,
      data: users,
      count: users.length,
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch users',
    });
  }
});

// Get user by ID with records
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = await findUserByIdentifier(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    const fullUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        studentRecords: {
          include: {
            course: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
        studyPlans: {
          where: { isActive: true },
          include: {
            semesters: true,
          },
        },
      },
    });

    if (!fullUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Calculate statistics
    const completedCourses = fullUser.studentRecords.filter((r) => r.status === CourseStatus.COMPLETED);
    const totalCredits = completedCourses.reduce((sum, r) => sum + r.course.credits, 0);
    const gpa =
      completedCourses.length > 0
        ? completedCourses.reduce((sum, r) => sum + (r.gradePoints ?? 0), 0) /
          completedCourses.length
        : 0;

    return res.json({
      success: true,
      data: {
        ...fullUser,
        stats: {
          totalCourses: fullUser.studentRecords.length,
          completedCourses: completedCourses.length,
          totalCredits,
          gpa: Math.round(gpa * 100) / 100,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch user',
    });
  }
});

// Create new user
router.post('/', async (req: Request, res: Response) => {
  try {
    const validatedData = CreateUserSchema.parse(req.body);

    const user = await prisma.user.create({
      data: validatedData,
    });

    return res.status(201).json({
      success: true,
      data: user,
      message: 'User created successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    console.error('Error creating user:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create user',
    });
  }
});

// Get user's student records
router.get('/:id/records', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const user = await findUserByIdentifier(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    const records = await prisma.studentRecord.findMany({
      where: { userId: user.id },
      include: {
        course: {
          include: {
            prerequisites: {
              include: {
                prerequisite: {
                  select: { id: true, code: true, name: true },
                },
              },
            },
            isPrerequisiteFor: {
              include: {
                course: {
                  select: { id: true, code: true, name: true },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return res.json({
      success: true,
      data: records,
      count: records.length,
    });
  } catch (error) {
    console.error('Error fetching student records:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch student records',
    });
  }
});

// Add or update student record
router.post('/:id/records', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const validatedData = UpdateStudentRecordSchema.parse(req.body);

    // Check if user exists
    const user = await findUserByIdentifier(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Check if course exists
    const course = await prisma.course.findUnique({ where: { id: validatedData.courseId } });
    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    const record = await prisma.studentRecord.upsert({
      where: {
        userId_courseId: {
          userId: user.id,
          courseId: validatedData.courseId,
        },
      },
      update: validatedData,
      create: {
        userId: user.id,
        ...validatedData,
      },
      include: {
        course: true,
      },
    });

    return res.json({
      success: true,
      data: record,
      message: 'Student record updated successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    console.error('Error updating student record:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update student record',
    });
  }
});

// Toggle course completion status
router.post('/:id/records/toggle', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const { courseId, status } = z.object({
      courseId: z.string().uuid(),
      status: z.enum(['COMPLETED', 'PLANNED', 'IN_PROGRESS', 'FAILED', 'DROPPED']),
    }).parse(req.body);

    const user = await findUserByIdentifier(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    if (status === 'PLANNED') {
      await prisma.studentRecord.delete({
        where: {
          userId_courseId: {
            userId: user.id,
            courseId,
          },
        },
      });

      return res.json({
        success: true,
        data: {
          id: '',
          userId: user.id,
          courseId,
          grade: null,
          gradePoints: null,
          semester: null,
          year: null,
          status: 'PLANNED' as const,
          course,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        message: 'Course marked as not completed',
      });
    }

    const record = await prisma.studentRecord.upsert({
      where: {
        userId_courseId: {
          userId: user.id,
          courseId,
        },
      },
      update: { status },
      create: {
        userId: user.id,
        courseId,
        status,
      },
      include: {
        course: true,
      },
    });

    return res.json({
      success: true,
      data: record,
      message: `Course marked as ${status.toLowerCase()}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
      const course = await prisma.course.findUnique({ where: { id: req.body.courseId } });
      const user = await findUserByIdentifier(id);
      return res.json({
        success: true,
        data: {
          id: '',
          userId: user?.id ?? id,
          courseId: req.body.courseId,
          grade: null,
          gradePoints: null,
          semester: null,
          year: null,
          status: 'PLANNED' as const,
          course: course ?? { id: req.body.courseId, code: '', name: '', credits: 0, difficultyLevel: 1, category: 'REQUIRED', semesterOffered: ['FALL', 'SPRING'], prerequisites: [], isPrerequisiteFor: [], createdAt: new Date(), updatedAt: new Date() },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        message: 'Course was already not completed',
      });
    }
    console.error('Error toggling course completion:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to toggle course completion',
    });
  }
});

// Get user's progress summary
router.get('/:id/progress', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const user = await findUserByIdentifier(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    const records = await prisma.studentRecord.findMany({
      where: { userId: user.id },
      include: {
        course: {
          include: {
            prerequisites: {
              include: {
                prerequisite: true,
              },
            },
          },
        },
      },
    });

    const allCourses = await prisma.course.findMany({
      include: {
        prerequisites: true,
      },
    });

    // Categorize courses
    const completedCourseIds = new Set(
      records.filter((r) => r.status === CourseStatus.COMPLETED).map((r) => r.courseId),
    );

    const inProgressCourseIds = new Set(
      records.filter((r) => r.status === CourseStatus.IN_PROGRESS).map((r) => r.courseId),
    );

    const availableCourses = allCourses.filter((course) => {
      if (completedCourseIds.has(course.id) || inProgressCourseIds.has(course.id)) {
        return false;
      }
      // Check if all prerequisites are completed
      return course.prerequisites.every((prereq) => completedCourseIds.has(prereq.prerequisiteId));
    });

    const totalCredits = allCourses.reduce((sum, c) => sum + c.credits, 0);
    const completedCredits = records
      .filter((r) => r.status === CourseStatus.COMPLETED)
      .reduce((sum, r) => sum + r.course.credits, 0);
    const percentage = totalCredits > 0 ? Math.round((completedCredits / totalCredits) * 100) : 0;

    return res.json({
      success: true,
      data: {
        completed: records.filter((r) => r.status === CourseStatus.COMPLETED),
        inProgress: records.filter((r) => r.status === CourseStatus.IN_PROGRESS),
        planned: records.filter((r) => r.status === CourseStatus.PLANNED),
        available: availableCourses,
        progress: {
          totalCourses: allCourses.length,
          completedCourses: completedCourseIds.size,
          totalCredits,
          completedCredits,
          percentage,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching progress:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch progress',
    });
  }
});

export default router;
