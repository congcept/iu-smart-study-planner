import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inspectCs2025Catalog, readCs2025CatalogEvidence } from '../services/cs2025CatalogEvidence';
import { verifyCsReference } from '../services/curriculumReference';

async function main(): Promise<void> {
  if (process.argv.length !== 3) throw new Error('Usage: inspect:cs2025-catalog <signed-pdf-file>');
  const evidencePath = resolve(__dirname, '../../../docs/phase-1/cs-2025-catalog-evidence.json');
  const legacyPath = resolve(__dirname, '../../../scraped-courses.json');
  const evidence = readCs2025CatalogEvidence(
    JSON.parse(await readFile(evidencePath, 'utf8')) as unknown,
  );
  const sourcePath = resolve(process.cwd(), process.argv[2]);
  if ((await stat(sourcePath)).size !== evidence.source.bytes)
    throw new Error('PDF does not match the reviewed CS 2025 source artifact');
  const source = await readFile(sourcePath);
  const legacyBytes = await readFile(legacyPath);
  const legacy = verifyCsReference(JSON.parse(legacyBytes.toString('utf8')) as unknown);
  const report = inspectCs2025Catalog(legacy, evidence, source);
  process.stdout.write(
    `${JSON.stringify({ ...report, legacySourceSha256: createHash('sha256').update(legacyBytes).digest('hex') }, null, 2)}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'CS 2025 catalog inspection failed'}\n`,
  );
  process.exitCode = 1;
});
