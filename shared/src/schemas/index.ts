import { z } from 'zod';
import { createCohortResourceSnapshotSchema } from './cohortResourceSnapshot';
import { createPlannedDemandSnapshotSchema } from './plannedDemand';
import { createEligibleCohortDemandSnapshotSchema } from './eligibleCohortDemand';
import { createSimulationCapacitySnapshotSchema } from './simulationCapacity';
import { createSimulationResourceEnvelopeSchema } from './simulationResourceEnvelope';
import {
  createSimulationAllocationResultSchema,
  SimulationAllocationPolicySchema,
} from './simulationAllocation';
import { createAllocationPreviewSchema } from './allocationPreview';
export {
  CreateAllocationJobSchema,
  AllocationJobSchema,
  type CreateAllocationJobDTO,
  type AllocationJobDTO,
} from './allocationJob';
export { AllocationJobOutcomeSchema, type AllocationJobOutcomeDTO } from './allocationJobOutcome';
export {
  ListAllocationRunsSchema,
  AllocationRunHistorySchema,
  type ListAllocationRunsDTO,
  type AllocationRunHistoryDTO,
} from './allocationRunHistory';
export {
  AllocationRunSummaryV1Schema,
  AllocationRunV1Schema,
  type AllocationRunSummaryV1DTO,
  type AllocationRunV1DTO,
} from './allocationRunV1';
export {
  AllocationUtilityPolicySchema,
  type AllocationUtilityPolicyDTO,
} from './allocationUtility';

export { ContextStudentProgressSchema } from './contextStudentProgress';
export {
  CurriculumDetailSchema,
  CurriculumSummarySchema,
  CurriculumReferencesSchema,
} from './curriculumDetail';
export { CurriculumSemesterPreviewSchema } from './curriculumSemesterPreview';
export { SimulationResourcePolicySchema } from './simulationResourceEnvelope';
export { EligibleCohortDemandPolicySchema } from './eligibleCohortDemand';
export {
  SimulationAllocationPolicySchema,
  SimulationAllocationRosterSchema,
} from './simulationAllocation';

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

// A precondition, never an instruction to change the authenticated account/context.
export const AccountWriteScopeSchema = z
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
  })
  .strict();

export const RateCourseSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    expectedScope: AccountWriteScopeSchema.optional(),
  })
  .strict();

// Global vote history is preserved; current scope does not imply course eligibility.
export const ScopedOwnCourseRatingsSchema = z
  .object({
    scope: AccountWriteScopeSchema,
    ratings: z
      .array(
        z
          .object({
            courseId: z
              .string()
              .uuid()
              .transform((id) => id.toLowerCase()),
            rating: z.number().int().min(1).max(5),
          })
          .strict(),
      )
      .refine(
        (votes) => new Set(votes.map(({ courseId }) => courseId)).size === votes.length,
        'Personal votes must have unique course identities',
      ),
  })
  .strict();

const RatingCourseChoiceSchema = z
  .object({
    id: z
      .string()
      .uuid()
      .transform((id) => id.toLowerCase()),
    code: z.string().min(1),
    name: z.string().min(1),
    avgRating: z.number().finite().min(1).max(5).nullable(),
    ratingCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    ratingDifficulty: z.number().finite().min(1).max(5),
    ratingPriorMean: z.number().finite().min(1).max(5),
    ratingPriorSource: z.enum([
      'GLOBAL_RATINGS',
      'GLOBAL_SEED',
      'CURRICULUM_RATINGS',
      'CURRICULUM_SEED',
    ]),
    yourRating: z.number().int().min(1).max(5).nullable(),
    membership: z.enum(['CURRENT_CURRICULUM', 'OTHER_HISTORY', 'UNASSIGNED']),
  })
  .strict()
  .refine(
    (course) =>
      (course.avgRating === null) === (course.ratingCount === 0) &&
      (course.yourRating === null || course.ratingCount > 0),
    'Rating evidence is inconsistent',
  );

export const RatingCourseChoicesSchema = z
  .object({
    scope: AccountWriteScopeSchema,
    courses: z
      .array(RatingCourseChoiceSchema)
      .refine(
        (courses) =>
          new Set(courses.map(({ id }) => id)).size === courses.length &&
          new Set(courses.map(({ code }) => code)).size === courses.length,
        'Rating course identities must be unique',
      ),
  })
  .strict()
  .refine(
    ({ scope, courses }) =>
      courses.every((course) => {
        const global =
          course.ratingPriorSource === 'GLOBAL_RATINGS' ||
          course.ratingPriorSource === 'GLOBAL_SEED';
        return scope.curriculumId === null
          ? course.membership === 'UNASSIGNED' && global
          : (course.membership === 'CURRENT_CURRICULUM' && !global) ||
              (course.membership === 'OTHER_HISTORY' && global);
      }),
    'Rating course membership and prior must match account scope',
  );

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
    expectedScope: AccountWriteScopeSchema.optional(),
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
  .extend({
    status: z.enum(['COMPLETED', 'PLANNED', 'DROPPED']).default('COMPLETED'),
    expectedScope: AccountWriteScopeSchema.optional(),
  })
  .strict();

