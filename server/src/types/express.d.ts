import type { AuthUserDTO, UserRole } from '@iu-study-planner/shared';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: UserRole;
      authUser?: AuthUserDTO;
    }
  }
}

export {};
