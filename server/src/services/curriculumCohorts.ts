import { prisma } from '../db';

export class CurriculumCohortError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 = 400,
  ) {
    super(message);
  }
}

const MAX_COHORT_LENGTH = 40;

/** A cohort label identifies an admission year as the school states it, for example "K2025". */
export function normalizeCohort(input: string): string {
  const cohort = input.trim();
  if (cohort.length === 0 || cohort.length > MAX_COHORT_LENGTH)
    throw new CurriculumCohortError('A cohort label must be between 1 and 40 characters');
  return cohort;
}

export interface CohortGovernance {
  cohort: string;
  curriculum: { id: string; code: string; name: string };
}

/**
 * Which structures govern a cohort. More than one is legitimate across programmes — the 2025 intake
 * exists for several majors — so this reports every claimant rather than choosing one. Choosing is
 * the caller's job, because only the caller knows which programme it is asking about.
 */
export async function findCurriculaForCohort(input: string): Promise<CohortGovernance[]> {
  const cohort = normalizeCohort(input);
  const rows = await prisma.curriculumCohort.findMany({
    where: { cohort },
    orderBy: [{ curriculum: { code: 'asc' } }],
    select: { curriculum: { select: { id: true, code: true, name: true } } },
  });
  return rows.map(({ curriculum }) => ({ cohort, curriculum }));
}

/**
 * The cohorts one structure governs. A plan that is unchanged for several years appears once and is
 * governed by several cohorts, which is what keeps the two from drifting apart when one is corrected.
 */
export async function listCohortsForCurriculum(curriculumId: string): Promise<string[]> {
  const rows = await prisma.curriculumCohort.findMany({
    where: { curriculumId },
    orderBy: { cohort: 'asc' },
    select: { cohort: true },
  });
  return rows.map(({ cohort }) => cohort);
}

/**
 * Fails closed when a caller expects exactly one structure for a cohort and finds none or several.
 * The caller supplies the programme it means; without it there is no defensible answer.
 */
export async function requireCohortGovernance(input: string): Promise<CohortGovernance> {
  const matches = await findCurriculaForCohort(input);
  if (matches.length === 0)
    throw new CurriculumCohortError(`No curriculum governs cohort ${input}`, 404);
  if (matches.length > 1)
    throw new CurriculumCohortError(
      `Cohort ${input} is governed by ${matches.length} curricula; state the programme`,
      400,
    );
  return matches[0];
}
