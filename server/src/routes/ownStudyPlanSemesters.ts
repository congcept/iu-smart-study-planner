import { Router } from 'express';
import { z } from 'zod';
import {
  ListOwnStudyPlanSemestersSchema,
  OwnStudyPlanSemestersParamsSchema,
} from '@iu-study-planner/shared';
import { requireAuth } from '../middleware/auth';
import {
  listOwnStudyPlanSemesters,
  OwnStudyPlanSemestersError,
} from '../services/ownStudyPlanSemesters';

const router = Router();

router.get('/:planId/semesters', requireAuth, async (req, res) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const { planId } = OwnStudyPlanSemestersParamsSchema.parse(req.params);
    const query = ListOwnStudyPlanSemestersSchema.parse(req.query);
    z.object({})
      .strict()
      .parse(req.body ?? {});
    return res.json({
      success: true,
      data: await listOwnStudyPlanSemesters(req.userId, planId, query),
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({ success: false, error: 'Validation failed', details: error.errors });
    if (error instanceof OwnStudyPlanSemestersError)
      return res.status(error.status).json({ success: false, error: error.message });
    console.error('Own saved semester metadata read error:', error);
    return res.status(500).json({ success: false, error: 'Could not load your saved semesters' });
  }
});

export default router;
