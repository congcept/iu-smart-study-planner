import type {
  OwnStudyPlanReferenceSelectionPreviewBodyDTO,
  OwnStudyPlanReferenceSelectionPreviewDTO,
} from '@iu-study-planner/shared';
import { savedPlanId, savedSemesterId } from './savedStudyPlanCourses';
import { referenceSelectionBody } from './savedReferenceSelection';

export function proposedSelectionBody(): OwnStudyPlanReferenceSelectionPreviewBodyDTO {
  const saved = referenceSelectionBody();
  return {
    expectedScope: { ...saved.expectedScope },
    expectedRevision: saved.expectedRevision,
    academicYear: saved.academicYear,
    academicSemester: saved.academicSemester,
    courseIds: [...saved.courseIds],
  };
}

export function proposedSelectionPreview(
  body = proposedSelectionBody(),
): OwnStudyPlanReferenceSelectionPreviewDTO {
  return {
    scope: { ...body.expectedScope },
    planId: savedPlanId,
    semesterId: savedSemesterId,
    revision: body.expectedRevision,
    referenceSlot: {
      academicYear: body.academicYear,
      academicSemester: body.academicSemester,
    },
    courseIds: [...body.courseIds],
    assessment: {
      basis: 'CURRENT_COMPLETIONS_ONLY',
      gpaPath: null,
      entries: body.courseIds.map((courseId) => ({
        courseId,
        blockers: [],
        missingPrerequisiteCount: 0,
      })),
    },
    validation: { readOnly: true, calendarValidated: false, degreeValidated: false },
  };
}
