import { z } from 'zod';
import {
  AllocationRunV1Schema,
  CreateAllocationRunSchema,
  ResourceScopeSchema,
  type AllocationRunV1DTO,
  type ApiResponse,
  type CreateAllocationRunDTO,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';
import apiClient from './api';

const idSchema = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());
const captureSchema = CreateAllocationRunSchema.refine(
  (request) => request.expectedActorId !== undefined,
  'A verified administrator identity is required',
);

function verified(response: ApiResponse<unknown>, scope: ResourceScopeDTO): AllocationRunV1DTO {
  const parsed = AllocationRunV1Schema.safeParse(response?.data);
  if (
    response?.success !== true ||
    !parsed.success ||
    parsed.data.result.scope.curriculumId !== scope.curriculumId ||
    parsed.data.result.scope.semester !== scope.semester ||
    parsed.data.result.scope.year !== scope.year
  )
    throw new Error('Could not verify the saved simulation capture. Retry to recover it.');
  return parsed.data;
}

export async function createAllocationRun(
  input: CreateAllocationRunDTO & { expectedActorId: string },
) {
  const payload = captureSchema.parse(input);
  const scope = ResourceScopeSchema.parse({
    curriculumId: payload.curriculumId,
    semester: payload.semester,
    year: payload.year,
  });
  const response = await apiClient.post<ApiResponse<unknown>>('/admin/allocation-runs', payload);
  return verified(response.data, scope);
}

export async function getAllocationRun(id: string, input: ResourceScopeDTO) {
  const runId = idSchema.parse(id);
  const scope = ResourceScopeSchema.parse(input);
  const response = await apiClient.get<ApiResponse<unknown>>(`/admin/allocation-runs/${runId}`);
  const run = verified(response.data, scope);
  if (run.id !== runId)
    throw new Error('Could not verify the saved simulation capture. Retry to recover it.');
  return run;
}
