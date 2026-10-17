import type {
  OwnStudyPlanReferenceSelectionBodyDTO,
  OwnStudyPlanReferenceSelectionStateDTO,
  OwnStudyPlanReferenceSelectionResultDTO,
} from '@iu-study-planner/shared';
import { ownerId, referenceId } from './curriculumReference';
import {
  savedCourseFixture,
  savedCourseId,
  savedPlanId,
  savedSemesterId,
} from './savedStudyPlanCourses';
export const selectionRequestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const extraSelectionCourseId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const referenceSelectionScope = {
  ownerId,
  planId: savedPlanId,
  semesterId: savedSemesterId,
  expectedCurriculumId: referenceId,
};
export function referenceSelectionBody(): OwnStudyPlanReferenceSelectionBodyDTO {
  return {
    requestId: selectionRequestId,
    expectedScope: { userId: ownerId, curriculumId: referenceId },
    expectedRevision: 0,
    academicYear: 2,
    academicSemester: 1,
    courseIds: [savedCourseId],
  };
}
export function referenceSelectionState(revision = 0): OwnStudyPlanReferenceSelectionStateDTO {
  const snapshot = savedCourseFixture();
  snapshot.scope.curriculumId = referenceId;
  if (snapshot.courseReferences.status === 'RECOGNIZED')
    snapshot.courseReferences.entries[0].currentCurriculumMembership = 'PLACED_MEMBER';
  return {
    snapshot,
    revision,
    lastReferenceSave: null,
    editing: {
      status: 'AVAILABLE',
      courses: [
        { id: savedCourseId, code: 'CS101', name: 'Reference course' },
        { id: extraSelectionCourseId, code: 'CS102', name: 'Second course' },
      ],
    },
  };
}
export function referenceSelectionResult(
  body = referenceSelectionBody(),
): OwnStudyPlanReferenceSelectionResultDTO {
  return {
    replayed: false,
    receipt: {
      requestId: body.requestId,
      userId: body.expectedScope.userId,
      curriculumId: body.expectedScope.curriculumId,
      planId: savedPlanId,
      semesterId: savedSemesterId,
      previousRevision: body.expectedRevision,
      savedRevision: body.expectedRevision + 1,
      referenceSlot: { academicYear: body.academicYear, academicSemester: body.academicSemester },
      courseIds: body.courseIds,
      storedTotalCredits: 3,
      storedDifficultyScore: 2.5,
      savedAt: '2026-10-17T01:00:00.000Z',
    },
  };
}
