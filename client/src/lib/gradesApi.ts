import {
  AppendGradeAttemptSchema,
  type AppendGradeAttemptDTO,
  type ApiResponse,
  type StudentGradesDTO,
} from '@iu-study-planner/shared';
import apiClient from './api';

function readGrades(response: ApiResponse<StudentGradesDTO>): StudentGradesDTO {
  if (!response.success || !response.data)
    throw new Error(response.error || 'Could not load grades');
  return response.data;
}

export async function getStudentGrades(): Promise<StudentGradesDTO> {
  const response = await apiClient.get<ApiResponse<StudentGradesDTO>>('/users/me/grades');
  return readGrades(response.data);
}

export async function appendStudentGrade(data: AppendGradeAttemptDTO): Promise<StudentGradesDTO> {
  const response = await apiClient.post<ApiResponse<StudentGradesDTO>>(
    '/users/me/grades',
    AppendGradeAttemptSchema.parse(data),
  );
  return readGrades(response.data);
}
