import bcrypt from 'bcrypt';
import { Response, CookieOptions } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';

export const AUTH_COOKIE_NAME = 'isp_session';
export const AUTH_TOKEN_OPTIONS = {
  issuer: 'iu-study-planner',
  audience: 'iu-study-planner-client',
} as const;
export const AUTH_USER_SELECT = {
  id: true,
  studentId: true,
  name: true,
  email: true,
  role: true,
  curriculumId: true,
} as const;
export const PUBLIC_USER_SELECT = {
  ...AUTH_USER_SELECT,
  major: true,
  enrollmentYear: true,
  targetGraduationYear: true,
  createdAt: true,
  updatedAt: true,
} as const;

const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.nodeEnv === 'production',
  path: '/',
};

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export function issueToken(userId: string) {
  return jwt.sign({}, config.jwtSecret, {
    ...AUTH_TOKEN_OPTIONS,
    algorithm: 'HS256',
    subject: userId,
    expiresIn: config.jwtExpiresIn,
  });
}

export function setAuthCookie(res: Response, userId: string) {
  res.cookie(AUTH_COOKIE_NAME, issueToken(userId), {
    ...cookieOptions,
    maxAge: config.jwtExpiresIn * 1000,
  });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(AUTH_COOKIE_NAME, cookieOptions);
}
