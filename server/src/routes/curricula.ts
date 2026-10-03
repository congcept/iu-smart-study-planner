import { Router } from 'express';
import { z } from 'zod';
import { CurriculumParamsSchema } from '@iu-study-planner/shared';
import { listCurriculumContexts, readCurriculumContext } from '../services/curriculumContexts';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    return res.json({ success: true, data: await listCurriculumContexts() });
  } catch (error) {
    console.error('Error reading curriculum contexts:', error);
    return res.status(500).json({ success: false, error: 'Failed to read curriculum contexts' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = CurriculumParamsSchema.parse(req.params);
    const context = await readCurriculumContext(id);
    if (!context) return res.status(404).json({ success: false, error: 'Curriculum not found' });
    return res.json({ success: true, data: context });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Invalid curriculum ID' });
    }
    console.error('Error reading curriculum context:', error);
    return res.status(500).json({ success: false, error: 'Failed to read curriculum context' });
  }
});

export default router;
