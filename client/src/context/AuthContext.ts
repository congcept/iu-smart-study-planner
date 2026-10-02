import { createContext, useContext } from 'react';
import type { AuthUserDTO, DemoLoginDTO, LoginDTO, RegisterDTO } from '@iu-study-planner/shared';

export interface AuthContextValue {
  user: AuthUserDTO | null;
  status: 'loading' | 'unauthenticated' | 'authenticated';
  sessionError: string | null;
  refresh: () => Promise<void>;
  login: (data: LoginDTO) => Promise<void>;
  register: (data: RegisterDTO) => Promise<void>;
  demoLogin: (data: DemoLoginDTO) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth requires AuthProvider');
  return context;
}
