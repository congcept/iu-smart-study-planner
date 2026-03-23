import { z } from 'zod';

export const IdSchema = z.string().uuid().or(z.number().int().positive());

export const PaginationQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional(),
});

// Enums
export const CourseStatusSchema = z.enum([
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'DROPPED',
]);
export const CategorySchema = z.enum([
  'REQUIRED',
  'ELECTIVE',
  'CORE',
  'MAJOR_ELECTIVE',
  'GENERAL_EDUCATION',
  'FREE_ELECTIVE',
]);
export const SemesterSchema = z.enum(['FALL', 'SPRING', 'SUMMER']);

// Users
export const CreateUserSchema = z.object({
  studentId: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  major: z.string().optional(),
  enrollmentYear: z.number().int().min(2000).max(2100).optional(),
  targetGraduationYear: z.number().int().min(2000).max(2100).optional(),
});

export const UpdateStudentRecordSchema = z.object({
  courseId: z.string().uuid(),
  grade: z.string().optional(),
  gradePoints: z.number().min(0).max(4).optional(),
  semester: z.string().optional(),
  year: z.number().int().optional(),
  status: CourseStatusSchema,
});

// Courses
export const CreateCourseSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  credits: z.number().int().min(0).max(10),
  difficultyLevel: z.number().int().min(1).max(5),
  description: z.string().optional(),
  category: CategorySchema.optional(),
  semesterOffered: z.array(SemesterSchema).optional(),
});

export const CreatePrerequisiteSchema = z.object({
  courseId: z.string().uuid(),
  prerequisiteId: z.string().uuid(),
  isCorequisite: z.boolean().optional(),
  isStrict: z.boolean().optional(),
});

// Recommendations
export const AnalyzeWorkloadSchema = z.object({
  courseIds: z.array(z.string().uuid()).min(1),
});

// Study Plans
export const CreateStudyPlanSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
});

export const CreateSemesterSchema = z.object({
  semester: SemesterSchema,
  year: z.number().int(),
  courses: z.array(
    z.object({
      courseId: z.string().uuid(),
      position: z.number().int(),
    }),
  ),
});
