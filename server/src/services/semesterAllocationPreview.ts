import { Prisma, UserRole } from '@prisma/client';
import { z } from 'zod';
import {
  AllocationUtilityPolicySchema,
  CurriculumDetailSchema,
  EligibleCohortDemandPolicySchema,
  SemesterAllocationPreviewSchema,
  SemesterAllocationScopeV1Schema,
  SimulationAllocationPolicySchema,
  SimulationResourcePolicySchema,
  SimulationSemesterAllocationInputSchema,
  type ResourceScopeDTO,
  type SemesterAllocationPreviewDTO,
  type SimulationSemesterAllocationResultDTO,
} from '@iu-study-planner/shared';

import config from '../config';
import { prisma } from '../db';
import { calculateAllocationStudentUtility } from './allocationUtility';
import { readCurriculumSnapshot } from './curriculumContexts';
import { readEligibleCohortDemandWithChoices } from './eligibleCohortDemand';
import { projectSimulationResourceEnvelope } from './schoolResourceEnvelope';
import { readResources, SchoolResourceError } from './schoolResources';
import { projectSemesterAllocationSummary } from './semesterAllocationProjection';
import { allocateSimulationSemester } from './simulationSemesterAllocation';

const boundsMessage =
  'Semester preview supports at most 500 students, 100 choices per student and 10000 total choices';
const targetProjectionSchema = z.object({
  students: z.array(z.object({ targetCredits: z.number().int().min(0).max(30) })).max(500),
});

export interface ProducedSemesterAllocationPreview {
  /** Private server result only; never put this participant-bearing value in an HTTP reply. */
  result: SimulationSemesterAllocationResultDTO;
  preview: SemesterAllocationPreviewDTO;
}

export function projectSemesterAllocationPreview(
  rawResult: unknown,
  rawRecommendationPolicy: unknown,
  rawUtilityPolicy: unknown,
): SemesterAllocationPreviewDTO {
  const recommendationPolicy = EligibleCohortDemandPolicySchema.safeParse(rawRecommendationPolicy);
  const utilityPolicy = AllocationUtilityPolicySchema.safeParse(rawUtilityPolicy);
  if (!recommendationPolicy.success || !utilityPolicy.success)
    throw new Error('Semester preview policies could not be verified');
  // Check individual targets cheaply; the complete private result still undergoes pinned replay.
  const targets = targetProjectionSchema.safeParse(rawResult);
  if (
    !targets.success ||
    targets.data.students.some(
      (student) => student.targetCredits !== recommendationPolicy.data.maxCredits,
    )
  )
    throw new Error('Semester preview targets must use the captured reference credit budget');
  const preview = SemesterAllocationPreviewSchema.safeParse({
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    consistencyBasis: 'SINGLE_DATABASE_SNAPSHOT',
    targetCreditsBasis: 'CONFIGURED_REFERENCE_MAX_CREDITS',
    persisted: false,
    recommendationPolicy: recommendationPolicy.data,
    utilityPolicy: utilityPolicy.data,
    result: projectSemesterAllocationSummary(rawResult),
  });
  if (!preview.success) throw new Error('Semester preview could not be verified');
  return preview.data;
}

/**
 * Fresh role, scoped cohort, context, grades and resources share one database snapshot.
 * A supplied transaction must provide Repeatable Read or Serializable isolation.
 */
