import type { AuthUserDTO, CurriculumDetailDTO } from '@iu-study-planner/shared';

export const ownerId = '11111111-1111-4111-8111-111111111111';
export const referenceId = '22222222-2222-4222-8222-222222222222';
export const otherReferenceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const memberId = '33333333-3333-4333-8333-333333333333';
export function referenceSession(
  curriculumId: string | null = referenceId,
  id = ownerId,
): AuthUserDTO {
  return {
    id,
    studentId: 'SIMULATED',
    name: 'Simulated',
    email: 'simulated@example.test',
    role: 'STUDENT',
    curriculumId,
  };
}
export function curriculumReference(): CurriculumDetailDTO {
  return {
    id: referenceId,
    code: 'SIM',
    name: 'Simulated reference',
    school: 'CSE',
    degree: 'Bachelor',
    programUrl: 'https://example.test/program',
    totalCredits: null,
    isGpaPath: false,
    sourceLabel: 'Unverified test reference',
    sourceUrl: null,
    usage: 'REFERENCE_ONLY',
    courses: [
      {
        id: memberId,
        code: 'MA001IU',
        name: 'Scoped Calculus',
        credits: 4,
        difficultyLevel: 2,
        description: null,
        semesterOffered: ['FALL'],
        avgRating: null,
        ratingCount: 0,
        ratingDifficulty: 2,
        ratingPriorMean: 2,
        ratingPriorSource: 'CURRICULUM_SEED',
        placements: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            academicYear: 1,
            academicSemester: 1,
            electiveGroup: 'Group A',
            electiveSelectCount: 1,
            sourceOrder: 0,
            sourceLabel: null,
          },
        ],
      },
    ],
    requirements: [],
    prerequisites: [],
    ratingPrior: { mean: 2, source: 'CURRICULUM_SEED' },
  };
}
