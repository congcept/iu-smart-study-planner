import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { DemoLoginSchema, LoginSchema, RegisterSchema } from '@iu-study-planner/shared';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { getDemoAccount, isDemoLoginEnabled } from '../services/demoAuthService';
import {
  AUTH_USER_SELECT,
  clearAuthCookie,
  hashPassword,
  setAuthCookie,
  verifyPassword,
} from '../services/authService';

const router = Router();

router.get('/demo', (_req, res) => {
  return res.json({ success: true, data: { enabled: isDemoLoginEnabled() } });
});

router.post('/demo', async (req, res, next) => {
  if (!isDemoLoginEnabled()) {
    return res.status(404).json({ success: false, error: 'Demo login is unavailable' });
  }
  try {
    const { role } = DemoLoginSchema.parse(req.body);
    const user = await getDemoAccount(role);
    setAuthCookie(res, user.id);
    return res.json({ success: true, data: { user } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Invalid demo role' });
    }
    return next(error);
  }
});

router.post('/register', async (req, res, next) => {
  try {
    const { password, ...profile } = RegisterSchema.parse(req.body);
    const passwordHash = await hashPassword(password);
    // Role always defaults to STUDENT; callers cannot request admin access.
    const user = await prisma.user.create({
      data: { ...profile, passwordHash },
      select: AUTH_USER_SELECT,
    });
    setAuthCookie(res, user.id);
    return res.status(201).json({ success: true, data: { user } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ success: false, error: 'Validation error', details: error.errors });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res
        .status(409)
        .json({ success: false, error: 'Email or student ID is already registered' });
    }
    return next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = LoginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email },
      select: { ...AUTH_USER_SELECT, passwordHash: true },
    });
    // Also perform bcrypt work for unknown/passwordless demo accounts.
    const dummyHash = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
    const valid = await verifyPassword(password, user?.passwordHash ?? dummyHash);
    if (!user?.passwordHash || !valid) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }
    setAuthCookie(res, user.id);
    return res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          studentId: user.studentId,
          name: user.name,
          email: user.email,
          role: user.role,
          curriculumId: user.curriculumId,
        },
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ success: false, error: 'Validation error', details: error.errors });
    }
    return next(error);
  }
});

router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  return res.status(204).send();
});

router.get('/me', requireAuth, (req, res) =>
  res.json({ success: true, data: { user: req.authUser } }),
);

export default router;
