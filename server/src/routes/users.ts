import { Router, Request, Response } from 'express';
import { PrismaClient, CourseStatus } from '@prisma/client';
import { z } from 'zod';

const router = Router();
const prisma = new PrismaClient();

// Validation schemas
const createUserSchema = z.object({
  studentId: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  major: z.string().optional(),
  enrollmentYear: z.number().int().min(2000).max(2100).optional(),
  targetGraduationYear: z.number().int().min(2000).max(2100).optional(),
});

const updateStudentRecordSchema = z.object({
  courseId: z.string().uuid(),
  grade: z.string().optional(),
  gradePoints: z.number().min(0).max(4).optional(),
  semester: z.string().optional(),
  year: z.number().int().optional(),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'DROPPED']),
});

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

    res.json({
      success: true,
      data: users,
      count: users.length,
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users',
    });
  }
});

// Get user by ID with records
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id },
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

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Calculate statistics
    const completedCourses = user.studentRecords.filter(r => r.status === CourseStatus.COMPLETED);
    const totalCredits = completedCourses.reduce((sum, r) => sum + r.course.credits, 0);
    const gpa = completedCourses.length > 0
      ? completedCourses.reduce((sum, r) => sum + (r.gradePoints || 0), 0) / completedCourses.length
      : 0;

    res.json({
      success: true,
      data: {
        ...user,
        stats: {
          totalCourses: user.studentRecords.length,
          completedCourses: completedCourses.length,
          totalCredits,
          gpa: Math.round(gpa * 100) / 100,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user',
    });
  }
});

// Create new user
router.post('/', async (req: Request, res: Response) => {
  try {
    const validatedData = createUserSchema.parse(req.body);

    const user = await prisma.user.create({
      data: {
        ...validatedData,
        password: null,
      },
    });

    res.status(201).json({
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
    res.status(500).json({
      success: false,
      error: 'Failed to create user',
    });
  }
});

// Add or update student record
router.post('/:id/records', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const validatedData = updateStudentRecordSchema.parse(req.body);

    // Check if user exists
    const user = await prisma.user.findUnique({ where: { id } });
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
          userId: id,
          courseId: validatedData.courseId,
        },
      },
      update: validatedData,
      create: {
        userId: id,
        ...validatedData,
      },
      include: {
        course: true,
      },
    });

    res.json({
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
    res.status(500).json({
      success: false,
      error: 'Failed to update student record',
    });
  }
});

// Get user's progress summary
router.get('/:id/progress', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const records = await prisma.studentRecord.findMany({
      where: { userId: id },
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

    const allCourses = await prisma.course.findMany();

    // Categorize courses
    const completedCourseIds = new Set(
      records.filter(r => r.status === CourseStatus.COMPLETED).map(r => r.courseId)
    );

    const inProgressCourseIds = new Set(
      records.filter(r => r.status === CourseStatus.IN_PROGRESS).map(r => r.courseId)
    );

    const availableCourses = allCourses.filter(course => {
      if (completedCourseIds.has(course.id) || inProgressCourseIds.has(course.id)) {
        return false;
      }
      // Check if all prerequisites are completed
      return course.prerequisites.every(prereq => completedCourseIds.has(prereq.prerequisiteId));
    });

    const totalCredits = allCourses.reduce((sum, c) => sum + c.credits, 0);
    const completedCredits = records
      .filter(r => r.status === CourseStatus.COMPLETED)
      .reduce((sum, r) => sum + r.course.credits, 0);

    res.json({
      success: true,
      data: {
        completed: records.filter(r => r.status === CourseStatus.COMPLETED),
        inProgress: records.filter(r => r.status === CourseStatus.IN_PROGRESS),
        planned: records.filter(r => r.status === CourseStatus.PLANNED),
        available: availableCourses,
        progress: {
          totalCourses: allCourses.length,
          completedCourses: completedCourseIds.size,
          totalCredits,
          completedCredits,
          percentage: Math.round((completedCredits / totalCredits) * 100),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching progress:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch progress',
    });
  }
});

export default router;
