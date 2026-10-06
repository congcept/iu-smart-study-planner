import {
  AllocationJobExecutionSchema,
  AllocationJobOutcomeSchema,
  AllocationJobSchema,
  AllocationJobHistorySchema,
  ListAllocationJobsSchema,
  CreateAllocationJobSchema,
  ExecuteAllocationJobSchema,
  type AllocationJobDTO,
  type AllocationJobOutcomeDTO,
  type ApiResponse,
  type CreateAllocationJobDTO,
  type ExecuteAllocationJobDTO,
  type ListAllocationJobsDTO,
  type ResourceScopeDTO,
} from '@iu-study-planner/shared';
import apiClient from './api';

const idSchema = CreateAllocationJobSchema.shape.requestId;
const scopeSchema = CreateAllocationJobSchema.pick({
  curriculumId: true,
  semester: true,
  year: true,
});
const verificationError = 'Could not verify the simulation job. Retry to recover its saved state.';

function matchesScope(actual: ResourceScopeDTO, expected: ResourceScopeDTO): boolean {
  return (
    actual.curriculumId === expected.curriculumId &&
    actual.semester === expected.semester &&
    actual.year === expected.year
  );
}

function verifiedJob(
  response: ApiResponse<unknown>,
  scope: ResourceScopeDTO,
  expectedId?: string,
): AllocationJobDTO {
  const parsed = AllocationJobSchema.safeParse(response?.data);
  if (
    response?.success !== true ||
    !parsed.success ||
    !matchesScope(parsed.data.scope, scope) ||
    (expectedId !== undefined && parsed.data.id !== expectedId)
  )
    throw new Error(verificationError);
  return parsed.data;
}

function verifiedOutcome(
  response: ApiResponse<unknown>,
  scope: ResourceScopeDTO,
  expectedId: string,
): AllocationJobOutcomeDTO {
  const parsed = AllocationJobOutcomeSchema.safeParse(response?.data);
  if (
    response?.success !== true ||
    !parsed.success ||
    !matchesScope(parsed.data.scope, scope) ||
    parsed.data.jobId !== expectedId
  )
    throw new Error(verificationError);
  return parsed.data;
}

/** The caller verifies durable request recovery before sending this explicit enqueue. */
export async function enqueueAllocationJob(input: CreateAllocationJobDTO) {
  const payload = CreateAllocationJobSchema.parse(input);
  const scope = scopeSchema.parse({
    curriculumId: payload.curriculumId,
    semester: payload.semester,
    year: payload.year,
  });
  const response = await apiClient.post<ApiResponse<unknown>>('/admin/allocation-jobs', payload);
  return verifiedJob(response.data, scope);
}

export async function getAllocationJob(id: string, input: ResourceScopeDTO) {
  const jobId = idSchema.parse(id);
  const scope = scopeSchema.parse(input);
  const response = await apiClient.get<ApiResponse<unknown>>(`/admin/allocation-jobs/${jobId}`);
  return verifiedJob(response.data, scope, jobId);
}

export async function getAllocationJobOutcome(id: string, input: ResourceScopeDTO) {
  const jobId = idSchema.parse(id);
  const scope = scopeSchema.parse(input);
  const response = await apiClient.get<ApiResponse<unknown>>(
    `/admin/allocation-jobs/${jobId}/outcome`,
  );
  return verifiedOutcome(response.data, scope, jobId);
}

export async function listAllocationJobs(input: ListAllocationJobsDTO) {
  const request = ListAllocationJobsSchema.parse(input);
  const scope = scopeSchema.parse({
    curriculumId: request.curriculumId,
    semester: request.semester,
    year: request.year,
  });
  const response = await apiClient.get<ApiResponse<unknown>>('/admin/allocation-jobs', {
    params: request,
  });
  const parsed = AllocationJobHistorySchema.safeParse(response.data?.data);
  if (
    response.data?.success !== true ||
    !parsed.success ||
    !matchesScope(parsed.data.scope, scope) ||
    parsed.data.jobs.some((job) => job.jobId === request.after)
  )
    throw new Error(verificationError);
  return parsed.data;
}

/** Lost responses keep the same selected job identity; this adapter never retries automatically. */
export async function executeAllocationJob(id: string, input: ExecuteAllocationJobDTO) {
  const jobId = idSchema.parse(id);
  const payload = ExecuteAllocationJobSchema.parse(input);
  const scope = scopeSchema.parse({
    curriculumId: payload.curriculumId,
    semester: payload.semester,
    year: payload.year,
  });
  const response = await apiClient.post<ApiResponse<unknown>>(
    `/admin/allocation-jobs/${jobId}/execute`,
    payload,
    { timeout: 20_000 },
  );
  const parsed = AllocationJobExecutionSchema.safeParse(response.data?.data);
  if (
    response.data?.success !== true ||
    !parsed.success ||
    !matchesScope(parsed.data.outcome.scope, scope) ||
    parsed.data.outcome.jobId !== jobId
  )
    throw new Error(verificationError);
  return parsed.data;
}
