import type { ContextStudentProgressDTO } from '@iu-study-planner/shared';
import { curriculumReference, ownerId, referenceId } from './curriculumReference';

export function contextProgress(): ContextStudentProgressDTO {
  const reference = curriculumReference(),
    course = reference.courses[0];
  return {
    completed: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        userId: ownerId,
        courseId: course.id,
        status: 'COMPLETED',
        grade: 'A',
        gradePoints: 4,
        electiveGroup: 'Group A',
        semester: null,
        year: null,
        createdAt: '2026-10-03T00:00:00.000Z',
        updatedAt: '2026-10-03T00:00:00.000Z',
        course,
      },
    ],
    inProgress: [],
    planned: [],
    available: [],
    historicalRecords: [],
    progress: {
      totalCourses: 1,
      completedCourses: 1,
      totalCredits: null,
      completedCredits: 4,
      percentage: null,
    },
    scope: {
      userId: ownerId,
      curriculumId: referenceId,
      usage: 'REFERENCE_ONLY',
      degreeProgressAvailable: false,
      gpaPath: null,
      ratingPrior: reference.ratingPrior,
    },
  };
}
