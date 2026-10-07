import { z } from 'zod';
import {
  CreateSemesterAllocationRunSchema,
  SemesterAllocationRunV1Schema,
  SemesterAllocationScopeV1Schema,
  type ApiResponse,
  type CreateSemesterAllocationRunDTO,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';
import apiClient from './api';

const idSchema = z
  .string()
  .length(36)
  .uuid()
  .transform((id) => id.toLowerCase());
function verified(response: ApiResponse<unknown>, scope: ResourceScopeDTO) {
  const parsed = SemesterAllocationRunV1Schema.safeParse(response?.data);
  if (
    response?.success !== true ||
    !parsed.success ||
    parsed.data.result.scope.curriculumId !== scope.curriculumId ||
    parsed.data.result.scope.semester !== scope.semester ||
    parsed.data.result.scope.year !== scope.year
  )
    throw new Error('Could not verify the saved semester capture. Retry to recover it.');
  return parsed.data;
}

export async function createSemesterAllocationRun(input: CreateSemesterAllocationRunDTO) {
  const payload = CreateSemesterAllocationRunSchema.parse(input);
  const scope = SemesterAllocationScopeV1Schema.parse({
    curriculumId: payload.curriculumId,
    semester: payload.semester,
    year: payload.year,
  });
  const response = await apiClient.post<ApiResponse<unknown>>(
    '/admin/semester-allocation-runs',
    payload,
  );
  return verified(response.data, scope);
}

export async function getSemesterAllocationRun(id: string, input: ResourceScopeDTO) {
  const runId = idSchema.parse(id);
  const scope = SemesterAllocationScopeV1Schema.parse(input);
  const response = await apiClient.get<ApiResponse<unknown>>(
    `/admin/semester-allocation-runs/${runId}`,
  );
  const run = verified(response.data, scope);
  if (run.id !== runId)
    throw new Error('Could not verify the saved semester capture. Retry to recover it.');
  return run;
}
