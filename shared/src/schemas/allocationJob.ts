import { z } from 'zod';

const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((id) => id.toLowerCase());

// Keep this module independent of the schemas barrel to avoid initialization cycles.
const scopeSchema = z
  .object({
    curriculumId: uuid,
    semester: z.enum(['FALL', 'SPRING', 'SUMMER']),
    year: z.number().int().min(2000).max(2100),
  })
  .strict();

export const CreateAllocationJobSchema = scopeSchema.extend({
  requestId: uuid,
  expectedActorId: uuid,
});

// A durable request is queued only. This contract makes no execution or capture claim.
export const AllocationJobSchema = z
  .object({
    id: uuid,
    kind: z.literal('SIMULATION'),
    usage: z.literal('REFERENCE_ONLY'),
    scope: scopeSchema,
    status: z.literal('QUEUED'),
    queuedAt: z.string().datetime(),
    inputsCaptured: z.literal(false),
  })
  .strict();

export type CreateAllocationJobDTO = z.infer<typeof CreateAllocationJobSchema>;
export type AllocationJobDTO = z.infer<typeof AllocationJobSchema>;
