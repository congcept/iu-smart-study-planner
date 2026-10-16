import type { OwnStudyPlanReferenceReviewDTO } from '@iu-study-planner/shared';
import { referenceId } from './curriculumReference';
import { savedCourseFixture, savedCourseId } from './savedStudyPlanCourses';

export function referenceReviewFixture(): OwnStudyPlanReferenceReviewDTO {
  const snapshot = savedCourseFixture();
  snapshot.scope.curriculumId = referenceId;
  if (snapshot.courseReferences.status === 'RECOGNIZED')
    snapshot.courseReferences.entries[0].currentCurriculumMembership = 'PLACED_MEMBER';
  return {
    snapshot,
    referenceSlot: { academicYear: 2, academicSemester: 1 },
    review: {
      status: 'ASSESSED',
      basis: 'CURRENT_COMPLETIONS_ONLY',
      gpaPath: null,
      entries: [{ courseId: savedCourseId, blockers: [], missingPrerequisiteCount: 0 }],
    },
    validation: { calendarValidated: false, originalCurriculumKnown: false, savingEnabled: false },
  };
}
