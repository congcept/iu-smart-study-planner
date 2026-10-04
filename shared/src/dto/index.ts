import { z } from 'zod';
import * as schemas from '../schemas';

export * from './curriculum';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  count?: number;
  message?: string;
  details?: unknown; // For Zod validation errors, etc.
}

// Infer DTOs from schemas
export type RegisterDTO = z.infer<typeof schemas.RegisterSchema>;
export type LoginDTO = z.infer<typeof schemas.LoginSchema>;
export type DemoLoginDTO = z.infer<typeof schemas.DemoLoginSchema>;
export type CompleteCourseDTO = z.infer<typeof schemas.CompleteCourseSchema>;
export type AccountWriteScopeDTO = z.infer<typeof schemas.AccountWriteScopeSchema>;
export type RatingCourseChoicesDTO = z.infer<typeof schemas.RatingCourseChoicesSchema>;
export type RatingCourseChoiceDTO = RatingCourseChoicesDTO['courses'][number];
export type ScopedOwnCourseRatingsDTO = z.infer<typeof schemas.ScopedOwnCourseRatingsSchema>;
export type ScopedStudentProgressDTO = z.infer<typeof schemas.ScopedStudentProgressSchema>;
export type UpsertProgressDTO = z.infer<typeof schemas.UpsertProgressSchema>;
export type RateCourseDTO = z.infer<typeof schemas.RateCourseSchema>;
export type RatingPriorSource =
  | 'GLOBAL_RATINGS'
  | 'GLOBAL_SEED'
  | 'CURRICULUM_RATINGS'
  | 'CURRICULUM_SEED';
export interface CourseDifficultyDTO {
  avgRating: number | null;
  ratingCount: number;
  ratingDifficulty: number;
  ratingPriorMean: number;
  ratingPriorSource: RatingPriorSource;
}
export interface CourseRatingsDTO {
  average: number | null;
  count: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  difficulty: number;
  priorMean: number;
  priorSource: RatingPriorSource;
}
export interface OwnCourseRatingDTO {
  courseId: string;
  rating: number;
}
export interface SubmittedCourseRatingDTO extends CourseRatingsDTO {
  yourRating: number;
}
export type AppendGradeAttemptDTO = z.infer<typeof schemas.AppendGradeAttemptSchema>;
export interface GradeAttemptDTO {
  id: string;
  requestId: string;
  courseId: string;
  score: number;
  semester: Semester | null;
  year: number | null;
  createdAt: string;
  course: { id: string; code: string; name: string; credits: number };
}
export type GpaPath = 'THESIS' | 'ALTERNATIVE';
export interface RecommendationStatsDTO {
  gpaPath: GpaPath | null;
  totalAvailable: number;
  filteredCount: number;
  recommendedCount: number;
  totalRecommendedCredits: number;
  averageDifficulty: number;
}

export interface WorkloadScopeDTO {
  curriculumId: string | null;
  categoryBalanceAvailable: boolean;
  ratingPrior: { mean: number; source: RatingPriorSource };
}

export interface StudentGradesDTO {
  /** Current server replies include scope; older persisted snapshots may omit it. */
  scope?: { userId: string; curriculumId: string | null; isGpaPath: boolean };
  attempts: GradeAttemptDTO[];
  summary: {
    gpa100: number | null;
    gpaPath: GpaPath | null;
    gradedCredits: number;
    gradedCourseCount: number;
    courseScores: { courseId: string; score: number; credits: number }[];
  };
  completedCoursesWithoutNumericGrades: string[];
}
export interface StudentProgressDTO {
  completedIds: Record<string, string | null>;
  plannedIds: string[];
}
export interface StudentGradeCoursesDTO {
  scope: NonNullable<StudentGradesDTO['scope']>;
  courses: { id: string; code: string; name: string }[];
}
export interface CompleteCourseResponseDTO extends StudentProgressDTO {
  uncompletedCourseIds: string[];
}
export interface DemoLoginStatusDTO {
  enabled: boolean;
}
export type UserRole = z.infer<typeof schemas.UserRoleSchema>;
export interface AuthUserDTO {
  id: string;
  studentId: string;
  name: string;
  email: string;
  role: UserRole;
  /** Server replies always include this; older cached sessions may omit it. */
  curriculumId?: string | null;
}
export interface AuthResponseDTO {
  user: AuthUserDTO;
}

export type CreateUserDTO = z.infer<typeof schemas.CreateUserSchema>;
export type UpdateUserDTO = z.infer<typeof schemas.UpdateUserSchema>;
export type UpdateStudentRecordDTO = z.infer<typeof schemas.UpdateStudentRecordSchema>;
export type CreateCourseDTO = z.infer<typeof schemas.CreateCourseSchema>;
export type UpdateCourseDTO = z.infer<typeof schemas.UpdateCourseSchema>;
export type CreatePrerequisiteDTO = z.infer<typeof schemas.CreatePrerequisiteSchema>;
export type CreateStudyPlanDTO = z.infer<typeof schemas.CreateStudyPlanSchema>;
export type UpdateStudyPlanDTO = z.infer<typeof schemas.UpdateStudyPlanSchema>;
export type CreateSemesterDTO = z.infer<typeof schemas.CreateSemesterSchema>;
export type ResourceScopeDTO = z.infer<typeof schemas.ResourceScopeSchema>;
export type UpsertResourcesDTO = z.infer<typeof schemas.UpsertResourcesSchema>;
export type ResourcesSnapshotDTO = z.infer<typeof schemas.ResourcesSnapshotSchema>;
export type PlannedDemandSnapshotDTO = z.infer<typeof schemas.PlannedDemandSnapshotSchema>;
export type SimulationCapacitySnapshotDTO = z.infer<
  typeof schemas.SimulationCapacitySnapshotSchema
>;
export type SimulationResourcePolicyDTO = z.infer<typeof schemas.SimulationResourcePolicySchema>;
export type SimulationResourceEnvelopeDTO = z.infer<
  typeof schemas.SimulationResourceEnvelopeSchema
>;
export type AnalyzeWorkloadDTO = z.infer<typeof schemas.AnalyzeWorkloadSchema>;

export type CourseStatus = z.infer<typeof schemas.CourseStatusSchema>;
export type Category = z.infer<typeof schemas.CategorySchema>;
export type Semester = z.infer<typeof schemas.SemesterSchema>;

export interface SemesterPlanSlotDTO {
  year: number;
  semester: number;
  recommendedCourseIds: string[];
  totalCredits: number;
}
export interface SemesterPlanningDTO {
  semesters: SemesterPlanSlotDTO[];
  nextRecommendedIds: string[];
  stats: {
    totalRemainingCredits: number;
    planningComplete: boolean;
    unplannedCourseIds: string[];
    plannedSemesterCount: number;
    semestersToCompletion: number | null;
    estimatedGraduationSemester: string | null;
  };
}

export type PlanSemesterDTO = z.infer<typeof schemas.PlanSemesterSchema>;
