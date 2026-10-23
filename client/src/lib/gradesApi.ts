import {
  AppendGradeAttemptSchema,
  StudentGradeScopeSchema,
  StudentGradeCoursesSchema,
  StudentSemesterGradesSchema,
  type AppendGradeAttemptDTO,
  type ApiResponse,
  type StudentGradesDTO,
  type StudentGradeCoursesDTO,
} from '@iu-study-planner/shared';
import apiClient from './api';

function readGrades(response: ApiResponse<StudentGradesDTO>): StudentGradesDTO {
  if (!response.success || !response.data)
    throw new Error(response.error || 'Could not load grades');
  let grades = response.data;
  if (grades.scope !== undefined) {
    const scope = StudentGradeScopeSchema.safeParse(grades.scope);
    if (!scope.success || (!scope.data.isGpaPath && grades.summary?.gpaPath !== null))
      throw new Error('Could not verify the grade summary scope');
    grades = { ...grades, scope: scope.data };
  }
  if (grades.semesterGrades !== undefined) {
    const semesterGrades = StudentSemesterGradesSchema.safeParse(grades.semesterGrades);
    if (!semesterGrades.success)
      throw new Error('Could not verify the recorded semester GPA summary');
    grades = { ...grades, semesterGrades: semesterGrades.data };
  }
  return grades;
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
  const payload = AppendGradeAttemptSchema.parse(data);
  const response = await apiClient.post<ApiResponse<StudentGradesDTO>>('/users/me/grades', payload);
  const grades = readGrades(response.data);
  if (payload.expectedScope && grades.scope?.userId !== payload.expectedScope.userId)
    throw new Error('Could not verify the saved grade owner');
  return grades;
}
