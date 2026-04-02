import { z } from 'zod';
import * as schemas from '../schemas';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  count?: number;
  message?: string;
  details?: unknown; // For Zod validation errors, etc.
}

// Infer DTOs from schemas
export type CreateUserDTO = z.infer<typeof schemas.CreateUserSchema>;
export type UpdateUserDTO = z.infer<typeof schemas.UpdateUserSchema>;
export type UpdateStudentRecordDTO = z.infer<typeof schemas.UpdateStudentRecordSchema>;
export type CreateCourseDTO = z.infer<typeof schemas.CreateCourseSchema>;
export type UpdateCourseDTO = z.infer<typeof schemas.UpdateCourseSchema>;
export type CreatePrerequisiteDTO = z.infer<typeof schemas.CreatePrerequisiteSchema>;
export type CreateStudyPlanDTO = z.infer<typeof schemas.CreateStudyPlanSchema>;
export type UpdateStudyPlanDTO = z.infer<typeof schemas.UpdateStudyPlanSchema>;
export type CreateSemesterDTO = z.infer<typeof schemas.CreateSemesterSchema>;
export type AnalyzeWorkloadDTO = z.infer<typeof schemas.AnalyzeWorkloadSchema>;

export type CourseStatus = z.infer<typeof schemas.CourseStatusSchema>;
export type Category = z.infer<typeof schemas.CategorySchema>;
export type Semester = z.infer<typeof schemas.SemesterSchema>;
