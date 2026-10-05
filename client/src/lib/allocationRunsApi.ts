import { z } from 'zod';
import {
  AllocationRunV1Schema,
  AllocationRunHistorySchema,
  CreateAllocationRunSchema,
  ListAllocationRunsSchema,
  ResourceScopeSchema,
  type AllocationRunV1DTO,
  type ApiResponse,
  type CreateAllocationRunDTO,
  type ListAllocationRunsDTO,
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

export async function listAllocationRuns(input: ListAllocationRunsDTO) {
  const request = ListAllocationRunsSchema.parse(input);
  const response = await apiClient.get<ApiResponse<unknown>>('/admin/allocation-runs', {
    params: request,
  });
  const parsed = AllocationRunHistorySchema.safeParse(response.data?.data);
  if (
    response.data?.success !== true ||
    !parsed.success ||
    parsed.data.scope.curriculumId !== request.curriculumId ||
    parsed.data.scope.semester !== request.semester ||
    parsed.data.scope.year !== request.year ||
    parsed.data.runs.some((run) => run.id === request.after)
  )
    throw new Error('Could not verify simulation run history. Reload to try again.');
  return parsed.data;
}
