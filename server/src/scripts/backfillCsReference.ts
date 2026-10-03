import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prisma } from '../db';
import { backfillCsReference } from '../services/csReferenceBackfill';

async function main(): Promise<void> {
  // Inspection is a separate read-only command. Writing always requires --apply.
  if (process.argv[2] !== '--apply' || process.argv.length > 4) {
    throw new Error(
      'Usage: backfill:cs-reference --apply [source-file]. Inspect first with inspect:cs-backfill.',
    );
  }
  const sourcePath = process.argv[3]
    ? resolve(process.cwd(), process.argv[3])
    : resolve(__dirname, '../../../scraped-courses.json');
  let bytes: Buffer;
  try {
    bytes = await readFile(sourcePath);
  } catch {
    throw new Error(`Cannot read CS reference file: ${sourcePath}`);
  }
  const result = await backfillCsReference(bytes);
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: 'APPLIED_LEGACY_REFERENCE',
        sourcePath,
        ...result,
        notice:
          'Legacy prerequisite flags are provenance; all edges remain mandatory. No global courses or student assignments changed. Signed cohort, prerequisite and graduation-total reconciliation is still required before activation.',
      },
      null,
      2,
    )}\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'CS reference backfill failed'}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
