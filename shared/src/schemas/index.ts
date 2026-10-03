import { z } from 'zod';

export { CurriculumDetailSchema } from './curriculumDetail';
export { CurriculumSemesterPreviewSchema } from './curriculumSemesterPreview';

export const PaginationQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional(),
});

export const CurriculumParamsSchema = z
  .object({
    id: z
      .string()
      .uuid()
      .transform((id) => id.toLowerCase()),
  })
  .strict();

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

export const StudentGradeScopeSchema = z
  .object({
    userId: z
      .string()
      .uuid()
      .transform((id) => id.toLowerCase()),
    curriculumId: z
      .string()
      .uuid()
      .transform((id) => id.toLowerCase())
      .nullable(),
    isGpaPath: z.boolean(),
  })
  .strict()
  .refine((scope) => scope.curriculumId !== null || scope.isGpaPath, {
    message: 'Unassigned accounts retain the legacy GPA path policy',
  });

export const StudentGradeCoursesSchema = z
  .object({
    scope: StudentGradeScopeSchema,
    courses: z.array(
      z
        .object({
          id: z
            .string()
            .uuid()
            .transform((id) => id.toLowerCase()),
          code: z.string().min(1),
          name: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict()
  .refine(
    (data) =>
      new Set(data.courses.map(({ id }) => id)).size === data.courses.length &&
      new Set(data.courses.map(({ code }) => code)).size === data.courses.length,
    {
      message: 'Grade course identities must be unique',
    },
  );

export const RateCourseSchema = z.object({ rating: z.number().int().min(1).max(5) }).strict();

export const CourseRatingQuerySchema = z
  .object({
    curriculumId: z
      .string()
      .uuid()
      .transform((id) => id.toLowerCase())
      .optional(),
  })
  .strict();

export const AppendGradeAttemptSchema = z
  .object({
    courseId: z
      .string()
      .uuid()
      .transform((id) => id.toLowerCase()),
    requestId: z
      .string()
      .uuid()
      .transform((id) => id.toLowerCase()),
    score: z.number().finite().min(0).max(100),
    semester: SemesterSchema.optional(),
    year: z.number().int().min(2000).max(2100).optional(),
  })
  .strict();

// Users
export const UserRoleSchema = z.enum(['STUDENT', 'ADMIN']);

const AuthPasswordSchema = z
  .string()
  .min(8)
  .refine(
    (password) => new TextEncoder().encode(password).length <= 72,
    'Password must be at most 72 UTF-8 bytes',
  );

export const RegisterSchema = z
  .object({
    studentId: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(200),
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((email) => email.toLowerCase()),
    password: AuthPasswordSchema,
  })
  .strict();

export const LoginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((email) => email.toLowerCase()),
    password: AuthPasswordSchema,
  })
  .strict();

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
  electiveGroup: z.string().trim().min(1).max(100).nullable().optional(),
});

export const CompleteCourseSchema = UpdateStudentRecordSchema.pick({
  courseId: true,
  electiveGroup: true,
})
  .extend({ status: z.enum(['COMPLETED', 'PLANNED', 'DROPPED']).default('COMPLETED') })
  .strict();

export const UpsertProgressSchema = z
  .object({
    completedIds: z.record(z.string().uuid(), z.string().trim().min(1).max(100).nullable()),
    plannedIds: z.array(z.string().uuid()).max(500),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (Object.keys(data.completedIds).length > 500) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['completedIds'],
        message: 'Import at most 500 completed courses at a time',
      });
    }
    const plannedIds = new Set<string>();
    for (const [index, id] of data.plannedIds.entries()) {
      if (plannedIds.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['plannedIds', index],
          message: 'Planned courses must not contain duplicates',
        });
      }
      if (Object.hasOwn(data.completedIds, id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['plannedIds', index],
          message: 'A course cannot be both completed and planned',
        });
      }
      plannedIds.add(id);
    }
  });

export const ToggleStudentRecordSchema = UpdateStudentRecordSchema.pick({
  courseId: true,
  status: true,
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
  academicYear: z.number().int().min(1).max(4).optional(),
  academicSemester: z.number().int().min(1).max(3).optional(),
  electiveGroup: z.string().optional(),
  electiveSelectCount: z.number().int().min(0).max(10).optional(),
});

export const DemoLoginSchema = z.object({ role: UserRoleSchema }).strict();

export const UpdateCourseSchema = CreateCourseSchema.partial();

export const UpdateUserSchema = z
  .object({
    studentId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    major: z.string().optional(),
    enrollmentYear: z.number().int().min(2000).max(2100).optional(),
    targetGraduationYear: z.number().int().min(2000).max(2100).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export const CreatePrerequisiteSchema = z.object({
  courseId: z.string().uuid(),
  prerequisiteId: z.string().uuid(),
  isCorequisite: z.boolean().optional(),
  isStrict: z.boolean().optional(),
});

// Recommendations
export const AnalyzeWorkloadSchema = z
  .object({
    courseIds: z
      .array(
        z
          .string()
          .uuid()
          .transform((id) => id.toLowerCase()),
      )
      .min(1),
  })
  .strict();

// Study Plans
export const CreateStudyPlanSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
});

export const UpdateStudyPlanSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
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

export const PlanSemesterSchema = z
  .object({
    intensityMode: z.enum(['low', 'normal', 'high', 'max']),
    completedCourseIds: z.array(z.string()).optional(),
  })
  .strict();
