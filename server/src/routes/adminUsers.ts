import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { AssignReferenceCurriculumSchema, ListAdminStudentsSchema } from '@iu-study-planner/shared';
import { requireAdmin } from '../middleware/auth';
import {
  assignReferenceCurriculum,
  CurriculumAssignmentError,
  listAdminStudents,
} from '../services/curriculumAssignment';

const router = Router();
const StudentParamsSchema = z
  .object({
    userId: z
      .string()
      .uuid()
      .transform((id) => id.toLowerCase()),
  })
  .strict();

function failure(error: unknown, res: Response, fallback: string) {
  if (error instanceof z.ZodError)
    return res
      .status(400)
      .json({ success: false, error: 'Validation failed', details: error.errors });
  if (error instanceof CurriculumAssignmentError)
    return res.status(error.status).json({ success: false, error: error.message });
  console.error('Reference curriculum assignment error:', error);
  return res.status(500).json({ success: false, error: fallback });
}

router.get('/students', requireAdmin, async (req: Request, res: Response) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    const query = ListAdminStudentsSchema.parse(req.query);
    return res.json({ success: true, data: await listAdminStudents(req.userId, query) });
  } catch (error) {
    return failure(error, res, 'Could not load student accounts');
  }
});

router.post('/students/:userId/curriculum', requireAdmin, async (req: Request, res: Response) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const { userId } = StudentParamsSchema.parse(req.params);
    z.object({}).strict().parse(req.query);
    const body = AssignReferenceCurriculumSchema.parse(req.body);
    return res.json({
      success: true,
      data: await assignReferenceCurriculum(req.userId, userId, body),
    });
  } catch (error) {
    return failure(error, res, 'Could not confirm the reference curriculum assignment');
  }
});

export default router;
