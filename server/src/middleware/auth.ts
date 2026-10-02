import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type {} from '../types/express';
import config from '../config';
import { prisma } from '../db';
import { AUTH_COOKIE_NAME, AUTH_TOKEN_OPTIONS, AUTH_USER_SELECT } from '../services/authService';

export const requireAuth: RequestHandler = async (req, res, next) => {
  const token: unknown = req.cookies?.[AUTH_COOKIE_NAME];
  let userId: string;
  try {
    if (typeof token !== 'string') throw new Error('Missing session');
    const payload = jwt.verify(token, config.jwtSecret, {
      ...AUTH_TOKEN_OPTIONS,
      algorithms: ['HS256'],
    });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') {
      throw new Error('Invalid session');
    }
    userId = payload.sub;
  } catch {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  try {
    // Read the current role from the database, rather than trusting a stale token.
    const user = await prisma.user.findUnique({ where: { id: userId }, select: AUTH_USER_SELECT });
    if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });
    req.userId = user.id;
    req.userRole = user.role;
    req.authUser = user;
    return next();
  } catch (error) {
    return next(error);
  }
};

export const requireAdmin: RequestHandler[] = [
  requireAuth,
  (req, res, next) => {
    if (req.userRole !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    return next();
  },
];

export const requireUserAccess: RequestHandler[] = [
  requireAuth,
  (req, res, next) => {
    // Match the record service's identifier resolution: UUID-shaped values
    // identify a database user, even if someone chose one as their student ID.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      req.params.id,
    );
    if (
      req.userRole !== 'ADMIN' &&
      req.params.id !== req.userId &&
      (isUuid || req.params.id !== req.authUser?.studentId)
    ) {
      return res.status(403).json({ success: false, error: 'Access forbidden' });
    }
    return next();
  },
];

// These routes query userId directly; student-ID aliases must not grant access.
export const requireUserIdAccess: RequestHandler[] = [
  requireAuth,
  (req, res, next) => {
    if (req.userRole !== 'ADMIN' && req.params.userId !== req.userId) {
      return res.status(403).json({ success: false, error: 'Access forbidden' });
    }
    return next();
  },
];

export const checkRequestOrigin: RequestHandler = (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    // CLI tools may omit Origin. Browser requests must use the configured frontend.
    if (
      (origin && origin !== config.corsOrigin) ||
      (!origin && req.get('sec-fetch-site') === 'cross-site')
    ) {
      return res.status(403).json({ success: false, error: 'Request origin is not allowed' });
    }
  }
  return next();
};
