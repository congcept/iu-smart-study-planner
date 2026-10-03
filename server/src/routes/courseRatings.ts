import { Router, type Response } from 'express';
import { z } from 'zod';
import { RateCourseSchema, CourseRatingQuerySchema } from '@iu-study-planner/shared';
import { requireAuth } from '../middleware/auth';
import {
  CourseRatingError,
  readCourseRatings,
  readCurriculumCourseRatings,
  submitCourseRating,
} from '../services/courseRatings';

const router = Router();
const courseIdSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
function handleError(error: unknown, res: Response) {
  if (error instanceof z.ZodError)
    return res
      .status(400)
      .json({ success: false, error: 'Validation error', details: error.errors });
  if (error instanceof CourseRatingError) {
    if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
    return res.status(error.status).json({ success: false, error: error.message });
  }
  console.error('Error accessing course ratings:', error);
  return res.status(500).json({ success: false, error: 'Could not load or save course ratings' });
}
router.get('/:id/ratings', async (req, res) => {
  try {
    const { curriculumId } = CourseRatingQuerySchema.parse(req.query);
    return res.json({
      success: true,
      data: curriculumId
        ? await readCurriculumCourseRatings(courseIdSchema.parse(req.params.id), curriculumId)
        : await readCourseRatings(courseIdSchema.parse(req.params.id)),
    });
  } catch (error) {
    return handleError(error, res);
  }
});
router.post('/:id/rate', requireAuth, async (req, res) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const id = courseIdSchema.parse(req.params.id);
    const data = RateCourseSchema.parse(req.body);
    return res.json({ success: true, data: await submitCourseRating(req.userId, id, data.rating) });
  } catch (error) {
    return handleError(error, res);
  }
});
export default router;
