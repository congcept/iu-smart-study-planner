import { z } from 'zod';

const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((id) => id.toLowerCase());
const scope = z
  .object({
    curriculumId: uuid,
    semester: z.enum(['FALL', 'SPRING', 'SUMMER']),
    year: z.number().int().min(2000).max(2100),
  })
  .strict();

export const CreateSemesterAllocationJobSchema = scope.extend({
  requestId: uuid,
  expectedActorId: uuid,
});

/** Original enqueue receipt only. A separate executor will capture inputs later. */
export const SemesterAllocationJobSchema = z
  .object({
    id: uuid,
    kind: z.literal('SIMULATION'),
    usage: z.literal('REFERENCE_ONLY'),
    model: z.literal('SEMESTER_CREDIT_BUDGET_V1'),
    scope,
    status: z.literal('QUEUED'),
    queuedAt: z.string().datetime(),
    inputsCaptured: z.literal(false),
  })
  .strict();

export type CreateSemesterAllocationJobDTO = z.infer<typeof CreateSemesterAllocationJobSchema>;
export type SemesterAllocationJobDTO = z.infer<typeof SemesterAllocationJobSchema>;
