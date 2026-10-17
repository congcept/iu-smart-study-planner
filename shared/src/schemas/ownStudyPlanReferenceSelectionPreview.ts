import { z } from 'zod';
import { SavedCourseReferenceAssessmentSchema } from './ownStudyPlanReferenceReview';
import { OwnStudyPlanReferenceSelectionBodySchema } from './ownStudyPlanReferenceSelection';

export const OwnStudyPlanReferenceSelectionPreviewBodySchema =
  OwnStudyPlanReferenceSelectionBodySchema.omit({ requestId: true }).strict();

const fields = OwnStudyPlanReferenceSelectionPreviewBodySchema.shape;
const uuid = z
  .string()
  .length(36)
  .uuid()
  .transform((value) => value.toLowerCase());

/** Read-only proposed-course evidence; never a saved snapshot or authorization to save later. */
export const OwnStudyPlanReferenceSelectionPreviewSchema = z
  .object({
    scope: fields.expectedScope,
    planId: uuid,
    semesterId: uuid,
    revision: fields.expectedRevision,
    referenceSlot: z
      .object({
        academicYear: fields.academicYear,
        academicSemester: fields.academicSemester,
      })
      .strict(),
    courseIds: fields.courseIds,
    assessment: z
      .object({
        basis: z.literal('CURRENT_COMPLETIONS_ONLY'),
        gpaPath: z.enum(['THESIS', 'ALTERNATIVE']).nullable(),
        entries: z.array(SavedCourseReferenceAssessmentSchema).max(100),
      })
      .strict(),
    validation: z
      .object({
        readOnly: z.literal(true),
        calendarValidated: z.literal(false),
        degreeValidated: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (value.courseIds.length !== value.assessment.entries.length)
      fail('All proposed courses must be assessed');
    value.assessment.entries.forEach((entry, index) => {
      if (entry.courseId !== value.courseIds[index])
        fail('Assessment order must match proposed courses');
      const excluded = entry.blockers.includes('GPA_EXCLUDED');
      const unknown = entry.blockers.includes('GPA_UNDETERMINED');
      if (excluded || unknown) {
        if (value.referenceSlot.academicYear !== 4 || value.referenceSlot.academicSemester !== 2)
          fail('GPA blockers require the reference slot 4:2');
        if (excluded && value.assessment.gpaPath === null)
          fail('GPA exclusion requires a known GPA path');
        if (unknown && value.assessment.gpaPath !== null)
          fail('Indeterminate GPA requires a null GPA path');
      }
    });
  });

export type OwnStudyPlanReferenceSelectionPreviewBodyDTO = z.infer<
  typeof OwnStudyPlanReferenceSelectionPreviewBodySchema
>;
export type OwnStudyPlanReferenceSelectionPreviewDTO = z.infer<
  typeof OwnStudyPlanReferenceSelectionPreviewSchema
>;
