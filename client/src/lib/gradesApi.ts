import {
  AppendGradeAttemptSchema,
  StudentGradeScopeSchema,
  StudentGradeCoursesSchema,
  type AppendGradeAttemptDTO,
  type ApiResponse,
  type StudentGradesDTO,
  type StudentGradeCoursesDTO,
} from '@iu-study-planner/shared';
import apiClient from './api';

function readGrades(response: ApiResponse<StudentGradesDTO>): StudentGradesDTO {
  if (!response.success || !response.data)
    throw new Error(response.error || 'Could not load grades');
  if (response.data.scope !== undefined) {
    const scope = StudentGradeScopeSchema.safeParse(response.data.scope);
    if (!scope.success || (!scope.data.isGpaPath && response.data.summary?.gpaPath !== null))
      throw new Error('Could not verify the grade summary scope');
    return { ...response.data, scope: scope.data };
  }
  return response.data;
}

export async function getStudentGrades(): Promise<StudentGradesDTO> {
  const response = await apiClient.get<ApiResponse<StudentGradesDTO>>('/users/me/grades');
  return readGrades(response.data);
}

export async function getStudentGradeCourses(
  expectedUserId: string,
): Promise<StudentGradeCoursesDTO> {
  const response = await apiClient.get<ApiResponse<unknown>>('/users/me/grades/courses');
  const parsed = StudentGradeCoursesSchema.safeParse(response.data?.data);
  if (
    response.data?.success !== true ||
    !parsed.success ||
    parsed.data.scope.userId !== expectedUserId.toLowerCase()
  )
    throw new Error('Could not verify grade-entry courses for your account');
  return parsed.data;
}

export async function appendStudentGrade(data: AppendGradeAttemptDTO): Promise<StudentGradesDTO> {
  const response = await apiClient.post<ApiResponse<StudentGradesDTO>>(
    '/users/me/grades',
    AppendGradeAttemptSchema.parse(data),
  );
  return readGrades(response.data);
}
