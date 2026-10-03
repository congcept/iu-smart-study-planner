import {
  CurriculumDetailSchema,
  type ApiResponse,
  type CurriculumDetailDTO,
} from '@iu-study-planner/shared';
import apiClient from './api';

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
