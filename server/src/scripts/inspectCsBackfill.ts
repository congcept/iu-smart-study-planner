import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { verifyCsReference } from '../services/curriculumReference';
import { inspectCsBackfill } from '../services/csBackfillPreflight';

async function main(): Promise<void> {
  if (process.argv.length > 3) throw new Error('Usage: inspect:cs-backfill [source-file]');
  const sourcePath = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : resolve(__dirname, '../../../scraped-courses.json');
  let bytes: Buffer;
  try {
    bytes = await readFile(sourcePath);
  } catch {
    throw new Error(`Cannot read CS reference file: ${sourcePath}`);
  }
  let input: unknown;
  try {
    input = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error(`Invalid JSON in CS reference file: ${sourcePath}`);
  }
  const source = verifyCsReference(input);
  const report = await prisma.$transaction(
    async (tx) => {
      const catalog = await tx.course.findMany({
        where: { code: { in: source.courses.map(({ code }) => code) } },
        select: { id: true, code: true, name: true, credits: true },
      });
      const prerequisites = await tx.prerequisite.findMany({
        where: { courseId: { in: catalog.map(({ id }) => id) } },
        select: { courseId: true, prerequisiteId: true, isStrict: true, isCorequisite: true },
        orderBy: [{ courseId: 'asc' }, { prerequisiteId: 'asc' }],
      });
      return inspectCsBackfill(input, catalog, prerequisites);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        source: {
          path: sourcePath,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          provenance: 'LEGACY_HTML_REFERENCE',
        },
        mode: 'READ_ONLY',
        ...report,
        notice:
          'Database compatibility does not verify cohort, institutional prerequisites or graduation totals. No context rows, global courses or student assignments are written.',
      },
      null,
      2,
    )}\n`,
  );
  if (!report.compatible) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'CS backfill inspection failed'}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
