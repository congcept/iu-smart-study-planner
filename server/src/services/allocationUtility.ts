import { z } from 'zod';
import {
  AllocationUtilityPolicySchema,
  type AllocationUtilityPolicyDTO,
  type CourseStatus,
  type CurriculumDetailDTO,
  type GpaPath,
} from '@iu-study-planner/shared';
import { isCourseInGpaPath } from './gpaPath';

/** The caller supplies its GPA-filtered context, including unknown-GPA fork deferral. */
export function countImmediateCourseUnlocks(
  context: CurriculumDetailDTO,
  records: readonly { courseId: string; status: CourseStatus }[],
  gpaPath: GpaPath | null,
  candidateIds: readonly string[],
): Map<string, number> {
  const members = new Set(context.courses.map(({ id }) => id));
  const completed = new Set(
    records
      .filter(({ courseId, status }) => members.has(courseId) && status === 'COMPLETED')
      .map(({ courseId }) => courseId),
  );
  const taken = new Set(
    records
      .filter(({ status }) => status === 'COMPLETED' || status === 'IN_PROGRESS')
      .map(({ courseId }) => courseId),
  );
  const parents = new Map<string, Set<string>>();
  for (const edge of context.prerequisites) {
    const ids = parents.get(edge.courseId) ?? new Set<string>();
    ids.add(edge.prerequisiteId);
    parents.set(edge.courseId, ids);
  }
  const result = new Map(candidateIds.map((id) => [id, 0]));
  for (const child of context.courses) {
    if (
      taken.has(child.id) ||
      !child.placements.some(
        (placement) =>
          !(
            context.isGpaPath &&
            gpaPath === null &&
            placement.academicYear === 4 &&
            placement.academicSemester === 2
          ) && isCourseInGpaPath({ code: child.code, ...placement }, gpaPath),
      )
    )
      continue;
    const missing = [...(parents.get(child.id) ?? [])].filter((id) => !completed.has(id));
    if (
      missing.length !== 1 ||
      missing[0] === child.id ||
      !members.has(missing[0]) ||
      taken.has(missing[0]) ||
      !result.has(missing[0])
    )
      continue;
    result.set(missing[0], result.get(missing[0])! + 1);
  }
  return result;
}

const UtilityInputSchema = z
  .object({
    ratingDifficulty: z.number().finite().min(1).max(5),
    immediateUnlockCount: z.number().int().nonnegative().safe(),
  })
  .strict();

/** No category, legacy grade conversion or graduation-time estimate is inferred. */
export function calculateAllocationStudentUtility(
  input: { ratingDifficulty: number; immediateUnlockCount: number },
  inputPolicy: AllocationUtilityPolicyDTO,
): number {
  const { ratingDifficulty, immediateUnlockCount } = UtilityInputSchema.parse(input);
  const policy = AllocationUtilityPolicySchema.parse(inputPolicy);
  const difficultyFit = (5 - ratingDifficulty) / 4;
  const unlockFit = immediateUnlockCount / (immediateUnlockCount + 1);
  return Math.min(
    1,
    difficultyFit * policy.difficultyFitWeight + unlockFit * policy.immediateUnlockWeight,
  );
}
