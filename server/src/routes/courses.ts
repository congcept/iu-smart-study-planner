import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CreateCourseSchema, CreatePrerequisiteSchema } from '@iu-study-planner/shared';
import { prisma } from '../db';

const router = Router();

// Get all courses with their prerequisites
router.get('/', async (_req: Request, res: Response) => {
  try {
    const courses = await prisma.course.findMany({
      include: {
        prerequisites: {
          include: {
            prerequisite: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        },
        isPrerequisiteFor: {
          include: {
            course: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        code: 'asc',
      },
    });

    return res.json({
      success: true,
      data: courses,
      count: courses.length,
    });
  } catch (error) {
    console.error('Error fetching courses:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch courses',
    });
  }
});

// Get course by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const course = await prisma.course.findUnique({
      where: { id },
      include: {
        prerequisites: {
          include: {
            prerequisite: true,
          },
        },
        isPrerequisiteFor: {
          include: {
            course: true,
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

    return res.json({
      success: true,
      data: course,
    });
  } catch (error) {
    console.error('Error fetching course:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch course',
    });
  }
});

// Create new course
router.post('/', async (req: Request, res: Response) => {
  try {
    const validatedData = CreateCourseSchema.parse(req.body);

    const course = await prisma.course.create({
      data: validatedData,
    });

    return res.status(201).json({
      success: true,
      data: course,
      message: 'Course created successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    console.error('Error creating course:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create course',
    });
  }
});

// Update course
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const validatedData = CreateCourseSchema.partial().parse(req.body);

    const course = await prisma.course.update({
      where: { id },
      data: validatedData,
    });

    return res.json({
      success: true,
      data: course,
      message: 'Course updated successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }
    console.error('Error updating course:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update course',
    });
  }
});

// Delete course
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.course.delete({
      where: { id },
    });

    return res.json({
      success: true,
      message: 'Course deleted successfully',
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }
    console.error('Error deleting course:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete course',
    });
  }
});

// Add prerequisite relationship
router.post('/prerequisites', async (req: Request, res: Response) => {
  try {
    const validatedData = CreatePrerequisiteSchema.parse(req.body);

    // Check if both courses exist
    const [course, prerequisite] = await Promise.all([
      prisma.course.findUnique({ where: { id: validatedData.courseId } }),
      prisma.course.findUnique({ where: { id: validatedData.prerequisiteId } }),
    ]);

    if (!course || !prerequisite) {
      return res.status(404).json({
        success: false,
        error: 'One or both courses not found',
      });
    }

    // Check for circular dependency
    if (validatedData.courseId === validatedData.prerequisiteId) {
      return res.status(400).json({
        success: false,
        error: 'A course cannot be a prerequisite of itself',
      });
    }

    const prereq = await prisma.prerequisite.create({
      data: validatedData,
      include: {
        course: {
          select: { id: true, code: true, name: true },
        },
        prerequisite: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    return res.status(201).json({
      success: true,
      data: prereq,
      message: 'Prerequisite added successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    console.error('Error adding prerequisite:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to add prerequisite',
    });
  }
});

// Remove prerequisite relationship
router.delete('/prerequisites/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.prerequisite.delete({
      where: { id },
    });

    return res.json({
      success: true,
      message: 'Prerequisite removed successfully',
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: 'Prerequisite relationship not found',
      });
    }
    console.error('Error removing prerequisite:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to remove prerequisite',
    });
  }
});

export default router;
