import { Prisma } from '@prisma/client';
import {
  CreateSemesterAllocationRunSchema,
  type CreateSemesterAllocationRunDTO,
} from '@iu-study-planner/shared';

import { prisma } from '../db';
import { SchoolResourceError } from './schoolResources';
import { produceSemesterAllocationPreview } from './semesterAllocationPreview';
import {
  recoverSemesterAllocationRunInTransaction,
  storeSemesterAllocationRunInTransaction,
} from './semesterAllocationStorage';

const uncertainSaveMessage =
  'Could not confirm the simulation save; retry with the same request key';

/**
 * Explicit capture only: recover the actor/scenario key before consulting live inputs.
 * The caller's choices never enter this service; the producer reads them inside the save transaction.
 */
export async function captureSemesterAllocationRun(
  actorId: string,
  input: CreateSemesterAllocationRunDTO,
) {
  const request = CreateSemesterAllocationRunSchema.parse(input);
  const actor = CreateSemesterAllocationRunSchema.shape.expectedActorId.parse(actorId);
  const scope = {
    curriculumId: request.curriculumId,
    semester: request.semester,
    year: request.year,
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // This fresh authorization holds the current admin role through the commit.
          // Existing captures survive changes to configuration, cohorts and capture clocks.
          const existing = await recoverSemesterAllocationRunInTransaction(tx, actor, request);
          if (existing) return existing;

          const produced = await produceSemesterAllocationPreview(actor, scope, tx);
          const capturedAt = new Date();
          return storeSemesterAllocationRunInTransaction(
            tx,
            actor,
            request,
            produced.result,
            capturedAt,
          );
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 3000,
          timeout: 15000,
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const serialization =
          error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code));
        const retryable = ['P2034', 'P2002'].includes(error.code) || serialization;
        if (retryable && attempt < 4) continue;
        if (retryable || error.code === 'P2003')
          throw new SchoolResourceError(uncertainSaveMessage, 409);
      }
      // Unknown failures roll back the transaction and retain the caller's exact retry key.
      throw error;
    }
  }
  throw new SchoolResourceError(uncertainSaveMessage, 409);
}
