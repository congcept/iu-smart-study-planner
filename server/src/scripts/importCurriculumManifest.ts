import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prisma } from '../db';
import { importCurriculumManifest, inspectCurriculumManifest } from '../services/curriculumImport';

const USAGE =
  'Usage: import:curriculum-manifest [--check | --apply] <manifest.json>. --check verifies and reports; --apply writes a reference curriculum and assigns nobody.';

async function main(): Promise<void> {
  const mode = process.argv[2] ?? '--check';
  const target = process.argv[3];
  if (!['--check', '--apply'].includes(mode) || !target || process.argv.length > 4)
    throw new Error(USAGE);

  const path = resolve(process.cwd(), target);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    throw new Error(`Cannot read curriculum manifest: ${path}`);
  }
  let input: unknown;
  try {
    input = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`Curriculum manifest is not valid JSON: ${path}`);
  }

  const report =
    mode === '--apply'
      ? await importCurriculumManifest(input)
      : await inspectCurriculumManifest(input);
  process.stdout.write(
    `${JSON.stringify(
      {
        path,
        ...report,
        nextStep:
          mode === '--apply'
            ? 'Stored as a reference curriculum. No account is assigned and no cohort is activated; assign deliberately, and review the source locators first.'
            : 'Run with --apply to write it. Nothing was changed by this check.',
      },
      null,
      2,
    )}\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Curriculum manifest import failed'}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
