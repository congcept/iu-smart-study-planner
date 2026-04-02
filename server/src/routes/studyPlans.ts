import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { z } from 'zod';
import { CreateStudyPlanSchema, CreateSemesterSchema } from '@iu-study-planner/shared';
import { prisma } from '../db';

function isNotFoundError(error: unknown): boolean {
  return error instanceof PrismaClientKnownRequestError && error.code === 'P2025';
}

const router = Router();

// Get all study plans for a user
router.get('/user/:userId', async (req: Request, res: Response) => {
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
router.get('/:id', async (req: Request, res: Response) => {
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
router.post('/', async (req: Request, res: Response) => {
  try {
    const validatedData = CreateStudyPlanSchema.parse(req.body);

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
router.post('/:id/semesters', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const validatedData = CreateSemesterSchema.parse(req.body);

    // Check if study plan exists
    const plan = await prisma.studyPlan.findUnique({ where: { id } });
    if (!plan) {
      return res.status(404).json({
        success: false,
        error: 'Study plan not found',
      });
    }

    // Calculate total credits and difficulty
    const courseIds = validatedData.courses.map((c) => c.courseId);
    const courses = await prisma.course.findMany({
      where: { id: { in: courseIds } },
    });

    const totalCredits = courses.reduce(
      (sum: number, c: { credits: number }) => sum + c.credits,
      0,
    );
    const difficultyScore =
      courses.reduce((sum: number, c: { difficultyLevel: number }) => sum + c.difficultyLevel, 0) /
      (courses.length || 1);

    const semester = await prisma.plannedSemester.create({
      data: {
        studyPlanId: id,
        semester: validatedData.semester,
        year: validatedData.year,
        courses: validatedData.courses,
        totalCredits,
        difficultyScore,
      },
    });

    return res.status(201).json({
      success: true,
      data: semester,
      message: 'Semester added to study plan',
    });
  } catch (error) {
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
});

// Update semester
router.put('/:planId/semesters/:semesterId', async (req: Request, res: Response) => {
  try {
    const { semesterId } = req.params;
    const validatedData = CreateSemesterSchema.partial().parse(req.body);

    // Recalculate if courses changed
    const updateData: typeof validatedData & { totalCredits?: number; difficultyScore?: number } = {
      ...validatedData,
    };
    if (validatedData.courses) {
      const courseIds = validatedData.courses.map((c) => c.courseId);
      const courses = await prisma.course.findMany({
        where: { id: { in: courseIds } },
      });

      updateData.totalCredits = courses.reduce(
        (sum: number, c: { credits: number }) => sum + c.credits,
        0,
      );
      updateData.difficultyScore =
        courses.reduce(
          (sum: number, c: { difficultyLevel: number }) => sum + c.difficultyLevel,
          0,
        ) / (courses.length || 1);
    }

    const semester = await prisma.plannedSemester.update({
      where: { id: semesterId },
      data: updateData,
    });

    return res.json({
      success: true,
      data: semester,
      message: 'Semester updated successfully',
    });
  } catch (error) {
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
});

// Delete semester
router.delete('/:planId/semesters/:semesterId', async (req: Request, res: Response) => {
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
});

// Delete study plan
router.delete('/:id', async (req: Request, res: Response) => {
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
