import { z } from 'zod';
import type { CurriculumDetailDTO, CurriculumSummaryDTO } from '../dto/curriculum';
import { CurriculumCourseSchema } from './curriculumSemesterPreview';

const uuid = z.string().uuid();
const count = z.number().int().nonnegative().safe();
const webUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value));

/** Public reference metadata never proves degree eligibility or calendar offerings. */
export const CurriculumSummarySchema = z
  .object({
    id: uuid.transform((id) => id.toLowerCase()),
    code: z.string().min(1),
    name: z.string().min(1),
    school: z.string().min(1),
    degree: z.string().min(1),
    programUrl: webUrl,
    totalCredits: count.nullable(),
    isGpaPath: z.boolean(),
    sourceLabel: z.string().nullable(),
    sourceUrl: webUrl.nullable(),
    usage: z.literal('REFERENCE_ONLY'),
  })
  .strict() satisfies z.ZodType<CurriculumSummaryDTO>;

export const CurriculumReferencesSchema = z
  .array(CurriculumSummarySchema)
  .refine(
    (references) => new Set(references.map((reference) => reference.id)).size === references.length,
    'Duplicate curriculum reference identifiers',
  );

export const CurriculumDetailSchema = CurriculumSummarySchema.extend({
  courses: z.array(CurriculumCourseSchema),
  requirements: z.array(
    z
      .object({
        id: uuid,
        kind: z.literal('FREE_ELECTIVE'),
        name: z.string().min(1),
        credits: count,
        academicYear: z.number().int().positive().safe().nullable(),
        academicSemester: z.number().int().min(1).max(3).nullable(),
        sourceOrder: count,
        sourceLabel: z.string().nullable(),
      })
      .strict(),
  ),
  prerequisites: z.array(
    z
      .object({
        id: uuid,
        courseId: uuid,
        prerequisiteId: uuid,
        isStrict: z.boolean(),
        isCorequisite: z.boolean(),
        mandatory: z.literal(true),
      })
      .strict(),
  ),
  ratingPrior: z
    .object({
      mean: z.number().finite().min(1).max(5),
      source: z.enum(['CURRICULUM_RATINGS', 'CURRICULUM_SEED']),
    })
    .strict()
    .nullable(),
})
  .strict()
  .superRefine((detail, ctx) => {
    const unique = (ids: string[]) =>
      new Set(ids.map((id) => id.toLowerCase())).size === ids.length;
    const invalid = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const members = new Set(detail.courses.map((course) => course.id.toLowerCase()));
    if (
      !unique(detail.courses.map((course) => course.id)) ||
      new Set(detail.courses.map((course) => course.code)).size !== detail.courses.length ||
      !unique(
        detail.courses.flatMap((course) => course.placements.map((placement) => placement.id)),
      ) ||
      !unique(detail.requirements.map((requirement) => requirement.id)) ||
      !unique(detail.prerequisites.map((edge) => edge.id))
    )
      invalid('Duplicate reference identifiers');
    if ((detail.courses.length === 0) !== (detail.ratingPrior === null))
      invalid('Invalid reference rating prior');
    for (const course of detail.courses) {
      if (
        !detail.ratingPrior ||
        course.ratingPriorMean !== detail.ratingPrior.mean ||
        course.ratingPriorSource !== detail.ratingPrior.source ||
        (course.ratingCount === 0) !== (course.avgRating === null)
      )
        invalid('Inconsistent reference difficulty');
    }
    if (
      detail.prerequisites.some(
        (edge) =>
          !members.has(edge.courseId.toLowerCase()) ||
          !members.has(edge.prerequisiteId.toLowerCase()),
      ) ||
      !unique(detail.prerequisites.map((edge) => `${edge.courseId}:${edge.prerequisiteId}`))
    )
      invalid('Invalid reference prerequisite membership');
  }) satisfies z.ZodType<CurriculumDetailDTO>;
