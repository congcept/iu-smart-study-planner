import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../index';
import { importCurriculumManifest } from '../services/curriculumImport';
import { verifyCurriculumManifest } from '../services/curriculumManifest';
import { readCurriculumContext } from '../services/curriculumContexts';

const read = () =>
  JSON.parse(
    readFileSync(
      resolve(__dirname, '../../../docs/phase-1/it-computer-engineering-2025-manifest.json'),
      'utf8',
    ),
  ) as Record<string, unknown>;

const CODE = 'IT-CE';

describe('IT Computer Engineering 2025 committed manifest', () => {
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

  it('reconciles at 150 with its specialised block distinct from Network Engineering', () => {
    const report = verifyCurriculumManifest(read());
    expect(report.blockers).toEqual([]);
    expect(report.credits).toEqual({ declared: 150, blocks: 150, required: 138, elective: 12 });
    expect(report.program).toEqual({ code: CODE, cohort: 'K2025' });
    expect(report.counts).toMatchObject({
      blocks: 5,
      courses: 48,
      placements: 48,
      requirements: 3,
      prerequisites: 39,
    });
  });

  it('imports without assigning anyone', async () => {
    await importCurriculumManifest(read());
    const curriculum = await prisma.curriculum.findUniqueOrThrow({
      where: { code: CODE },
      select: { id: true, totalCredits: true },
    });
    expect(curriculum.totalCredits).toBe(150);
    expect(await prisma.user.count({ where: { curriculumId: curriculum.id } })).toBe(0);
  });

  it('keeps the special study in an earlier slot than the thesis it unlocks', async () => {
    const { id } = await prisma.curriculum.findUniqueOrThrow({
      where: { code: CODE },
      select: { id: true },
    });
    const detail = await readCurriculumContext(id);
    const slot = (code: string) => {
      const course = detail!.courses.find((entry) => entry.code === code)!;
      return course.placements.map(({ academicYear, academicSemester }) => [
        academicYear,
        academicSemester,
      ]);
    };
    // The document prints ten blocks for nine semesters and never says where the thesis sits. The
    // resolved reading is a rule: the special study precedes the thesis, and the thesis holds the
    // final term.
    expect(slot('IT083IU')).toEqual([[4, 1]]);
    expect(slot('IT058IU')).toEqual([[4, 2]]);
    const thesisEdge = detail!.prerequisites.find(
      (edge) => edge.courseId === detail!.courses.find((c) => c.code === 'IT058IU')!.id,
    );
    expect(thesisEdge).toBeDefined();
  });

  it('names one outside course as four alternative external edges', async () => {
    const { id } = await prisma.curriculum.findUniqueOrThrow({
      where: { code: CODE },
      select: { id: true },
    });
    const detail = await readCurriculumContext(id);
    // Four specialised requirements accept the Data Science programming course, and nothing in this
    // programme offers it; the same code appears in Network Engineering for the same reason.
    expect(detail!.externalPrerequisites).toHaveLength(4);
    expect(
      new Set(detail!.externalPrerequisites.map(({ prerequisiteCode }) => prerequisiteCode)),
    ).toEqual(new Set(['IT149IU']));
  });
});
