import type { AccountWriteScopeDTO } from '@iu-study-planner/shared';
import { StudentRecordError } from './studentRecordError';

/** Compare a precondition with the owner read by the write transaction; never assign it. */
export function assertProgressWriteScope(
  expected: AccountWriteScopeDTO | undefined,
  current: { id: string; curriculumId: string | null },
) {
  if (!expected) return;
  if (
    expected.userId.toLowerCase() !== current.id.toLowerCase() ||
    expected.curriculumId?.toLowerCase() !== current.curriculumId?.toLowerCase()
  )
    throw new StudentRecordError(
      'Your account or curriculum changed. Reload progress before saving changes',
      409,
    );
}
