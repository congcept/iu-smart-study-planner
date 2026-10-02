import type { UserRole } from '@iu-study-planner/shared';
import config from '../config';
import { prisma } from '../db';
import { AUTH_USER_SELECT } from './authService';

// Dedicated identities keep demo login separate from registered and legacy users.
export const DEMO_ACCOUNTS = {
  STUDENT: {
    id: '4831aeb8-181b-4f72-8b06-5b59b27006c0',
    studentId: 'DEMO-STUDENT',
    email: 'demo-student@example.test',
    name: 'Demo Student',
    role: 'STUDENT',
  },
  ADMIN: {
    id: 'b7a6d6a1-bd04-4ce2-b8b7-df614218e56f',
    studentId: 'DEMO-SCHOOL-ADMIN',
    email: 'demo-school-admin@example.test',
    name: 'Demo School Admin',
    role: 'ADMIN',
  },
} as const;

export function isDemoLoginEnabled() {
  return config.nodeEnv === 'development' && config.demoLoginEnabled;
}

export async function getDemoAccount(role: UserRole) {
  const profile = DEMO_ACCOUNTS[role];
  const user = await prisma.user.upsert({
    where: { id: profile.id },
    create: profile,
    update: {},
    select: AUTH_USER_SELECT,
  });
  // Never promote or impersonate a row whose identity was changed outside this flow.
  if (
    user.role !== profile.role ||
    user.email !== profile.email ||
    user.studentId !== profile.studentId
  ) {
    throw new Error('Demo account identity does not match its configured profile');
  }
  return user;
}
