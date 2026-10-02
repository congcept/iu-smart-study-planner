import { RequestHandler } from 'express';
import { prisma } from '../db';

/** Authentication runs first; verify both the plan owner and nested semester. */
export const requireStudyPlanAccess: RequestHandler = async (req, res, next) => {
  try {
    const planId = req.params.planId ?? req.params.id;
    const plan = await prisma.studyPlan.findUnique({
      where: { id: planId },
      select: { userId: true },
    });
    if (!plan) return res.status(404).json({ success: false, error: 'Study plan not found' });
    if (req.userRole !== 'ADMIN' && plan.userId !== req.userId) {
      return res.status(403).json({ success: false, error: 'Access forbidden' });
    }
    if (req.params.semesterId) {
      const semester = await prisma.plannedSemester.findFirst({
        where: { id: req.params.semesterId, studyPlanId: planId },
        select: { id: true },
      });
      if (!semester) return res.status(404).json({ success: false, error: 'Semester not found' });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};
