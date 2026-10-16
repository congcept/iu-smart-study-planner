import { z } from 'zod';
import { OwnStudyPlanCoursesSchema } from './ownStudyPlanCourses';

const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((id) => id.toLowerCase());
const referenceSlot = z
  .object({
    academicYear: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    academicSemester: z.number().int().min(1).max(3),
  })
  .strict();

export const OwnStudyPlanReferenceReviewBodySchema = referenceSlot
  .extend({
    expectedScope: z.object({ userId: uuid, curriculumId: uuid.nullable() }).strict(),
  })
  .strict();

export const SavedCourseReferenceBlockerSchema = z.enum([
  'NO_CURRENT_PLACEMENT',
  'NO_MATCHING_REFERENCE_SLOT',
  'GPA_EXCLUDED',
  'GPA_UNDETERMINED',
  'UNMET_PREREQUISITE',
]);

const entry = z
  .object({
    courseId: uuid,
    blockers: z.array(SavedCourseReferenceBlockerSchema).max(5),
    missingPrerequisiteCount: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (new Set(value.blockers).size !== value.blockers.length) fail('Duplicate blockers');
    if (value.blockers.includes('NO_CURRENT_PLACEMENT')) {
      if (value.blockers.length !== 1 || value.missingPrerequisiteCount !== null)
        fail('Unplaced entries are not otherwise assessed');
    } else {
      if (value.missingPrerequisiteCount === null)
        fail('Placed entries require prerequisite counts');
      const hasMissingPrerequisites = (value.missingPrerequisiteCount ?? 0) > 0;
      if (value.blockers.includes('UNMET_PREREQUISITE') !== hasMissingPrerequisites)
        fail('Prerequisite blocker must match the missing count');
    }
    if (value.blockers.includes('GPA_EXCLUDED') && value.blockers.includes('GPA_UNDETERMINED'))
      fail('GPA exclusion and indeterminate path are mutually exclusive');
    if (
      value.blockers.includes('NO_MATCHING_REFERENCE_SLOT') &&
      (value.blockers.includes('GPA_EXCLUDED') || value.blockers.includes('GPA_UNDETERMINED'))
    )
      fail('GPA blockers apply only to matching placements');
  });

/** Current completions only; never an academic save, calendar or historical validation. */
export const OwnStudyPlanReferenceReviewSchema = z
  .object({
    snapshot: OwnStudyPlanCoursesSchema,
    referenceSlot,
    review: z.discriminatedUnion('status', [
      z
        .object({
          status: z.literal('ASSESSED'),
          basis: z.literal('CURRENT_COMPLETIONS_ONLY'),
          gpaPath: z.enum(['THESIS', 'ALTERNATIVE']).nullable(),
          entries: z.array(entry).max(100),
        })
        .strict(),
      z
        .object({
          status: z.literal('UNAVAILABLE'),
          reason: z.enum(['NO_ASSIGNED_CURRICULUM', 'COURSE_REFERENCES_UNAVAILABLE']),
        })
        .strict(),
    ]),
    validation: z
      .object({
        calendarValidated: z.literal(false),
        originalCurriculumKnown: z.literal(false),
        savingEnabled: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const refs = value.snapshot.courseReferences;
    const assigned = value.snapshot.scope.curriculumId !== null;
    if (value.review.status === 'UNAVAILABLE') {
      const expected = !assigned
        ? 'NO_ASSIGNED_CURRICULUM'
        : refs.status === 'UNAVAILABLE'
          ? 'COURSE_REFERENCES_UNAVAILABLE'
          : null;
      if (value.review.reason !== expected) fail('Unavailable reason must match snapshot');
      return;
    }
    if (!assigned || refs.status !== 'RECOGNIZED') {
      fail('Assessment requires an assigned curriculum and recognized references');
      return;
    }
    if (value.review.entries.length !== refs.entries.length)
      fail('All saved references must be assessed');
    value.review.entries.forEach((reviewed, index) => {
      const original = refs.entries[index];
      if (!original || original.courseId !== reviewed.courseId)
        fail('Assessment order must match saved references');
      if (
        original &&
        (original.currentCurriculumMembership === 'NO_CURRENT_PLACEMENT') !==
          reviewed.blockers.includes('NO_CURRENT_PLACEMENT')
      )
        fail('Assessment must match current placement evidence');
      if (
        reviewed.blockers.includes('GPA_EXCLUDED') ||
        reviewed.blockers.includes('GPA_UNDETERMINED')
      ) {
        if (value.referenceSlot.academicYear !== 4 || value.referenceSlot.academicSemester !== 2)
          fail('GPA fork blockers require reference slot 4:2');
        if (
          reviewed.blockers.includes('GPA_EXCLUDED') &&
          value.review.status === 'ASSESSED' &&
          value.review.gpaPath === null
        )
          fail('Exclusion requires a known GPA path');
        if (
          reviewed.blockers.includes('GPA_UNDETERMINED') &&
          value.review.status === 'ASSESSED' &&
          value.review.gpaPath !== null
        )
          fail('Indeterminate GPA requires a null path');
      }
    });
  });

export type OwnStudyPlanReferenceReviewBodyDTO = z.infer<
  typeof OwnStudyPlanReferenceReviewBodySchema
>;
export type OwnStudyPlanReferenceReviewDTO = z.infer<typeof OwnStudyPlanReferenceReviewSchema>;
