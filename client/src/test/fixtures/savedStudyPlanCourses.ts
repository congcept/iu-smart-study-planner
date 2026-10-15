import type { OwnStudyPlanCoursesDTO } from '@iu-study-planner/shared';
import { ownerId } from './curriculumReference';

export const savedPlanId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const savedSemesterId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const savedCourseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export function savedCourseFixture(
  overrides: Partial<OwnStudyPlanCoursesDTO> = {},
): OwnStudyPlanCoursesDTO {
  return {
    visibility: 'CURRENT_ACCOUNT_ONLY',
    scope: { userId: ownerId, curriculumId: null, studyPlansValidated: false },
    plan: {
      id: savedPlanId,
      name: 'Saved reference',
      description: null,
      isActive: false,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      semesterCount: 1,
    },
    semester: {
      id: savedSemesterId,
      semester: 'FALL',
      year: 2026,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      storedTotalCredits: 9,
    },
    courseReferences: {
      status: 'RECOGNIZED',
      order: 'STORED_ARRAY_ORDER',
      entries: [
        {
          courseId: savedCourseId,
          storedPosition: -5,
          currentCurriculumMembership: 'NO_ASSIGNED_CURRICULUM',
          catalog: { code: 'CS101', name: 'Reference course' },
        },
      ],
    },
    ...overrides,
  };
}
