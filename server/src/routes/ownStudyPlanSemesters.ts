import { Router } from 'express';
import { z } from 'zod';
import {
  ListOwnStudyPlanSemestersSchema,
  OwnStudyPlanSemestersParamsSchema,
  OwnStudyPlanCoursesParamsSchema,
  OwnStudyPlanReferenceReviewBodySchema,
  OwnStudyPlanReferenceSelectionBodySchema,
} from '@iu-study-planner/shared';
import { requireAuth } from '../middleware/auth';
import { reviewOwnStudyPlanReferenceSlot } from '../services/ownStudyPlanReferenceReview';
import { readOwnStudyPlanCourses } from '../services/ownStudyPlanCourses';
import {
  listOwnStudyPlanSemesters,
  OwnStudyPlanSemestersError,
} from '../services/ownStudyPlanSemesters';

import {
  readOwnStudyPlanReferenceSelection,
  saveOwnStudyPlanReferenceSelection,
} from '../services/ownStudyPlanReferenceSelection';

const router = Router();
for (const method of ['get', 'put'] as const) {
  router[method](
    '/:planId/semesters/:semesterId/reference-selection',
    requireAuth,
    async (req, res) => {
      if (!req.userId)
        return res.status(401).json({ success: false, error: 'Authentication required' });
      try {
        const { planId, semesterId } = OwnStudyPlanCoursesParamsSchema.parse(req.params);
        z.object({}).strict().parse(req.query);
        let data;
        if (method === 'get') {
          z.object({})
            .strict()
            .parse(req.body ?? {});
          data = await readOwnStudyPlanReferenceSelection(req.userId, planId, semesterId);
        } else {
          const input = OwnStudyPlanReferenceSelectionBodySchema.parse(req.body);
          data = await saveOwnStudyPlanReferenceSelection(req.userId, planId, semesterId, input);
        }
        return res.json({ success: true, data });
      } catch (error) {
        if (error instanceof z.ZodError)
          return res
            .status(400)
            .json({ success: false, error: 'Validation failed', details: error.errors });
        if (error instanceof OwnStudyPlanSemestersError)
          return res.status(error.status).json({ success: false, error: error.message });
        console.error('Own reference selection error:', error);
        return res
          .status(500)
          .json({ success: false, error: 'Could not process your saved reference selection' });
      }
    },
  );
}

router.post('/:planId/semesters/:semesterId/reference-review', requireAuth, async (req, res) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const { planId, semesterId } = OwnStudyPlanCoursesParamsSchema.parse(req.params);
    z.object({}).strict().parse(req.query);
    const input = OwnStudyPlanReferenceReviewBodySchema.parse(req.body);
    return res.json({
      success: true,
      data: await reviewOwnStudyPlanReferenceSlot(req.userId, planId, semesterId, input),
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({ success: false, error: 'Validation failed', details: error.errors });
    if (error instanceof OwnStudyPlanSemestersError)
      return res.status(error.status).json({ success: false, error: error.message });
    console.error('Own saved semester reference review error:', error);
    return res
      .status(500)
      .json({ success: false, error: 'Could not review your saved semester references' });
  }
});

router.get('/:planId/semesters/:semesterId/courses', requireAuth, async (req, res) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const { planId, semesterId } = OwnStudyPlanCoursesParamsSchema.parse(req.params);
    z.object({}).strict().parse(req.query);
    z.object({})
      .strict()
      .parse(req.body ?? {});
    return res.json({
      success: true,
      data: await readOwnStudyPlanCourses(req.userId, planId, semesterId),
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({ success: false, error: 'Validation failed', details: error.errors });
    if (error instanceof OwnStudyPlanSemestersError)
      return res.status(error.status).json({ success: false, error: error.message });
    console.error('Own saved semester course reference read error:', error);
    return res
      .status(500)
      .json({ success: false, error: 'Could not load your saved course references' });
  }
});

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
