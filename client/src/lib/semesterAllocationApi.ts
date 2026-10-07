import {
  SemesterAllocationPreviewSchema,
  SemesterAllocationScopeV1Schema,
  type ApiResponse,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';
import apiClient from './api';

export async function getSemesterAllocationPreview(input: ResourceScopeDTO) {
  const scope = SemesterAllocationScopeV1Schema.parse(input);
  const response = await apiClient.get<ApiResponse<unknown>>('/admin/semester-allocation-preview', {
    params: scope,
  });
  const parsed = SemesterAllocationPreviewSchema.safeParse(response.data?.data);
  if (
    response.data?.success !== true ||
    !parsed.success ||
    parsed.data.result.scope.curriculumId !== scope.curriculumId ||
    parsed.data.result.scope.semester !== scope.semester ||
    parsed.data.result.scope.year !== scope.year
  )
    throw new Error('Could not verify the semester preview. Reload to try again.');
  return parsed.data;
}