export async function produceSemesterAllocationPreview(
  actorId: string,
  inputScope: ResourceScopeDTO,
  transaction?: Prisma.TransactionClient,
): Promise<ProducedSemesterAllocationPreview> {
  const scope = SemesterAllocationScopeV1Schema.parse(inputScope);
  const actor = SemesterAllocationScopeV1Schema.shape.curriculumId.parse(actorId);
  const demandPolicy = EligibleCohortDemandPolicySchema.safeParse(config.cohortDemandPolicy);
  const resourcePolicy = SimulationResourcePolicySchema.safeParse(config.simulationResourcePolicy);
  const allocationPolicy = SimulationAllocationPolicySchema.safeParse(
    config.simulationAllocationPolicy,
  );
  const utilityPolicy = AllocationUtilityPolicySchema.safeParse(config.allocationUtilityPolicy);
  if (
    !demandPolicy.success ||
    !resourcePolicy.success ||
    !allocationPolicy.success ||
    !utilityPolicy.success
  )
    throw new Error('Semester preview policies could not be verified');
  // Every captured policy contains primitive fields, so these copies are fully frozen.
  const capturedDemand = Object.freeze(demandPolicy.data);
  const capturedResource = Object.freeze(resourcePolicy.data);
  const capturedAllocation = Object.freeze(allocationPolicy.data);
  const capturedUtility = Object.freeze(utilityPolicy.data);

  const read = async (tx: Prisma.TransactionClient) => {
    const account = await tx.user.findUnique({ where: { id: actor }, select: { role: true } });
    if (!account) throw new SchoolResourceError('Authentication required', 401);
    if (account.role !== UserRole.ADMIN)
      throw new SchoolResourceError('Administrator access required', 403);

    // Reject the oversized cohort before reading any member's progress or grade history.
    const cohortCount = await tx.user.count({
      where: { role: UserRole.STUDENT, curriculumId: scope.curriculumId },
    });
    if (!Number.isSafeInteger(cohortCount) || cohortCount < 0)
      throw new Error('Semester preview cohort count could not be verified');
    if (cohortCount > 500) throw new SchoolResourceError(boundsMessage, 409);

    const context = await readCurriculumSnapshot(tx, scope.curriculumId);
    if (!context) throw new SchoolResourceError('Curriculum not found', 404);
    const verifiedContext = CurriculumDetailSchema.safeParse(context);
    if (!verifiedContext.success || verifiedContext.data.id !== scope.curriculumId)
      throw new Error('Semester preview curriculum metadata could not be verified');
    // Include the whole member catalog, including zero-credit planning courses.
    const catalog = SimulationSemesterAllocationInputSchema.safeParse({
      courses: verifiedContext.data.courses.map((course) => ({
        courseId: course.id,
        credits: course.credits,
      })),
      students: [],
    });
    if (!catalog.success)
      throw new Error('Semester preview course credits or catalog bounds could not be verified');

    const cohort = await readEligibleCohortDemandWithChoices(actor, scope, tx, capturedDemand);
    const resources = await readResources(actor, scope, tx);
    if (
      cohort.choices.length !== cohortCount ||
      cohort.demand.cohortStudentCount !== cohortCount ||
      JSON.stringify(cohort.demand.recommendationPolicy) !== JSON.stringify(capturedDemand)
    )
      throw new Error('Semester preview cohort or recommendation policy could not be verified');
    if (
      cohort.choices.some((student) => student.candidates.length > 100) ||
      cohort.choices.reduce((sum, student) => sum + student.candidates.length, 0) > 10000
    )
      throw new SchoolResourceError(boundsMessage, 409);
    const members = new Set(catalog.data.courses.map((course) => course.courseId));
    if (
      cohort.demand.courses.length !== members.size ||
      cohort.demand.courses.some((course) => !members.has(course.id)) ||
      cohort.choices.some((student) =>
        student.candidates.some((candidate) => !members.has(candidate.courseId)),
      )
    )
      throw new Error('Semester preview choices must belong to the captured member catalog');
    return { cohort, resources, courses: catalog.data.courses };
  };
  const source = transaction
    ? await read(transaction)
    : await prisma.$transaction(read, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });

  // Normal previews release their database snapshot before bounded allocation/replay work.
  const envelope = projectSimulationResourceEnvelope(source.resources, capturedResource);
  const input = SimulationSemesterAllocationInputSchema.safeParse({
    courses: source.courses,
    students: source.cohort.choices.map((student) => ({
      studentId: student.studentId,
      targetCredits: capturedDemand.maxCredits,
      candidates: student.candidates.map((candidate) => ({
        courseId: candidate.courseId,
        studentUtility: calculateAllocationStudentUtility(
          {
            ratingDifficulty: candidate.ratingDifficulty,
            immediateUnlockCount: candidate.immediateUnlockCount,
          },
          capturedUtility,
        ),
      })),
    })),
  });
  if (!input.success) throw new Error('Semester preview allocation inputs could not be verified');
  const result = allocateSimulationSemester(envelope, input.data, capturedAllocation);
  // This also requires compatibility with the independently pinned persisted-result format.
  const preview = projectSemesterAllocationPreview(result, capturedDemand, capturedUtility);
  const resultByCourseId = new Map(
    preview.result.courses.map((course) => [course.courseId, course]),
  );
  if (
    source.cohort.demand.scope.curriculumId !== preview.result.scope.curriculumId ||
    source.cohort.demand.scope.semester !== preview.result.scope.semester ||
    source.cohort.demand.scope.year !== preview.result.scope.year ||
    JSON.stringify(source.cohort.demand.curriculum) !== JSON.stringify(preview.result.curriculum) ||
    source.cohort.demand.courses.some(
      (course) => resultByCourseId.get(course.id)?.demandStudentCount !== course.demandStudentCount,
    )
  )
    throw new Error('Semester preview result must match the captured eligible cohort demand');
  return { result, preview };
}

/** HTTP-facing convenience reader exposes only the private-free aggregate. */
export async function readSemesterAllocationPreview(
  actorId: string,
  inputScope: ResourceScopeDTO,
  transaction?: Prisma.TransactionClient,
): Promise<SemesterAllocationPreviewDTO> {
  return (await produceSemesterAllocationPreview(actorId, inputScope, transaction)).preview;
}
