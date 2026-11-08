import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../index';
import { importCurriculumManifest } from '../services/curriculumImport';
import { verifyCurriculumManifest } from '../services/curriculumManifest';
import { readCurriculumContext } from '../services/curriculumContexts';

const read = () =>
  JSON.parse(
    readFileSync(resolve(__dirname, '../../../docs/phase-1/it-network-2025-manifest.json'), 'utf8'),
  ) as Record<string, unknown>;

const CODE = 'IT-NET';

describe('IT Network Engineering 2025 committed manifest', () => {
  let existingCourses: string[] = [];

  beforeAll(async () => {
    await prisma.curriculum.deleteMany({ where: { code: CODE } });
    existingCourses = (await prisma.course.findMany({ select: { code: true } })).map(
      ({ code }) => code,
    );
  });

  afterAll(async () => {
    await prisma.curriculum.deleteMany({ where: { code: CODE } });
    await prisma.course.deleteMany({ where: { code: { notIn: existingCourses } } });
    await prisma.$disconnect();
  });

  it('reconciles at the block level, including the three unnamed elective slots', () => {
    const report = verifyCurriculumManifest(read());
    expect(report.blockers).toEqual([]);
    expect(report.readiness).toBe(true);
    expect(report.credits).toEqual({ declared: 150, blocks: 150, required: 138, elective: 12 });
    expect(report.program).toEqual({ code: CODE, cohort: 'K2025' });
    expect(report.counts).toEqual({
      blocks: 5,
      courses: 43,
      placements: 43,
      electiveGroups: 0,
      requirements: 3,
      prerequisites: 35,
      excluded: 2,
    });
  });

  it('imports without assigning anyone', async () => {
    await importCurriculumManifest(read());
    const curriculum = await prisma.curriculum.findUniqueOrThrow({
      where: { code: CODE },
      select: { id: true, totalCredits: true, cohorts: true },
    });
    expect(curriculum.totalCredits).toBe(150);
    expect(curriculum.cohorts.map(({ cohort }) => cohort)).toEqual(['K2025']);
    expect(await prisma.user.count({ where: { curriculumId: curriculum.id } })).toBe(0);
  });

  it('stores the alternatives as groups whose external branch names no member', async () => {
    const curriculum = await prisma.curriculum.findUniqueOrThrow({
      where: { code: CODE },
      select: { id: true },
    });
    const external = await prisma.curriculumPrerequisite.findMany({
      where: { curriculumId: curriculum.id, externalPrerequisite: { not: null } },
      select: { externalPrerequisite: true, prerequisiteId: true, alternativeGroup: true },
    });
    // Four requirements accept either programming course, and the logic laboratory is an alternative
    // to a course this programme does not offer.
    expect(external).toHaveLength(5);
    expect(external.every(({ prerequisiteId }) => prerequisiteId === null)).toBe(true);
    expect(new Set(external.map(({ externalPrerequisite }) => externalPrerequisite))).toEqual(
      new Set(['IT149IU', 'EE054IU']),
    );
    expect(external.every(({ alternativeGroup }) => alternativeGroup !== null)).toBe(true);
  });

  it('publishes the external requirements the reference response used to drop', async () => {
    const { id } = await prisma.curriculum.findUniqueOrThrow({
      where: { code: CODE },
      select: { id: true },
    });
    const detail = await readCurriculumContext(id);
    // Thirty edges name a member; the other five name courses this programme does not offer, and a
    // reader that drops them reports a programme with five fewer requirements than it has.
    expect(detail!.prerequisites).toHaveLength(30);
    expect(detail!.externalPrerequisites).toHaveLength(5);
    expect(detail!.externalPrerequisites.every(({ alternativeGroup }) => alternativeGroup)).toBe(
      true,
    );
    expect(detail!.externalPrerequisites.map(({ prerequisiteCode }) => prerequisiteCode)).toEqual([
      'EE054IU',
      'IT149IU',
      'IT149IU',
      'IT149IU',
      'IT149IU',
    ]);
  });

  it('keeps physical training out of every block', async () => {
    const manifest = read() as {
      blocks: { requiredCourses: string[] }[];
      excluded: { code: string | null }[];
    };
    const required = new Set(manifest.blocks.flatMap(({ requiredCourses }) => requiredCourses));
    for (const { code } of manifest.excluded) expect(required.has(code!)).toBe(false);
  });
});
