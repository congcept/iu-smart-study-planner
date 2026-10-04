import {
  CurriculumDetailSchema,
  CurriculumReferencesSchema,
  ContextStudentProgressSchema,
  type ContextStudentProgressDTO,
  type ApiResponse,
  type CurriculumDetailDTO,
  type CurriculumSummaryDTO,
} from '@iu-study-planner/shared';
import apiClient from './api';

export async function getCurriculumReferences(): Promise<CurriculumSummaryDTO[]> {
  const response = await apiClient.get<ApiResponse<unknown>>('/curricula');
  const parsed = CurriculumReferencesSchema.safeParse(response.data?.data);
  if (response.data?.success !== true || !parsed.success)
    throw new Error('Could not verify curriculum references.');
  return parsed.data;
}

export async function getCurriculumReference(curriculumId: string): Promise<CurriculumDetailDTO> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(curriculumId))
    throw new Error('Could not verify your curriculum reference.');
  const response = await apiClient.get<ApiResponse<unknown>>(
    `/curricula/${curriculumId.toLowerCase()}`,
  );
  const parsed = CurriculumDetailSchema.safeParse(response.data?.data);
  if (
    response.data?.success !== true ||
    !parsed.success ||
    parsed.data.id.toLowerCase() !== curriculumId.toLowerCase()
  )
    throw new Error('Could not verify your curriculum reference.');
  return parsed.data;
}

export async function getContextStudentProgress(
  userId: string,
  curriculumId: string,
): Promise<ContextStudentProgressDTO> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(userId) || !uuid.test(curriculumId))
    throw new Error('Could not verify your curriculum progress.');
  const response = await apiClient.get<ApiResponse<unknown>>(
    `/users/${userId.toLowerCase()}/progress`,
  );
  const parsed = ContextStudentProgressSchema.safeParse(response.data?.data);
  if (
    response.data?.success !== true ||
    !parsed.success ||
    parsed.data.scope.userId.toLowerCase() !== userId.toLowerCase() ||
    parsed.data.scope.curriculumId.toLowerCase() !== curriculumId.toLowerCase()
  )
    throw new Error('Could not verify your curriculum progress.');
  return parsed.data;
}
