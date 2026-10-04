import { z } from 'zod';
import type { ResourceScopeSchema } from './index';

const uuid = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());
const count = z.number().int().nonnegative().safe();

export const EligibleCohortDemandPolicySchema = z
  .object({
    maxCredits: z.number().int().min(1).max(30),
    maxDifficulty: z.number().finite().min(1).max(5),
  })
  .strict();

/** Undated eligible intentions and reference recommendations do not establish enrollment. */
export const createEligibleCohortDemandSnapshotSchema = (scopeSchema: typeof ResourceScopeSchema) =>
  z
    .object({
      kind: z.literal('SIMULATION'),
      usage: z.literal('REFERENCE_ONLY'),
      scope: scopeSchema,
      curriculum: z
        .object({
          id: uuid,
          code: z.string().min(1),
          name: z.string().min(1),
          school: z.string().min(1),
        })
        .strict(),
      planningBasis: z.literal('ELIGIBLE_PLANNED_OR_REFERENCE_RECOMMENDED'),
      termBasis: z.literal('SCENARIO_ONLY'),
      prerequisitePolicy: z.literal('ALL_CONTEXT_PREREQUISITES_MANDATORY'),
      unknownGpaPolicy: z.literal('DEFER_FORK_ONLY_PLACEMENTS'),
      recommendationPolicy: EligibleCohortDemandPolicySchema,
      recommendationDemandAvailable: z.literal(true),
      eligibilityValidated: z.literal(false),
      offeringValidationAvailable: z.literal(false),
      allocationValidated: z.literal(false),
      cohortStudentCount: count,
      demandStudentCount: count,
      eligiblePlannedStudentCount: count,
      recommendedStudentCount: count,
      eligiblePlannedSelectionCount: count,
      recommendedSelectionCount: count,
      demandSelectionCount: count,
      overlapSelectionCount: count,
      ignoredNonmemberPlannedSelectionCount: count,
      ineligibleMemberPlannedSelectionCount: count,
      unresolvedGpaStudentCount: count,
      courses: z.array(
        z
          .object({
            id: uuid,
            code: z.string().min(1),
            name: z.string().min(1),
            eligiblePlannedStudentCount: count,
            recommendedStudentCount: count,
            overlapStudentCount: count,
            demandStudentCount: count,
            supply: z.null(),
            utilization: z.null(),
          })
          .strict(),
      ),
    })
    .strict()
    .superRefine((snapshot, ctx) => {
      const invalid = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      if (snapshot.scope.curriculumId !== snapshot.curriculum.id)
        invalid('Eligible cohort demand curriculum does not match its scenario');
      if (
        new Set(snapshot.courses.map(({ id }) => id)).size !== snapshot.courses.length ||
        new Set(snapshot.courses.map(({ code }) => code)).size !== snapshot.courses.length
      )
        invalid('Duplicate eligible cohort demand course identifiers');

      const sharedStudents =
        snapshot.eligiblePlannedStudentCount +
        snapshot.recommendedStudentCount -
        snapshot.demandStudentCount;
      for (const course of snapshot.courses) {
        if (
          course.demandStudentCount !==
            course.eligiblePlannedStudentCount +
              course.recommendedStudentCount -
              course.overlapStudentCount ||
          course.overlapStudentCount >
            Math.min(course.eligiblePlannedStudentCount, course.recommendedStudentCount)
        )
          invalid('Course demand must count the planned and recommended union once');
        if (
          course.eligiblePlannedStudentCount > snapshot.eligiblePlannedStudentCount ||
          course.recommendedStudentCount > snapshot.recommendedStudentCount ||
          course.demandStudentCount > snapshot.demandStudentCount ||
          course.overlapStudentCount > sharedStudents
        )
          invalid('Course demand counts exceed their distinct student counts');
      }
      const sums = {
        eligiblePlannedSelectionCount: snapshot.courses.reduce(
          (sum, course) => sum + course.eligiblePlannedStudentCount,
          0,
        ),
        recommendedSelectionCount: snapshot.courses.reduce(
          (sum, course) => sum + course.recommendedStudentCount,
          0,
        ),
        demandSelectionCount: snapshot.courses.reduce(
          (sum, course) => sum + course.demandStudentCount,
          0,
        ),
        overlapSelectionCount: snapshot.courses.reduce(
          (sum, course) => sum + course.overlapStudentCount,
          0,
        ),
      };
      for (const field of Object.keys(sums) as (keyof typeof sums)[]) {
        if (!Number.isSafeInteger(sums[field]) || snapshot[field] !== sums[field])
          invalid('Eligible cohort selection totals must match course counts');
      }
      for (const [students, selections] of [
        [snapshot.eligiblePlannedStudentCount, snapshot.eligiblePlannedSelectionCount],
        [snapshot.recommendedStudentCount, snapshot.recommendedSelectionCount],
        [snapshot.demandStudentCount, snapshot.demandSelectionCount],
      ]) {
        if (
          students > snapshot.cohortStudentCount ||
          students > selections ||
          (students === 0) !== (selections === 0)
        )
          invalid('Eligible cohort selections must match their distinct student counts');
      }
      if (
        snapshot.demandStudentCount <
          Math.max(snapshot.eligiblePlannedStudentCount, snapshot.recommendedStudentCount) ||
        snapshot.demandStudentCount >
          snapshot.eligiblePlannedStudentCount + snapshot.recommendedStudentCount ||
        snapshot.unresolvedGpaStudentCount > snapshot.cohortStudentCount ||
        snapshot.ineligibleMemberPlannedSelectionCount >
          snapshot.cohortStudentCount * snapshot.courses.length ||
        (snapshot.cohortStudentCount === 0 &&
          (snapshot.ignoredNonmemberPlannedSelectionCount !== 0 ||
            snapshot.ineligibleMemberPlannedSelectionCount !== 0))
      )
        invalid('Eligible demand student counts exceed their cohort or union');
    });
