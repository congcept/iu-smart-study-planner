import { z } from 'zod';

// A student's curriculum is a reference attachment for demonstration. It is not a
// verified cohort, a graduation rule set or an enrollment decision.
const usage = z.literal('REFERENCE_ONLY');
const uuid = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());
const studentId = z.string().trim().min(1).max(64);
const displayName = z.string().trim().min(1).max(200);
const email = z.string().trim().email().max(254);

export const ReferenceCurriculumSummarySchema = z
  .object({
    id: uuid,
    code: z.string().trim().min(1).max(32),
    name: displayName,
  })
  .strict();

export const AdminStudentSummarySchema = z
  .object({
    id: uuid,
    studentId,
    name: displayName,
    email,
    curriculumId: uuid.nullable(),
    curriculum: ReferenceCurriculumSummarySchema.nullable(),
  })
  .strict()
  .refine(
    ({ curriculumId, curriculum }) =>
      curriculumId === null ? curriculum === null : curriculum?.id === curriculumId,
    'An assigned student must reference the curriculum it is assigned to',
  );

export const AdminStudentsPageSchema = z
  .object({
    usage,
    pageSize: z.literal(50),
    after: studentId.nullable(),
    students: z.array(AdminStudentSummarySchema).max(50),
    nextAfter: studentId.nullable(),
  })
  .strict()
  .superRefine((page, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const ids = page.students.map((student) => student.studentId);
    if (new Set(ids).size !== ids.length) fail('Student identities must be distinct');
    if (page.after !== null && ids.includes(page.after))
      fail('A page must exclude the continuation it was read after');
    if (page.nextAfter !== null && (page.students.length !== 50 || page.nextAfter !== ids.at(-1)))
      fail('A continuation must identify the last student of a full page');
  });

export const ListAdminStudentsSchema = z
  .object({
    after: z.preprocess((value) => (value === '' ? undefined : value), studentId.optional()),
  })
  .strict();

/** `expectedCurriculumId` is the compare-and-swap precondition, never a rebase source. */
export const AssignReferenceCurriculumSchema = z
  .object({
    curriculumId: uuid.nullable(),
    expectedCurriculumId: uuid.nullable(),
  })
  .strict();

export const ReferenceAssignmentSchema = z
  .object({
    userId: uuid,
    curriculumId: uuid.nullable(),
    usage,
    changed: z.boolean(),
  })
  .strict();

export type ReferenceCurriculumSummaryDTO = z.infer<typeof ReferenceCurriculumSummarySchema>;
export type AdminStudentSummaryDTO = z.infer<typeof AdminStudentSummarySchema>;
export type AdminStudentsPageDTO = z.infer<typeof AdminStudentsPageSchema>;
export type ListAdminStudentsDTO = z.infer<typeof ListAdminStudentsSchema>;
export type AssignReferenceCurriculumDTO = z.infer<typeof AssignReferenceCurriculumSchema>;
export type ReferenceAssignmentDTO = z.infer<typeof ReferenceAssignmentSchema>;
