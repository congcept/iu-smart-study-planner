import { Router, Response } from 'express';
import { z } from 'zod';
import { AppendGradeAttemptSchema } from '@iu-study-planner/shared';
import { requireAuth } from '../middleware/auth';
import { appendGradeAttempt, GradeAttemptError } from '../services/gradeAttempts';
import { readStudentGradeCourses, readStudentGrades } from '../services/studentGradeContext';

const router = Router();
router.use(requireAuth);

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

router.get('/courses', async (req, res) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    z.object({}).strict().parse(req.query);
    return res.json({ success: true, data: await readStudentGradeCourses(req.userId) });
  } catch (error) {
    return handleGradeError(error, res);
  }
});

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
