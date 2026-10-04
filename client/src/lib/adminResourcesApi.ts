import {
  ResourceScopeSchema,
  UpsertResourcesSchema,
  ResourcesSnapshotSchema,
  PlannedDemandSnapshotSchema,
  SimulationCapacitySnapshotSchema,
  type ResourceScopeDTO,
  type UpsertResourcesDTO,
  type ResourcesSnapshotDTO,
  type ApiResponse,
} from '@iu-study-planner/shared';
import apiClient from './api';

function verified(response: ApiResponse<unknown>, scope: ResourceScopeDTO): ResourcesSnapshotDTO {
  const parsed = ResourcesSnapshotSchema.safeParse(response?.data);
  if (
    response?.success !== true ||
    !parsed.success ||
    parsed.data.curriculum.id !== scope.curriculumId ||
    parsed.data.semester !== scope.semester ||
    parsed.data.year !== scope.year
  )
    throw new Error('Could not verify simulation resource settings. Reload to try again.');
  return parsed.data;
}
export async function getResources(input: ResourceScopeDTO) {
  const scope = ResourceScopeSchema.parse(input);
  const response = await apiClient.get<ApiResponse<unknown>>('/admin/resources', { params: scope });
  return verified(response.data, scope);
}
export async function saveResources(input: UpsertResourcesDTO) {
  const payload = UpsertResourcesSchema.parse(input);
  const scope = ResourceScopeSchema.parse({
    curriculumId: payload.curriculumId,
    semester: payload.semester,
    year: payload.year,
  });
  const response = await apiClient.post<ApiResponse<unknown>>('/admin/resources', payload);
  const saved = verified(response.data, scope);
  if (
    !saved.resource ||
    saved.resource.revision !== payload.expectedRevision + 1 ||
    saved.resource.updatedBy === null
  )
    throw new Error(
      'Could not confirm the simulation resource save. Reload to check its revision.',
    );
  return saved;
}

export async function getPlannedDemand(input: ResourceScopeDTO) {
  const scope = ResourceScopeSchema.parse(input);
  const response = await apiClient.get<ApiResponse<unknown>>('/admin/demand', { params: scope });
  const parsed = PlannedDemandSnapshotSchema.safeParse(response.data?.data);
  if (
    response.data?.success !== true ||
    !parsed.success ||
    parsed.data.scope.curriculumId !== scope.curriculumId ||
    parsed.data.scope.semester !== scope.semester ||
    parsed.data.scope.year !== scope.year
  )
    throw new Error('Could not verify simulated planned selections. Reload to try again.');
  return parsed.data;
}

export async function getSimulationCapacity(input: ResourceScopeDTO) {
  const scope = ResourceScopeSchema.parse(input);
  const response = await apiClient.get<ApiResponse<unknown>>('/admin/capacity', { params: scope });
  const parsed = SimulationCapacitySnapshotSchema.safeParse(response.data?.data);
  if (
    response.data?.success !== true ||
    !parsed.success ||
    parsed.data.plannedSelections.scope.curriculumId !== scope.curriculumId ||
    parsed.data.plannedSelections.scope.semester !== scope.semester ||
    parsed.data.plannedSelections.scope.year !== scope.year
  )
    throw new Error('Could not verify simulation capacity. Reload to try again.');
  return parsed.data;
}
