import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  CreateAllocationRunSchema,
  CreateAllocationJobSchema,
  ExecuteAllocationJobSchema,
  ListAllocationRunsSchema,
  ResourceScopeSchema,
  UpsertResourcesSchema,
} from '@iu-study-planner/shared';
import { requireAdmin } from '../middleware/auth';
import { readResources, upsertResources, SchoolResourceError } from '../services/schoolResources';
import { readPlannedDemand } from '../services/schoolDemand';
import { readSimulationCapacity } from '../services/schoolSupply';
import { readSimulationResourceEnvelope } from '../services/schoolResourceEnvelope';
import { readEligibleCohortDemand } from '../services/eligibleCohortDemand';
import { readCohortResourceSnapshot } from '../services/cohortResourceSnapshot';

import { readAllocationPreview } from '../services/allocationPreview';
import {
  createAllocationRun,
  readAllocationRun,
  listAllocationRuns,
} from '../services/allocationRuns';
import { enqueueAllocationJob, readAllocationJob } from '../services/allocationJobs';
import { readAllocationJobOutcome, executeAllocationJob } from '../services/allocationJobExecution';

const router = Router();
const RunParamsSchema = z
  .object({
    id: z
      .string()
      .uuid()
      .transform((id) => id.toLowerCase()),
  })
  .strict();
const JobParamsSchema = z.object({ id: CreateAllocationJobSchema.shape.requestId }).strict();
const QuerySchema = ResourceScopeSchema.extend({
  year: z
    .string()
    .regex(/^\d{4}$/)
    .transform(Number)
    .pipe(ResourceScopeSchema.shape.year),
});
const HistoryQuerySchema = ListAllocationRunsSchema.extend({
  year: z
    .string()
    .length(4)
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
router.get('/allocation-preview', requireAdmin, async (req: Request, res: Response) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const scope = QuerySchema.parse(req.query);
    return res.json({ success: true, data: await readAllocationPreview(req.userId, scope) });
  } catch (error) {
    return failure(error, res, 'Could not load allocation preview');
  }
});
router.post('/allocation-jobs', requireAdmin, async (req: Request, res: Response) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    z.object({}).strict().parse(req.query);
    const { job, created } = await enqueueAllocationJob(
      req.userId,
      CreateAllocationJobSchema.parse(req.body),
    );
    return res.status(created ? 201 : 200).json({ success: true, data: job });
  } catch (error) {
    return failure(error, res, 'Could not queue simulation job');
  }
});
router.get('/allocation-jobs/:id', requireAdmin, async (req: Request, res: Response) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const { id } = JobParamsSchema.parse(req.params);
    z.object({}).strict().parse(req.query);
    return res.json({ success: true, data: await readAllocationJob(req.userId, id) });
  } catch (error) {
    return failure(error, res, 'Could not load simulation job');
  }
});
router.get('/allocation-jobs/:id/outcome', requireAdmin, async (req: Request, res: Response) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const { id } = JobParamsSchema.parse(req.params);
    z.object({}).strict().parse(req.query);
    z.object({})
      .strict()
      .parse(req.body ?? {});
    return res.json({ success: true, data: await readAllocationJobOutcome(req.userId, id) });
  } catch (error) {
    return failure(error, res, 'Could not load simulation job outcome');
  }
});
router.post('/allocation-jobs/:id/execute', requireAdmin, async (req: Request, res: Response) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const { id } = JobParamsSchema.parse(req.params);
    z.object({}).strict().parse(req.query);
    return res.json({
      success: true,
      data: await executeAllocationJob(req.userId, id, ExecuteAllocationJobSchema.parse(req.body)),
    });
  } catch (error) {
    return failure(
      error,
      res,
      'Could not execute simulation job; check its outcome before retrying',
    );
  }
});
router.post('/allocation-runs', requireAdmin, async (req: Request, res: Response) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const { run, created } = await createAllocationRun(
      req.userId,
      CreateAllocationRunSchema.parse(req.body),
    );
    return res.status(created ? 201 : 200).json({ success: true, data: run });
  } catch (error) {
    return failure(error, res, 'Could not save simulation run');
  }
});
router.get('/allocation-runs', requireAdmin, async (req: Request, res: Response) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    return res.json({
      success: true,
      data: await listAllocationRuns(req.userId, HistoryQuerySchema.parse(req.query)),
    });
  } catch (error) {
    return failure(error, res, 'Could not load simulation run history');
  }
});
router.get('/allocation-runs/:id', requireAdmin, async (req: Request, res: Response) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const { id } = RunParamsSchema.parse(req.params);
    if (Object.keys(req.query).length)
      throw new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: ['query'],
          message: 'Simulation run reads accept no query overrides',
        },
      ]);
    return res.json({ success: true, data: await readAllocationRun(req.userId, id) });
  } catch (error) {
    return failure(error, res, 'Could not load simulation run');
  }
});
router.get('/cohort-resource-snapshot', requireAdmin, async (req: Request, res: Response) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const scope = QuerySchema.parse(req.query);
    return res.json({ success: true, data: await readCohortResourceSnapshot(req.userId, scope) });
  } catch (error) {
    return failure(error, res, 'Could not load cohort resource snapshot');
  }
});
router.get('/cohort-demand', requireAdmin, async (req: Request, res: Response) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const scope = QuerySchema.parse(req.query);
    return res.json({ success: true, data: await readEligibleCohortDemand(req.userId, scope) });
  } catch (error) {
    return failure(error, res, 'Could not load eligible cohort demand');
  }
});
router.get('/resource-envelope', requireAdmin, async (req: Request, res: Response) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const scope = QuerySchema.parse(req.query);
    return res.json({
      success: true,
      data: await readSimulationResourceEnvelope(req.userId, scope),
    });
  } catch (error) {
    return failure(error, res, 'Could not load simulation resource envelope');
  }
});
router.get('/capacity', requireAdmin, async (req: Request, res: Response) => {
  if (!req.userId)
    return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const scope = QuerySchema.parse(req.query);
    return res.json({ success: true, data: await readSimulationCapacity(req.userId, scope) });
  } catch (error) {
    return failure(error, res, 'Could not load simulation capacity diagnostic');
  }
});
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
