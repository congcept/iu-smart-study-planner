import { isAxiosError } from 'axios';
import { useCallback } from 'react';
import { SemesterAllocationJobSchema } from '@iu-study-planner/shared';
import { getSession } from '@/lib/api';

export class AdminSessionChanged extends Error {}

type VerificationOptions = {
  requireUuid?: boolean;
  onSessionBlockedChange?: (blocked: boolean) => void;
};

export function useVerifyAdminSession(
  userId: string,
  { requireUuid = false, onSessionBlockedChange }: VerificationOptions = {},
) {
  return useCallback(async () => {
    let account: Awaited<ReturnType<typeof getSession>>;
    try {
      account = await getSession();
    } catch (error) {
      if (isAxiosError(error) && [401, 403].includes(error.response?.status ?? 0))
        onSessionBlockedChange?.(true);
      throw error;
    }

    // The resource dashboard additionally requires a schema-validated UUID.
    const identity = requireUuid
      ? SemesterAllocationJobSchema.shape.id.safeParse(account?.id)
      : null;
    const matchesAccount = identity
      ? identity.success && identity.data === userId
      : account && account.id.toLowerCase() === userId;
    if (!matchesAccount || account?.role !== 'ADMIN') {
      onSessionBlockedChange?.(true);
      throw new AdminSessionChanged();
    }
    onSessionBlockedChange?.(false);
  }, [userId, requireUuid, onSessionBlockedChange]);
}
