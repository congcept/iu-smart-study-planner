import { Prisma } from '@prisma/client';
import {
  AllocationPreviewSchema,
  AllocationUtilityPolicySchema,
  CohortResourceSnapshotSchema,
  EligibleCohortDemandPolicySchema,
  ResourceScopeSchema,
  SimulationAllocationPolicySchema,
  SimulationAllocationResultSchema,
  SimulationAllocationRosterSchema,
  SimulationResourcePolicySchema,
  type AllocationPreviewDTO,
  type AllocationUtilityPolicyDTO,
  type CohortResourceSnapshotDTO,
  type ResourceScopeDTO,
  type SimulationAllocationResultDTO,
} from '@iu-study-planner/shared';
import config from '../config';
import { prisma } from '../db';
import { projectCohortResourceSnapshot } from './cohortResourceSnapshot';
import { readEligibleCohortDemandWithChoices } from './eligibleCohortDemand';
import { projectSimulationResourceEnvelope } from './schoolResourceEnvelope';
import { readResources, SchoolResourceError } from './schoolResources';
import { allocateSimulationRound } from './simulationAllocation';
import { calculateAllocationStudentUtility } from './allocationUtility';

/** Internal IDs never leave this aggregate projection. Inputs must share their source snapshot. */
export function projectAllocationPreview(
  inputSnapshot: CohortResourceSnapshotDTO,
  inputAllocation: SimulationAllocationResultDTO,
  inputUtilityPolicy: AllocationUtilityPolicyDTO,
): AllocationPreviewDTO {
  const snapshot = CohortResourceSnapshotSchema.safeParse(inputSnapshot);
  const allocation = SimulationAllocationResultSchema.safeParse(inputAllocation);
  const utilityPolicy = AllocationUtilityPolicySchema.safeParse(inputUtilityPolicy);
  if (!snapshot.success || !allocation.success || !utilityPolicy.success)
    throw new Error('Allocation preview inputs could not be verified');
  const { demand, resourceEnvelope } = snapshot.data;
  const result = allocation.data;
  if (
    JSON.stringify(resourceEnvelope) !== JSON.stringify(result.envelope) ||
    result.rosterStudentIds.length !== demand.cohortStudentCount
  )
    throw new Error('Allocation preview inputs do not share their envelope or cohort');
  const courses = new Map(result.courses.map((course) => [course.courseId, course]));
  const memberIds = new Set(demand.courses.map(({ id }) => id));
  if (
    [...courses.keys()].some((id) => !memberIds.has(id)) ||
    demand.courses.some(
      (course) => (courses.get(course.id)?.demandStudentCount ?? 0) !== course.demandStudentCount,
    )
  )
    throw new Error('Allocation preview choices do not match eligible demand');
  const projected = AllocationPreviewSchema.safeParse({
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    consistencyBasis: 'SINGLE_DATABASE_SNAPSHOT',
    model: result.model,
    utilityBasis: 'BAYESIAN_DIFFICULTY_AND_IMMEDIATE_UNLOCKS_V1',
    utilityPolicy: utilityPolicy.data,
    eligibilityValidated: false,
    allocationValidated: false,
    timetableValidated: false,
    persisted: false,
    categoryPersonalizationAvailable: false,
    gradePersonalizationAvailable: false,
    timelinePersonalizationAvailable: false,
    snapshot: snapshot.data,
    allocationPolicy: result.policy,
    assignedStudentCount: result.assignedStudentCount,
    noChoicesStudentCount: result.unassigned.filter(({ reason }) => reason === 'NO_CHOICES').length,
    resourceUnknownStudentCount: result.unassigned.filter(
      ({ reason }) => reason === 'RESOURCE_UNKNOWN',
    ).length,
    capacityExhaustedStudentCount: result.unassigned.filter(
      ({ reason }) => reason === 'CAPACITY_EXHAUSTED',
    ).length,
    usedSections: result.usedSections,
    courses: demand.courses.map(({ id, code, name, demandStudentCount }) => {
      const course = courses.get(id);
      const seatCapacity = course?.seatCapacity ?? 0;
      const assignedStudentCount = course?.assignedStudentCount ?? 0;
      return {
        id,
        code,
        name,
        demandStudentCount,
        assignedStudentCount,
        openedSections: course?.openedSections ?? 0,
        seatCapacity,
        seatUtilization: seatCapacity === 0 ? null : assignedStudentCount / seatCapacity,
      };
    }),
  });
  if (!projected.success) throw new Error('Allocation preview could not be verified');
  return projected.data;
}

export async function readAllocationPreview(actorId: string, inputScope: ResourceScopeDTO) {
  const scope = ResourceScopeSchema.parse(inputScope);
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
    throw new Error('Allocation preview policies could not be verified');
  const capturedDemand = Object.freeze(demandPolicy.data);
  const capturedResource = Object.freeze(resourcePolicy.data);
  const capturedAllocation = Object.freeze(allocationPolicy.data);
  const capturedUtility = Object.freeze(utilityPolicy.data);
  const source = await prisma.$transaction(
    async (tx) => {
      const cohort = await readEligibleCohortDemandWithChoices(actorId, scope, tx, capturedDemand);
      const resources = await readResources(actorId, scope, tx);
      return { cohort, resources };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  // Run CPU work after closing the transaction, over the captured source and policy only.
  const envelope = projectSimulationResourceEnvelope(source.resources, capturedResource);
  const snapshot = projectCohortResourceSnapshot(source.cohort.demand, envelope);
  const roster = source.cohort.choices.map(({ studentId, candidates }) => ({
    studentId,
    candidates: candidates.map(({ courseId, ratingDifficulty, immediateUnlockCount }) => ({
      courseId,
      studentUtility: calculateAllocationStudentUtility(
        { ratingDifficulty, immediateUnlockCount },
        capturedUtility,
      ),
    })),
  }));
  const checkedRoster = SimulationAllocationRosterSchema.safeParse(roster);
  if (
    !checkedRoster.success ||
    roster.length > 500 ||
    roster.some(({ candidates }) => candidates.length > 100) ||
    roster.reduce((sum, { candidates }) => sum + candidates.length, 0) > 10_000
  )
    throw new SchoolResourceError(
      'Allocation preview supports at most 500 students, 100 choices per student and 10000 total choices',
      409,
    );
  return projectAllocationPreview(
    snapshot,
    allocateSimulationRound(envelope, checkedRoster.data, capturedAllocation),
    capturedUtility,
  );
}
