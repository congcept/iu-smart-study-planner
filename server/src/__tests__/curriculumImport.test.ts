import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../index';
import {
  CurriculumImportError,
  importCurriculumManifest,
  inspectCurriculumManifest,
} from '../services/curriculumImport';

const manifest = () =>
  JSON.parse(
    readFileSync(
      resolve(__dirname, '../../../docs/phase-1/ds-2025-manifest-proposed-readings.json'),
      'utf8',
    ),
  ) as Record<string, unknown>;

const CODE = 'DS';

describe('curriculum manifest import (PostgreSQL)', () => {
  // The import writes global courses. Suites share one database, so anything this file creates has
  // to be removed again or every catalogue count downstream is wrong.
  let existingCourses: string[] = [];

  beforeAll(async () => {
    await prisma.curriculum.deleteMany({ where: { code: CODE } });
    const rows = await prisma.course.findMany({ select: { code: true } });
    existingCourses = rows.map(({ code }) => code);
  });

  afterAll(async () => {
    await prisma.curriculum.deleteMany({ where: { code: CODE } });
    await prisma.course.deleteMany({ where: { code: { notIn: existingCourses } } });
    await prisma.$disconnect();
  });

  it('refuses an unverified manifest before writing anything', async () => {
    const faithful = JSON.parse(
      readFileSync(resolve(__dirname, '../../../docs/phase-1/ds-2025-manifest.json'), 'utf8'),
    );
    await expect(importCurriculumManifest(faithful)).rejects.toBeInstanceOf(CurriculumImportError);
    expect(await prisma.curriculum.count({ where: { code: CODE } })).toBe(0);
  });

  it('inspects without writing', async () => {
    const report = await inspectCurriculumManifest(manifest());
    expect(report.mode).toBe('CHECK');
    expect(report.program).toEqual({ code: 'DS', cohort: 'K2025' });
    expect(report.counts).toEqual({
      courses: 50,
      memberships: 50,
      placements: 50,
      requirements: 1,
      prerequisites: 32,
    });
    expect(await prisma.curriculum.count({ where: { code: CODE } })).toBe(0);
  });

  it('writes the curriculum, its cohort and its structure', async () => {
    const report = await importCurriculumManifest(manifest());
    expect(report.mode).toBe('APPLIED');
    expect(report.verification.readiness).toBe(true);

    const curriculum = await prisma.curriculum.findUniqueOrThrow({
      where: { code: CODE },
      select: { id: true, totalCredits: true, sourceLabel: true, cohorts: true, courses: true },
    });
    expect(curriculum.totalCredits).toBe(124);
    expect(curriculum.sourceLabel).toMatch(/Data Science 2025/);
    expect(curriculum.cohorts.map(({ cohort }) => cohort)).toEqual(['K2025']);
    expect(curriculum.courses).toHaveLength(50);

    const counts = {
      placements: await prisma.curriculumPlacement.count({
        where: { curriculumCourse: { curriculumId: curriculum.id } },
      }),
      requirements: await prisma.curriculumRequirement.count({
        where: { curriculumId: curriculum.id },
      }),
      prerequisites: await prisma.curriculumPrerequisite.count({
        where: { curriculumId: curriculum.id },
      }),
    };
    expect(counts).toEqual({ placements: 50, requirements: 1, prerequisites: 32 });
  });

  it('preserves the source prerequisite labels and pool units', async () => {
    const curriculum = await prisma.curriculum.findUniqueOrThrow({
      where: { code: CODE },
      select: { id: true },
    });
    const kinds = await prisma.curriculumPrerequisite.groupBy({
      by: ['kind'],
      where: { curriculumId: curriculum.id },
      _count: { _all: true },
    });
    expect(kinds.map(({ kind }) => kind).sort()).toEqual(['HT', 'TQ']);

    const pool = await prisma.curriculumPlacement.findMany({
      where: { curriculumCourse: { curriculumId: curriculum.id }, electiveGroup: { not: null } },
      select: { electiveSelectCredits: true, electiveSelectCount: true },
    });
    expect(pool).toHaveLength(15);
    expect(pool.every(({ electiveSelectCredits }) => electiveSelectCredits === 7)).toBe(true);
    expect(pool.every(({ electiveSelectCount }) => electiveSelectCount === null)).toBe(true);
  });

  it('assigns nobody and activates nothing', async () => {
    const curriculum = await prisma.curriculum.findUniqueOrThrow({
      where: { code: CODE },
      select: { id: true },
    });
    expect(await prisma.user.count({ where: { curriculumId: curriculum.id } })).toBe(0);
  });

  it('converges on a rerun instead of accumulating rows', async () => {
    const curriculum = await prisma.curriculum.findUniqueOrThrow({
      where: { code: CODE },
      select: { id: true },
    });
    const before = {
      placements: await prisma.curriculumPlacement.count({
        where: { curriculumCourse: { curriculumId: curriculum.id } },
      }),
      prerequisites: await prisma.curriculumPrerequisite.count({
        where: { curriculumId: curriculum.id },
      }),
      courses: await prisma.curriculumCourse.count({ where: { curriculumId: curriculum.id } }),
    };
    await importCurriculumManifest(manifest());
    expect({
      placements: await prisma.curriculumPlacement.count({
        where: { curriculumCourse: { curriculumId: curriculum.id } },
      }),
      prerequisites: await prisma.curriculumPrerequisite.count({
        where: { curriculumId: curriculum.id },
      }),
      courses: await prisma.curriculumCourse.count({ where: { curriculumId: curriculum.id } }),
    }).toEqual(before);
    expect(await prisma.curriculum.count({ where: { code: CODE } })).toBe(1);
  });

  it('refuses a manifest whose credits disagree with the existing catalogue', async () => {
    const changed = manifest() as {
      courses: { code: string; credits: number; lecture: number; lab: number }[];
      blocks: { requiredCredits: number }[];
      totalCredits: number;
    };
    // An elective-pool option carries no block arithmetic, so changing its credits leaves the
    // manifest self-consistent and only the catalogue conflict can fail.
    const target = changed.courses.find((course) => course.code === 'IT169IU')!;
    target.credits = 3;
    target.lecture = 3;
    target.lab = 0;
    await expect(importCurriculumManifest(changed)).rejects.toMatchObject({ status: 409 });
  });
});