export const UpsertProgressSchema = z
  .object({
    completedIds: z.record(z.string().uuid(), z.string().trim().min(1).max(100).nullable()),
    plannedIds: z.array(z.string().uuid()).max(500),
    expectedScope: AccountWriteScopeSchema.optional(),
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

export const ScopedStudentProgressSchema = z
  .object({
    scope: AccountWriteScopeSchema,
    progress: z
      .object({
        completedIds: z
          .record(z.string().uuid(), z.string().nullable())
          .refine(
            (records) =>
              new Set(Object.keys(records).map((id) => id.toLowerCase())).size ===
              Object.keys(records).length,
            'Completed course identities must be unique',
          )
          .transform((records) =>
            Object.fromEntries(
              Object.entries(records).map(([id, claim]) => [id.toLowerCase(), claim]),
            ),
          ),
        plannedIds: z
          .array(z.string().uuid())
          .refine(
            (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
            'Planned course identities must be unique',
          )
          .transform((ids) => ids.map((id) => id.toLowerCase())),
      })
      .strict()
      .refine(
        (data) => data.plannedIds.every((id) => !Object.hasOwn(data.completedIds, id)),
        'A saved course cannot be completed and planned',
      ),
  })
  .strict();

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

export const CreateSemesterSchema = z
  .object({
    semester: SemesterSchema,
    year: z.number().int(),
    courses: z
      .array(
        z
          .object({
            courseId: z
              .string()
              .uuid()
              .transform((id) => id.toLowerCase()),
            position: z.number().int(),
          })
          .strict(),
      )
      .superRefine((courses, ctx) => {
        const seen = new Set<string>();
        courses.forEach(({ courseId }, index) => {
          if (seen.has(courseId))
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [index, 'courseId'],
              message: 'A course may appear only once in a semester',
            });
          seen.add(courseId);
        });
      }),
    expectedScope: AccountWriteScopeSchema.optional(),
  })
  .strict();

export const UpdateSemesterSchema = CreateSemesterSchema.partial().refine(
  (data) => data.semester !== undefined || data.year !== undefined || data.courses !== undefined,
  { message: 'At least one semester field must be provided' },
);

// These bounds protect storage and arithmetic; they are not university capacity rules.
const ResourceCountSchema = z.number().int().min(0).max(100000);
const ResourceUuidSchema = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());
export const ResourceScopeSchema = z
  .object({
    curriculumId: ResourceUuidSchema,
    semester: SemesterSchema,
    year: z.number().int().min(2000).max(2100),
  })
  .strict();
export const CreateAllocationRunSchema = ResourceScopeSchema.extend({
  requestId: ResourceUuidSchema,
  expectedActorId: ResourceUuidSchema.optional(),
});
const CourseResourceOverrideSchema = z
  .object({
    capacity: ResourceCountSchema.optional(),
    professorCount: ResourceCountSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.capacity !== undefined || value.professorCount !== undefined,
    'A course override must specify capacity or professor count',
  );
const ResourceOverridesSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(100)
      .refine(
        (code) => code === code.trim() && !['__proto__', 'prototype', 'constructor'].includes(code),
        'Course codes must be canonical safe keys',
      ),
    CourseResourceOverrideSchema,
  )
  .refine((value) => Object.keys(value).length <= 500, 'Too many course overrides');
const ResourceSettingsSchema = ResourceScopeSchema.extend({
  professors: ResourceCountSchema,
  classrooms: ResourceCountSchema,
  labRooms: ResourceCountSchema,
  maxStudentsPerSection: z.number().int().min(1).max(100000),
  courseOverrides: ResourceOverridesSchema,
});
export const UpsertResourcesSchema = ResourceSettingsSchema.extend({
  expectedRevision: z.number().int().min(0).max(2147483647),
});
const SchoolResourceSchema = ResourceSettingsSchema.extend({
  id: ResourceUuidSchema,
  revision: z.number().int().min(1).max(2147483647),
  updatedBy: ResourceUuidSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const ResourcesSnapshotSchema = z
  .object({
    kind: z.literal('SIMULATION'),
    curriculum: z
      .object({
        id: ResourceUuidSchema,
        code: z.string().min(1),
        name: z.string().min(1),
        school: z.string().min(1),
      })
      .strict(),
    semester: SemesterSchema,
    year: ResourceScopeSchema.shape.year,
    resource: SchoolResourceSchema.nullable(),
  })
  .strict()
  .refine(
    (snapshot) =>
      snapshot.resource === null ||
      (snapshot.resource.curriculumId === snapshot.curriculum.id &&
        snapshot.resource.semester === snapshot.semester &&
        snapshot.resource.year === snapshot.year),
    'Resource configuration must match its curriculum and semester',
  );

export const PlannedDemandSnapshotSchema = createPlannedDemandSnapshotSchema(ResourceScopeSchema);
export const EligibleCohortDemandSnapshotSchema =
  createEligibleCohortDemandSnapshotSchema(ResourceScopeSchema);
export const SimulationCapacitySnapshotSchema = createSimulationCapacitySnapshotSchema(
  PlannedDemandSnapshotSchema,
);
export const SimulationResourceEnvelopeSchema = createSimulationResourceEnvelopeSchema(
  ResourceScopeSchema,
  ResourcesSnapshotSchema.innerType().shape.curriculum,
);
export const CohortResourceSnapshotSchema = createCohortResourceSnapshotSchema(
  EligibleCohortDemandSnapshotSchema,
  SimulationResourceEnvelopeSchema,
);
export const SimulationAllocationResultSchema = createSimulationAllocationResultSchema(
  SimulationResourceEnvelopeSchema,
);

export const AllocationPreviewSchema = createAllocationPreviewSchema(
  CohortResourceSnapshotSchema,
  SimulationAllocationPolicySchema,
);

export const PlanSemesterSchema = z
  .object({
    intensityMode: z.enum(['low', 'normal', 'high', 'max']),
    completedCourseIds: z.array(z.string()).optional(),
  })
  .strict();
