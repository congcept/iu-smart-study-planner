import { Router, Request, Response } from 'express';
import { CourseStatus } from '@prisma/client';
import { z } from 'zod';
import {
  CreateUserSchema,
  CompleteCourseSchema,
  UpsertProgressSchema,
  ToggleStudentRecordSchema,
  UpdateStudentRecordSchema,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import { StudentRecordError, updateStudentRecord } from '../services/studentRecords';
import { requireAdmin, requireAuth, requireUserAccess } from '../middleware/auth';
import { PUBLIC_USER_SELECT } from '../services/authService';
import { readStudentProgress } from '../services/studentProgress';
import { importStudentProgress } from '../services/importStudentProgress';

async function findUserByIdentifier(identifier: string) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) {
    return prisma.user.findUnique({ where: { id: identifier } });
  }
  return prisma.user.findUnique({ where: { studentId: identifier } });
}

const router = Router();

// Place session-scoped routes before legacy identifier routes.
router.get('/me/progress', requireAuth, async (req, res) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    return res.json({ success: true, data: await readStudentProgress(req.userId) });
  } catch (error) {
    return handleRecordError(error, res);
  }
});

router.post('/me/progress', requireAuth, async (req, res) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const data = UpsertProgressSchema.parse(req.body);
    return res.json({ success: true, data: await importStudentProgress(req.userId, data) });
  } catch (error) {
    return handleRecordError(error, res);
  }
});

router.post('/me/complete', requireAuth, async (req, res) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const data = CompleteCourseSchema.parse(req.body);
    const result = await updateStudentRecord(req.userId, data);
    return res.json({
      success: true,
      data: { ...result.progress, uncompletedCourseIds: result.uncompletedCourseIds },
    });
  } catch (error) {
    return handleRecordError(error, res);
  }
});

// Only administrators can list student identities.
router.get('/', requireAdmin, async (_req: Request, res: Response) => {
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
router.get('/:id', requireUserAccess, async (req: Request, res: Response) => {
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
      select: {
        ...PUBLIC_USER_SELECT,
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
    const completedCourses = fullUser.studentRecords.filter(
      (r) => r.status === CourseStatus.COMPLETED,
    );
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
router.post('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const validatedData = CreateUserSchema.parse(req.body);

    const user = await prisma.user.create({
      data: validatedData,
      select: PUBLIC_USER_SELECT,
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
router.get('/:id/records', requireUserAccess, async (req: Request, res: Response) => {
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
router.post('/:id/records', requireUserAccess, async (req: Request, res: Response) => {
  try {
    const data = UpdateStudentRecordSchema.parse(req.body);
    const result = await updateStudentRecord(req.params.id, data);

    return res.json({
      success: true,
      data: result.record,
      details: { uncompletedCourseIds: result.uncompletedCourseIds },
      message: 'Student record updated successfully',
    });
  } catch (error) {
    return handleRecordError(error, res);
  }
});

// Preserve the legacy toggle's PLANNED response and idempotent removal behavior.
router.post('/:id/records/toggle', requireUserAccess, async (req: Request, res: Response) => {
  try {
    const data = ToggleStudentRecordSchema.parse(req.body);
    const result = await updateStudentRecord(req.params.id, data, true);

    return res.json({
      success: true,
      data: result.record,
      details: { uncompletedCourseIds: result.uncompletedCourseIds },
      message: `Course marked as ${data.status.toLowerCase()}`,
    });
  } catch (error) {
    return handleRecordError(error, res);
  }
});

function handleRecordError(error: unknown, res: Response) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      details: error.errors,
    });
  }
  if (error instanceof StudentRecordError) {
    return res.status(error.status).json({
      success: false,
      error: error.message,
      details: error.details,
    });
  }
  console.error('Error updating student record:', error);
  return res.status(500).json({
    success: false,
    error: 'Failed to update student record',
  });
}

// Get user's progress summary
router.get('/:id/progress', requireUserAccess, async (req: Request, res: Response) => {
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

    const NON_CREDIT_COURSE_CODES = new Set(['PT001IU', 'PT002IU']);
    const totalCredits = allCourses.reduce(
      (sum, c) => sum + (NON_CREDIT_COURSE_CODES.has(c.code) ? 0 : c.credits),
      0,
    );
    const completedCredits = records
      .filter(
        (r) => r.status === CourseStatus.COMPLETED && !NON_CREDIT_COURSE_CODES.has(r.course.code),
      )
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
