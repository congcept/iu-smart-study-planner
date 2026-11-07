import {
  AdminStudentsPageSchema,
  AssignReferenceCurriculumSchema,
  ReferenceAssignmentSchema,
  type AdminStudentsPageDTO,
  type AssignReferenceCurriculumDTO,
  type ApiResponse,
  type ReferenceAssignmentDTO,
} from '@iu-study-planner/shared';
import apiClient from './api';

export async function listAssignableStudents(after?: string): Promise<AdminStudentsPageDTO> {
  const response = await apiClient.get<ApiResponse<unknown>>('/admin/users/students', {
    params: after === undefined ? undefined : { after },
  });
  const parsed = AdminStudentsPageSchema.safeParse(response.data?.data);
  if (response.data?.success !== true || !parsed.success || parsed.data.after !== (after ?? null))
    throw new Error('Could not verify the student account list. Reload to try again.');
  return parsed.data;
}

export async function assignReferenceCurriculum(
  userId: string,
  input: AssignReferenceCurriculumDTO,
): Promise<ReferenceAssignmentDTO> {
  const payload = AssignReferenceCurriculumSchema.parse(input);
  const response = await apiClient.post<ApiResponse<unknown>>(
    `/admin/users/students/${userId.toLowerCase()}/curriculum`,
    payload,
  );
  const parsed = ReferenceAssignmentSchema.safeParse(response.data?.data);
  if (
    response.data?.success !== true ||
    !parsed.success ||
    parsed.data.userId !== userId.toLowerCase() ||
    parsed.data.curriculumId !== payload.curriculumId
  )
    throw new Error(
      'Could not confirm the reference curriculum assignment. Reload to check the account.',
    );
  return parsed.data;
}
