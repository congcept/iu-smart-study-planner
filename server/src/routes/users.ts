import { Router, Request, Response } from 'express';
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
import { readScopedStudentProgress, readStudentProgress } from '../services/studentProgress';
import { importStudentProgress } from '../services/importStudentProgress';
import { readStudentProgressView } from '../services/studentProgressView';
import { readStudentProfileView, readStudentRecordsView } from '../services/studentAccountViews';

const router = Router();

router.get('/me/progress/snapshot', requireAuth, async (req, res) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    z.object({}).strict().parse(req.query);
    return res.json({ success: true, data: await readScopedStudentProgress(req.userId) });
  } catch (error) {
    return handleRecordError(error, res);
  }
});

// Place session-scoped routes before legacy identifier routes.
router.get('/me/ratings', requireAuth, async (req, res) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const ratings = await prisma.courseRating.findMany({
      where: { userId: req.userId },
      select: { courseId: true, rating: true },
      orderBy: { courseId: 'asc' },
    });
    return res.json({ success: true, data: ratings });
  } catch (error) {
    return handleRecordError(error, res);
  }
});

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
    const { expectedScope, ...data } = CompleteCourseSchema.parse(req.body);
    const result = await updateStudentRecord(req.userId, data, false, expectedScope);
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

// Get user by ID with context-aware records and preserved history.
router.get('/:id', requireUserAccess, async (req: Request, res: Response) => {
  try {
    return res.json({ success: true, data: await readStudentProfileView(req.params.id) });
  } catch (error) {
    if (error instanceof StudentRecordError) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    console.error('Error fetching user:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch user' });
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

// Get active records and historical records in their own curriculum scope.
router.get('/:id/records', requireUserAccess, async (req: Request, res: Response) => {
  try {
    const data = await readStudentRecordsView(req.params.id);
    return res.json({
      success: true,
      data,
      count: Array.isArray(data) ? data.length : data.records.length,
    });
  } catch (error) {
    if (error instanceof StudentRecordError) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    console.error('Error fetching student records:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch student records' });
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
    return res.json({ success: true, data: await readStudentProgressView(req.params.id) });
  } catch (error) {
    if (error instanceof StudentRecordError) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    console.error('Error fetching progress:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch progress' });
  }
});

export default router;
