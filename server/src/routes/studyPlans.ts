import { Router, Request, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { z } from 'zod';
import { CreateStudyPlanSchema, CreateSemesterSchema } from '@iu-study-planner/shared';
import { prisma } from '../db';
import { requireAuth, requireUserIdAccess } from '../middleware/auth';
import { requireStudyPlanAccess } from '../middleware/studyPlanAccess';
import { decorateCourseDifficulties } from '../services/courseRatings';

function isNotFoundError(error: unknown): boolean {
  return error instanceof PrismaClientKnownRequestError && error.code === 'P2025';
}

const router = Router();

const SemesterInputSchema = CreateSemesterSchema.extend({
  courses: z
    .array(
      CreateSemesterSchema.shape.courses.element
        .extend({
          courseId: z
            .string()
            .uuid()
            .transform((id) => id.toLowerCase()),
        })
        .strict(),
    )
    .superRefine((courses, ctx) => {
      const seen = new Set<string>();
      courses.forEach(({ courseId }, index) => {
        if (seen.has(courseId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'courseId'],
            message: 'A course may appear only once in a semester',
          });
        }
        seen.add(courseId);
      });
    }),
}).strict();

const SemesterUpdateSchema = SemesterInputSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided' },
);

async function calculateSemesterTotals(courses: z.infer<typeof SemesterInputSchema>['courses']) {
  const savedCourses = await prisma.$transaction(
    async (tx) =>
      decorateCourseDifficulties(
        tx,
        await tx.course.findMany({
          where: { id: { in: courses.map(({ courseId }) => courseId) } },
          select: { id: true, credits: true, avgRating: true, ratingCount: true },
        }),
      ),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  const knownIds = new Set(savedCourses.map(({ id }) => id));
  const missing = courses.flatMap(({ courseId }, index) =>
    knownIds.has(courseId)
      ? []
      : [
          {
            code: z.ZodIssueCode.custom,
            path: ['courses', index, 'courseId'],
            message: 'Course not found',
          },
        ],
  );
  if (missing.length) throw new z.ZodError(missing);
  return {
    totalCredits: savedCourses.reduce((sum, course) => sum + course.credits, 0),
    difficultyScore:
      savedCourses.reduce((sum, course) => sum + course.ratingDifficulty, 0) /
      (savedCourses.length || 1),
  };
}

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
      const validatedData = SemesterInputSchema.parse(req.body);

      // Check if study plan exists
      const plan = await prisma.studyPlan.findUnique({ where: { id } });
      if (!plan) {
        return res.status(404).json({
          success: false,
          error: 'Study plan not found',
        });
      }

      // Validate every submitted course before calculating or saving totals.
      const totals = await calculateSemesterTotals(validatedData.courses);

      const semester = await prisma.plannedSemester.create({
        data: {
          studyPlanId: id,
          semester: validatedData.semester,
          year: validatedData.year,
          courses: validatedData.courses,
          ...totals,
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
  },
);

// Update semester
router.put(
  '/:planId/semesters/:semesterId',
  requireAuth,
  requireStudyPlanAccess,
  async (req: Request, res: Response) => {
    try {
      const { semesterId } = req.params;
      const validatedData = SemesterUpdateSchema.parse(req.body);

      // Recalculate if courses changed
      const updateData: typeof validatedData & { totalCredits?: number; difficultyScore?: number } =
        {
          ...validatedData,
        };
      if (validatedData.courses) {
        Object.assign(updateData, await calculateSemesterTotals(validatedData.courses));
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
