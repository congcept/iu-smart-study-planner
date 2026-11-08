import { randomUUID } from 'node:crypto';
import { prisma } from '../index';
import {
  CurriculumCohortError,
  findCurriculaForCohort,
  listCohortsForCurriculum,
  normalizeCohort,
  requireCohortGovernance,
} from '../services/curriculumCohorts';

describe('cohort governance (PostgreSQL)', () => {
  const prefix = `cohort-${randomUUID()}`;
  const cs = randomUUID();
  const ds = randomUUID();
  const shared = randomUUID();
  const suffix = prefix.slice(-8);

  beforeAll(async () => {
    await prisma.curriculum.createMany({
      data: [
        {
          id: cs,
          code: `${suffix}-CS`,
          name: 'Simulated CS',
          school: 'CSE',
          degree: 'Bachelor',
          programUrl: 'https://example.test/cs',
        },
        {
          id: ds,
          code: `${suffix}-DS`,
          name: 'Simulated DS',
          school: 'CSE',
          degree: 'Bachelor',
          programUrl: 'https://example.test/ds',
        },
        {
          id: shared,
          code: `${suffix}-SH`,
          name: 'Unchanged-year programme',
          school: 'CSE',
          degree: 'Bachelor',
          programUrl: 'https://example.test/sh',
        },
      ],
    });
    await prisma.curriculumCohort.createMany({
      data: [
        // One cohort, two programmes: legitimate, and the caller must say which it means.
        { curriculumId: cs, cohort: 'K2025' },
        { curriculumId: ds, cohort: 'K2025' },
        // One structure, two cohorts: the plan did not change between intakes.
        { curriculumId: shared, cohort: 'K2026' },
        { curriculumId: shared, cohort: 'K2027' },
      ],
    });
  });

  afterAll(async () => {
    await prisma.curriculum.deleteMany({ where: { id: { in: [cs, ds, shared] } } });
    await prisma.$disconnect();
  });

  it('reports every structure governing one cohort rather than choosing', async () => {
    const matches = await findCurriculaForCohort('K2025');
    expect(matches).toHaveLength(2);
    expect(matches.map(({ curriculum }) => curriculum.code).sort()).toEqual([
      `${suffix}-CS`,
      `${suffix}-DS`,
    ]);
    expect(matches.every(({ cohort }) => cohort === 'K2025')).toBe(true);
  });

  it('lets one structure govern several unchanged intakes', async () => {
    expect(await listCohortsForCurriculum(shared)).toEqual(['K2026', 'K2027']);
    const matches = await findCurriculaForCohort('K2026');
    expect(matches).toEqual([
      {
        cohort: 'K2026',
        curriculum: { id: shared, code: `${suffix}-SH`, name: 'Unchanged-year programme' },
      },
    ]);
  });

  it('refuses to answer when a cohort has no single governing structure', async () => {
    await expect(requireCohortGovernance('K2025')).rejects.toMatchObject({ status: 400 });
    await expect(requireCohortGovernance('K1999')).rejects.toMatchObject({ status: 404 });
    await expect(requireCohortGovernance('K2026')).resolves.toMatchObject({
      cohort: 'K2026',
      curriculum: { id: shared },
    });
  });

  it('rejects the same cohort twice on one structure but allows it across programmes', async () => {
    await expect(
      prisma.curriculumCohort.create({ data: { curriculumId: cs, cohort: 'K2025' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.curriculumCohort.create({ data: { curriculumId: shared, cohort: 'K2025' } }),
    ).resolves.toMatchObject({ cohort: 'K2025' });
    await prisma.curriculumCohort.deleteMany({ where: { curriculumId: shared, cohort: 'K2025' } });
  });

  it('rejects a padded or empty cohort label at the database boundary', async () => {
    await expect(
      prisma.curriculumCohort.create({ data: { curriculumId: cs, cohort: ' K2024' } }),
    ).rejects.toThrow(/curriculum_cohorts_label_check/);
    await expect(
      prisma.curriculumCohort.create({ data: { curriculumId: cs, cohort: '' } }),
    ).rejects.toThrow(/curriculum_cohorts_label_check/);
  });

  it('normalizes labels and rejects unusable ones before touching the database', () => {
    expect(normalizeCohort('  K2025 ')).toBe('K2025');
    expect(() => normalizeCohort('   ')).toThrow(CurriculumCohortError);
    expect(() => normalizeCohort('x'.repeat(41))).toThrow(CurriculumCohortError);
  });

  it('removes the governance rows when the structure is deleted', async () => {
    const temporary = randomUUID();
    await prisma.curriculum.create({
      data: {
        id: temporary,
        code: `${suffix}-TMP`,
        name: 'Temporary',
        school: 'CSE',
        degree: 'Bachelor',
        programUrl: 'https://example.test/tmp',
      },
    });
    await prisma.curriculumCohort.create({ data: { curriculumId: temporary, cohort: 'K2030' } });
    await prisma.curriculum.delete({ where: { id: temporary } });
    expect(await prisma.curriculumCohort.count({ where: { cohort: 'K2030' } })).toBe(0);
  });
});
