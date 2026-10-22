import type { ReactNode } from 'react';

import { Badge } from './Badge';

export type StatusSeverity =
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'CRITICAL';

const variants = {
  PENDING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'error',
  LOW: 'success',
  MEDIUM: 'info',
  HIGH: 'warning',
  CRITICAL: 'error',
} as const;

export function StatusPill({ status, children }: { status: StatusSeverity; children?: ReactNode }) {
  return <Badge variant={variants[status]}>{children ?? status}</Badge>;
}
