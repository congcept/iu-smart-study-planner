import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppendGradeAttemptSchema, type StudentGradesDTO } from '@iu-study-planner/shared';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { appendGradeAttempt, GradeAttemptError } from '../services/gradeAttempts';
import { calculateGradeSummary } from '../services/gradeSummary';

const router = Router();
router.use(requireAuth);

async function readStudentGrades(userId: string): Promise<StudentGradesDTO> {
  return prisma.$transaction(
    async (tx) => {
      const attempts = await tx.gradeAttempt.findMany({
        where: { userId },
        include: { course: { select: { id: true, code: true, name: true, credits: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
      const completed = await tx.studentRecord.findMany({
        where: { userId, status: 'COMPLETED' },
        select: { courseId: true, course: { select: { code: true, credits: true } } },
        orderBy: { courseId: 'asc' },
      });
      const gradedIds = new Set(attempts.map(({ courseId }) => courseId));
      return {
        attempts: attempts.map((attempt) => ({
          id: attempt.id,
          requestId: attempt.requestId,
          courseId: attempt.courseId,
          score: attempt.score,
          semester: attempt.semester,
          year: attempt.year,
          createdAt: attempt.createdAt.toISOString(),
          course: attempt.course,
        })),
        summary: calculateGradeSummary(
          attempts.map(({ course }) => course),
          attempts,
        ),
        // This explicitly reports partial numeric coverage without inventing scores
        // from legacy letter grades or treating ungraded completions as zero.
        completedCoursesWithoutNumericGrades: completed
          .filter(
            ({ courseId, course }) =>
              course.credits > 0 &&
              !['PT001IU', 'PT002IU'].includes(course.code) &&
              !gradedIds.has(courseId),
          )
          .map(({ courseId }) => courseId),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

function handleGradeError(error: unknown, res: Response) {
  if (error instanceof z.ZodError) {
    return res
      .status(400)
      .json({ success: false, error: 'Validation error', details: error.errors });
  }
  if (error instanceof GradeAttemptError) {
    return res.status(error.status).json({ success: false, error: error.message });
  }
  console.error('Error accessing numeric grades:', error);
  return res.status(500).json({ success: false, error: 'Could not load or save grades' });
}

router.get('/', async (req, res) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    return res.json({ success: true, data: await readStudentGrades(req.userId) });
  } catch (error) {
    return handleGradeError(error, res);
  }
});

router.post('/', async (req, res) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const data = AppendGradeAttemptSchema.parse(req.body);
    await appendGradeAttempt(req.userId, data);
    return res.json({ success: true, data: await readStudentGrades(req.userId) });
  } catch (error) {
    return handleGradeError(error, res);
  }
});

export default router;
