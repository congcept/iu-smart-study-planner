import { Prisma } from '@prisma/client';
import config from '../config';
import { prisma } from '../db';
import {
  verifyCurriculumManifest,
  type CurriculumManifest,
  type CurriculumManifestReport,
} from './curriculumManifest';

export class CurriculumImportError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 = 400,
  ) {
    super(message);
  }
}

export interface CurriculumImportReport {
  mode: 'CHECK' | 'APPLIED';
  program: { code: string; cohort: string };
  source: { label: string; sha256: string; pages: string };
  verification: CurriculumManifestReport;
  counts: {
    courses: number;
    memberships: number;
    placements: number;
    requirements: number;
    prerequisites: number;
  };
  notice: string;
}

const NOTICE =
  'A reference transcription of one signed document. It activates no cohort and validates no graduation, elective or calendar rule; no account is assigned by this import.';

/** Every manifest write refuses an unverified manifest. There is no partial-import path. */
function verified(input: unknown): CurriculumManifest {
  const report = verifyCurriculumManifest(input);
  if (!report.readiness)
    throw new CurriculumImportError(`Manifest is not importable: ${report.blockers.join('; ')}`);
  return input as CurriculumManifest;
}

async function existingConflicts(manifest: CurriculumManifest) {
  const codes = manifest.courses.map((course) => course.code);
  const rows = await prisma.course.findMany({
    where: { code: { in: codes } },
    select: { code: true, credits: true, name: true },
  });
  return rows
    .map((row) => {
      const declared = manifest.courses.find((course) => course.code === row.code);
      if (!declared) return null;
      if (declared.credits !== row.credits)
        return `${row.code} is ${row.credits} credits in the catalogue but ${declared.credits} in the manifest`;
      return null;
    })
    .filter((conflict): conflict is string => conflict !== null);
}

/**
 * Writes one verified manifest into a curriculum, its cohort link and its structure. Replaces the
 * placements, requirements and prerequisites of that curriculum wholesale, so a rerun converges on
 * the manifest rather than accumulating rows. It never touches accounts, records or grades.
 */
