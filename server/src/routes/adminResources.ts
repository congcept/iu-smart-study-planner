import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ResourceScopeSchema, UpsertResourcesSchema } from '@iu-study-planner/shared';
import { requireAdmin } from '../middleware/auth';
import { readResources, upsertResources, SchoolResourceError } from '../services/schoolResources';
import { readPlannedDemand } from '../services/schoolDemand';

const router = Router();
const QuerySchema = ResourceScopeSchema.extend({
  year: z
    .string()
    .regex(/^\d{4}$/)
    .transform(Number)
    .pipe(ResourceScopeSchema.shape.year),
});
function failure(
  error: unknown,
  res: Response,
  fallback = 'Could not load or save resource settings',
) {
  if (error instanceof z.ZodError)
    return res
      .status(400)
      .json({ success: false, error: 'Validation failed', details: error.errors });
  if (error instanceof SchoolResourceError)
    return res.status(error.status).json({ success: false, error: error.message });
  console.error('Resource configuration error:', error);
  return res.status(500).json({ success: false, error: fallback });
}
router.get('/demand', requireAdmin, async (req: Request, res: Response) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const scope = QuerySchema.parse(req.query);
    return res.json({ success: true, data: await readPlannedDemand(req.userId, scope) });
  } catch (error) {
    return failure(error, res, 'Could not load planned-selection demand');
  }
});
router.get('/resources', requireAdmin, async (req: Request, res: Response) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const scope = QuerySchema.parse(req.query);
    return res.json({ success: true, data: await readResources(req.userId, scope) });
  } catch (error) {
    return failure(error, res);
  }
});
router.post('/resources', requireAdmin, async (req: Request, res: Response) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const { snapshot, created } = await upsertResources(
      req.userId,
      UpsertResourcesSchema.parse(req.body),
    );
    return res.status(created ? 201 : 200).json({ success: true, data: snapshot });
  } catch (error) {
    return failure(error, res);
  }
});
export default router;
