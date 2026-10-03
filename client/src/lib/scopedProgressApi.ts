import {
  AccountWriteScopeSchema,
  ScopedStudentProgressSchema,
  type ApiResponse,
  type ScopedStudentProgressDTO,
} from '@iu-study-planner/shared';
import apiClient from './api';

/** A fresh context is returned with its selections; callers decide how to activate it. */
export async function getScopedStudentProgress(
  expectedUserId: string,
): Promise<ScopedStudentProgressDTO> {
  const expected = AccountWriteScopeSchema.parse({ userId: expectedUserId, curriculumId: null });
  const response = await apiClient.get<ApiResponse<unknown>>('/users/me/progress/snapshot');
  const parsed = ScopedStudentProgressSchema.safeParse(response.data?.data);
  if (
    response.data?.success !== true ||
    !parsed.success ||
    parsed.data.scope.userId !== expected.userId
  )
    throw new Error('Could not verify saved progress for your account. Reload to try again.');
  return parsed.data;
}
