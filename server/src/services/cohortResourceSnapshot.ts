import { Prisma } from '@prisma/client';
import {
  CohortResourceSnapshotSchema,
  EligibleCohortDemandPolicySchema,
  ResourceScopeSchema,
  SimulationResourcePolicySchema,
  type CohortResourceSnapshotDTO,
  type EligibleCohortDemandSnapshotDTO,
  type ResourceScopeDTO,
  type SimulationResourceEnvelopeDTO,
} from '@iu-study-planner/shared';
import config from '../config';
import { prisma } from '../db';
import { readEligibleCohortDemand } from './eligibleCohortDemand';
import { projectSimulationResourceEnvelope } from './schoolResourceEnvelope';
import { readResources } from './schoolResources';

/** Both inputs must come from the same read transaction; identity alone cannot prove consistency. */
export function projectCohortResourceSnapshot(
  demand: EligibleCohortDemandSnapshotDTO,
  resourceEnvelope: SimulationResourceEnvelopeDTO,
): CohortResourceSnapshotDTO {
  const projected = CohortResourceSnapshotSchema.safeParse({
    kind: 'SIMULATION',
    usage: 'REFERENCE_ONLY',
    consistencyBasis: 'SINGLE_DATABASE_SNAPSHOT',
    demand,
    resourceEnvelope,
  });
  if (!projected.success) throw new Error('Cohort resource snapshot could not be verified');
  return projected.data;
}

/** Read-only production wrapper: current ADMIN, both diagnostics and both policies stay coherent. */
export async function readCohortResourceSnapshot(
  actorId: string,
  inputScope: ResourceScopeDTO,
): Promise<CohortResourceSnapshotDTO> {
  const scope = ResourceScopeSchema.parse(inputScope);
  // Copy both deployment policies before any await; child reads cannot observe a later change.
  const demandPolicy = EligibleCohortDemandPolicySchema.safeParse(config.cohortDemandPolicy);
  const resourcePolicy = SimulationResourcePolicySchema.safeParse(config.simulationResourcePolicy);
  if (!demandPolicy.success || !resourcePolicy.success)
    throw new Error('Cohort resource policies could not be verified');
  const capturedDemandPolicy = Object.freeze(demandPolicy.data);
  const capturedResourcePolicy = Object.freeze(resourcePolicy.data);
  return prisma.$transaction(
    async (tx) => {
      const demand = await readEligibleCohortDemand(actorId, scope, tx, capturedDemandPolicy);
      const resources = await readResources(actorId, scope, tx);
      return projectCohortResourceSnapshot(
        demand,
        projectSimulationResourceEnvelope(resources, capturedResourcePolicy),
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
