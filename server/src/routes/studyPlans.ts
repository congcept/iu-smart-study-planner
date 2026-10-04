import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { z } from 'zod';
import {
  CreateStudyPlanSchema,
  CreateSemesterSchema,
  UpdateSemesterSchema,
} from '@iu-study-planner/shared';
import { prisma } from '../db';
import { requireAuth, requireUserIdAccess } from '../middleware/auth';
import { requireStudyPlanAccess } from '../middleware/studyPlanAccess';
import {
  createPlannedSemester,
  updatePlannedSemester,
  PlannedSemesterError,
} from '../services/plannedSemesters';

function isNotFoundError(error: unknown): boolean {
  return error instanceof PrismaClientKnownRequestError && error.code === 'P2025';
}

const router = Router();

// Get all study plans for a user
router.get('/user/:userId', requireUserIdAccess, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const plans = await prisma.studyPlan.findMany({
      where: { userId },
      include: {
        semesters: {
          orderBy: [{ year: 'asc' }, { semester: 'asc' }],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return res.json({
      success: true,
      data: plans,
      count: plans.length,
    });
  } catch (error) {
    console.error('Error fetching study plans:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch study plans',
    });
  }
});

// Get study plan by ID
router.get('/:id', requireAuth, requireStudyPlanAccess, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const plan = await prisma.studyPlan.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            studentId: true,
          },
        },
        semesters: {
          orderBy: [{ year: 'asc' }, { semester: 'asc' }],
        },
      },
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        error: 'Study plan not found',
      });
    }

    return res.json({
      success: true,
      data: plan,
    });
  } catch (error) {
    console.error('Error fetching study plan:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch study plan',
    });
  }
});

// Create new study plan
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const validatedData = CreateStudyPlanSchema.parse(req.body);
    if (req.userRole !== 'ADMIN' && validatedData.userId !== req.userId) {
      return res.status(403).json({ success: false, error: 'Access forbidden' });
    }

    const plan = await prisma.$transaction(
      async (
        tx: Omit<
          PrismaClient,
          '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
        >,
      ) => {
        await tx.studyPlan.updateMany({
          where: { userId: validatedData.userId },
          data: { isActive: false },
        });

        return tx.studyPlan.create({
          data: {
            ...validatedData,
            isActive: true,
          },
          include: {
            semesters: true,
          },
        });
      },
    );

    return res.status(201).json({
      success: true,
      data: plan,
      message: 'Study plan created successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    console.error('Error creating study plan:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create study plan',
    });
  }
});

// Add semester to study plan
router.post(
  '/:id/semesters',
  requireAuth,
  requireStudyPlanAccess,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const validatedData = CreateSemesterSchema.parse(req.body);

      const semester = await createPlannedSemester(id, req.userId!, validatedData);

      return res.status(201).json({
        success: true,
        data: semester,
        message: 'Semester added to study plan',
      });
    } catch (error) {
      if (error instanceof PlannedSemesterError)
        return res.status(error.status).json({ success: false, error: error.message });
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      }
      console.error('Error adding semester:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to add semester',
      });
    }
  },
);

// Update semester
router.put(
  '/:planId/semesters/:semesterId',
  requireAuth,
  requireStudyPlanAccess,
  async (req: Request, res: Response) => {
    try {
      const { planId, semesterId } = req.params;
      const validatedData = UpdateSemesterSchema.parse(req.body);

      const semester = await updatePlannedSemester(planId, semesterId, req.userId!, validatedData);

      return res.json({
        success: true,
        data: semester,
        message: 'Semester updated successfully',
      });
    } catch (error) {
      if (error instanceof PlannedSemesterError)
        return res.status(error.status).json({ success: false, error: error.message });
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      }
      if (isNotFoundError(error)) {
        return res.status(404).json({
          success: false,
          error: 'Semester not found',
        });
      }
      console.error('Error updating semester:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to update semester',
      });
    }
  },
);

// Delete semester
router.delete(
  '/:planId/semesters/:semesterId',
  requireAuth,
  requireStudyPlanAccess,
  async (req: Request, res: Response) => {
    try {
      const { semesterId } = req.params;

      await prisma.plannedSemester.delete({
        where: { id: semesterId },
      });

      return res.json({
        success: true,
        message: 'Semester removed from study plan',
      });
    } catch (error) {
      if (isNotFoundError(error)) {
        return res.status(404).json({
          success: false,
          error: 'Semester not found',
        });
      }
      console.error('Error deleting semester:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to delete semester',
      });
    }
  },
);

// Delete study plan
router.delete('/:id', requireAuth, requireStudyPlanAccess, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.studyPlan.delete({
      where: { id },
    });

    return res.json({
      success: true,
      message: 'Study plan deleted successfully',
    });
  } catch (error) {
    if (isNotFoundError(error)) {
      return res.status(404).json({
        success: false,
        error: 'Study plan not found',
      });
    }
    console.error('Error deleting study plan:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete study plan',
    });
  }
});

export default router;
