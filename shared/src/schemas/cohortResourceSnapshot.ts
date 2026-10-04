import { z } from 'zod';
import type { EligibleCohortDemandSnapshotSchema, SimulationResourceEnvelopeSchema } from './index';

/** Paired reference diagnostics share a database snapshot, without deriving course supply. */
export const createCohortResourceSnapshotSchema = (
  demandSchema: typeof EligibleCohortDemandSnapshotSchema,
  envelopeSchema: typeof SimulationResourceEnvelopeSchema,
) =>
  z
    .object({
      kind: z.literal('SIMULATION'),
      usage: z.literal('REFERENCE_ONLY'),
      consistencyBasis: z.literal('SINGLE_DATABASE_SNAPSHOT'),
      demand: demandSchema,
      resourceEnvelope: envelopeSchema,
    })
    .strict()
    .superRefine(({ demand, resourceEnvelope }, ctx) => {
      if (
        demand.scope.curriculumId !== resourceEnvelope.scope.curriculumId ||
        demand.scope.semester !== resourceEnvelope.scope.semester ||
        demand.scope.year !== resourceEnvelope.scope.year ||
        demand.curriculum.id !== resourceEnvelope.curriculum.id ||
        demand.curriculum.code !== resourceEnvelope.curriculum.code ||
        demand.curriculum.name !== resourceEnvelope.curriculum.name ||
        demand.curriculum.school !== resourceEnvelope.curriculum.school
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Cohort demand and resource envelope must share the exact scenario and curriculum',
        });
    });