export async function importCurriculumManifest(input: unknown): Promise<CurriculumImportReport> {
  const manifest = verified(input);
  if (config.nodeEnv === 'production')
    throw new CurriculumImportError('A curriculum manifest never imports in production');

  const verification = verifyCurriculumManifest(manifest);
  const conflicts = await existingConflicts(manifest);
  if (conflicts.length) throw new CurriculumImportError(conflicts.join('; '), 409);

  const { program, source } = manifest;
  const cohort = program.cohort.trim();

  await prisma.$transaction(
    async (tx) => {
      const curriculum = await tx.curriculum.upsert({
        where: { code: program.code },
        create: {
          code: program.code,
          name: program.name,
          school: program.school,
          degree: program.degree,
          programUrl: program.programUrl,
          totalCredits: manifest.totalCredits,
          sourceLabel: source.label,
          sourceUrl: source.url,
        },
        update: {
          name: program.name,
          school: program.school,
          degree: program.degree,
          programUrl: program.programUrl,
          totalCredits: manifest.totalCredits,
          sourceLabel: source.label,
          sourceUrl: source.url,
        },
        select: { id: true },
      });

      await tx.curriculumCohort.upsert({
        where: { curriculumId_cohort: { curriculumId: curriculum.id, cohort } },
        create: {
          curriculumId: curriculum.id,
          cohort,
          sourceLabel: source.label,
          sourceUrl: source.url,
        },
        update: { sourceLabel: source.label, sourceUrl: source.url },
      });

      for (const course of manifest.courses) {
        await tx.course.upsert({
          where: { code: course.code },
          create: {
            code: course.code,
            name: course.name,
            credits: course.credits,
            difficultyLevel: 3,
          },
          update: {},
        });
      }

      const catalogue = await tx.course.findMany({
        where: { code: { in: manifest.courses.map((course) => course.code) } },
        select: { id: true, code: true },
      });
      const idByCode = new Map(catalogue.map((row) => [row.code, row.id]));
      const idOf = (code: string) => {
        const id = idByCode.get(code);
        if (!id) throw new CurriculumImportError(`Course ${code} was not stored`);
        return id;
      };

      // Replace the structure rather than patching it, so a rerun converges and a corrected manifest
      // leaves no stale placement behind.
      await tx.curriculumPlacement.deleteMany({
        where: { curriculumCourse: { curriculumId: curriculum.id } },
      });
      await tx.curriculumPrerequisite.deleteMany({ where: { curriculumId: curriculum.id } });
      await tx.curriculumRequirement.deleteMany({ where: { curriculumId: curriculum.id } });
      await tx.curriculumCourse.deleteMany({ where: { curriculumId: curriculum.id } });
      await tx.curriculumCourse.createMany({
        data: manifest.courses.map((course) => ({
          curriculumId: curriculum.id,
          courseId: idOf(course.code),
        })),
      });

      const members = await tx.curriculumCourse.findMany({
        where: { curriculumId: curriculum.id },
        select: { id: true, courseId: true },
      });
      const memberByCourse = new Map(members.map((row) => [row.courseId, row.id]));
      const memberOf = (code: string) => {
        const id = memberByCourse.get(idOf(code));
        if (!id) throw new CurriculumImportError(`Course ${code} has no membership`);
        return id;
      };

      await tx.curriculumPlacement.createMany({
        data: manifest.placements.map((placement) => ({
          curriculumCourseId: memberOf(placement.code),
          academicYear: placement.year,
          academicSemester: placement.semester,
          electiveGroup: placement.group,
          electiveSelectCount: placement.selectCount,
          electiveSelectCredits: placement.selectCredits,
          sourceOrder: placement.sourceOrder,
          sourceLabel: source.label,
        })),
      });

      if (manifest.requirements.length)
        await tx.curriculumRequirement.createMany({
          data: manifest.requirements.map((requirement) => ({
            curriculumId: curriculum.id,
            kind: requirement.kind,
            name: requirement.name,
            credits: requirement.credits,
            academicYear: requirement.year,
            academicSemester: requirement.semester,
            sourceOrder: requirement.sourceOrder,
            sourceLabel: source.label,
          })),
        });

      if (manifest.prerequisites.length)
        await tx.curriculumPrerequisite.createMany({
          data: manifest.prerequisites.map((edge) => ({
            curriculumId: curriculum.id,
            courseId: idOf(edge.course),
            prerequisiteId: edge.external ? null : idOf(edge.prerequisite),
            externalPrerequisite: edge.external ? edge.prerequisite : null,
            kind: edge.kind,
            alternativeGroup: edge.alternativeGroup,
          })),
        });

      return curriculum;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  return {
    mode: 'APPLIED',
    program: { code: program.code, cohort },
    source: { label: source.label, sha256: source.sha256, pages: source.pages },
    verification,
    counts: {
      courses: manifest.courses.length,
      memberships: manifest.courses.length,
      placements: manifest.placements.length,
      requirements: manifest.requirements.length,
      prerequisites: manifest.prerequisites.length,
    },
    notice: NOTICE,
  };
}

/** Read-only: proves the manifest verifies and reports what an import would write. */
export async function inspectCurriculumManifest(input: unknown): Promise<CurriculumImportReport> {
  const verification = verifyCurriculumManifest(input);
  if (!verification.readiness)
    throw new CurriculumImportError(
      `Manifest is not importable: ${verification.blockers.join('; ')}`,
    );
  const manifest = input as CurriculumManifest;
  return {
    mode: 'CHECK',
    program: { code: manifest.program.code, cohort: manifest.program.cohort.trim() },
    source: {
      label: manifest.source.label,
      sha256: manifest.source.sha256,
      pages: manifest.source.pages,
    },
    verification,
    counts: {
      courses: manifest.courses.length,
      memberships: manifest.courses.length,
      placements: manifest.placements.length,
      requirements: manifest.requirements.length,
      prerequisites: manifest.prerequisites.length,
    },
    notice: NOTICE,
  };
}
