import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyCurriculumManifest } from '../services/curriculumManifest';

const USAGE = 'Usage: verify:curriculum-manifest <manifest.json>';

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target || process.argv.length > 3) throw new Error(USAGE);
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
  const report = verifyCurriculumManifest(input);
  process.stdout.write(
    `${JSON.stringify(
      {
        path,
        ...report,
        nextStep: report.readiness
          ? 'Self-consistent. The document it transcribes has not been re-read: review the source locators before any import.'
          : 'Not importable. Resolve every blocker in the source document; do not correct the manifest alone.',
      },
      null,
      2,
    )}\n`,
  );
  if (!report.readiness) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Curriculum manifest verification failed'}\n`,
  );
  process.exitCode = 1;
});
