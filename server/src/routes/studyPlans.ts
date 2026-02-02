import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const router = Router();
const prisma = new PrismaClient();

// Validation schemas
const createStudyPlanSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
});

const createSemesterSchema = z.object({
  semester: z.enum(['FALL', 'SPRING', 'SUMMER']),
  year: z.number().int(),
  courses: z.array(z.object({
    courseId: z.string().uuid(),
    position: z.number().int(),
  })),
});

// Get all study plans for a user
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    const plans = await prisma.studyPlan.findMany({
      where: { userId },
      include: {
        semesters: {
          orderBy: [
            { year: 'asc' },
            { semester: 'asc' },
          ],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json({
      success: true,
      data: plans,
      count: plans.length,
    });
  } catch (error) {
    console.error('Error fetching study plans:', error);
    res.status(500).json({
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
          orderBy: [
            { year: 'asc' },
            { semester: 'asc' },
          ],
        },
      },
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        error: 'Study plan not found',
      });
    }

    res.json({
      success: true,
      data: plan,
    });
  } catch (error) {
    console.error('Error fetching study plan:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch study plan',
    });
  }
});

// Create new study plan
router.post('/', async (req: Request, res: Response) => {
  try {
    const validatedData = createStudyPlanSchema.parse(req.body);
    
    // Deactivate other plans if this one is active
    if (true) {
      await prisma.studyPlan.updateMany({
        where: { userId: validatedData.userId },
        data: { isActive: false },
      });
    }

    const plan = await prisma.studyPlan.create({
      data: {
        ...validatedData,
        isActive: true,
      },
      include: {
        semesters: true,
      },
    });

    res.status(201).json({
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
    res.status(500).json({
      success: false,
      error: 'Failed to create study plan',
    });
  }
});

// Add semester to study plan
router.post('/:id/semesters', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const validatedData = createSemesterSchema.parse(req.body);

    // Check if study plan exists
    const plan = await prisma.studyPlan.findUnique({ where: { id } });
    if (!plan) {
      return res.status(404).json({
        success: false,
        error: 'Study plan not found',
      });
    }

    // Calculate total credits and difficulty
    const courseIds = validatedData.courses.map(c => c.courseId);
    const courses = await prisma.course.findMany({
      where: { id: { in: courseIds } },
    });

    const totalCredits = courses.reduce((sum, c) => sum + c.credits, 0);
    const difficultyScore = courses.reduce((sum, c) => sum + c.difficultyLevel, 0) / (courses.length || 1);

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

    res.status(201).json({
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
    res.status(500).json({
      success: false,
      error: 'Failed to add semester',
    });
  }
});

// Update semester
router.put('/:planId/semesters/:semesterId', async (req: Request, res: Response) => {
  try {
    const { semesterId } = req.params;
    const validatedData = createSemesterSchema.partial().parse(req.body);

    // Recalculate if courses changed
    let updateData: any = validatedData;
    if (validatedData.courses) {
      const courseIds = validatedData.courses.map(c => c.courseId);
      const courses = await prisma.course.findMany({
        where: { id: { in: courseIds } },
      });

      updateData.totalCredits = courses.reduce((sum, c) => sum + c.credits, 0);
      updateData.difficultyScore = courses.reduce((sum, c) => sum + c.difficultyLevel, 0) / (courses.length || 1);
    }

    const semester = await prisma.plannedSemester.update({
      where: { id: semesterId },
      data: updateData,
    });

    res.json({
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
    console.error('Error updating semester:', error);
    res.status(500).json({
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

    res.json({
      success: true,
      message: 'Semester removed from study plan',
    });
  } catch (error) {
    console.error('Error deleting semester:', error);
    res.status(500).json({
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

    res.json({
      success: true,
      message: 'Study plan deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting study plan:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete study plan',
    });
  }
});

export default router;
