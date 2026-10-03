import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  CsReferenceValidationError,
  verifyCsReference,
  type CsReferenceVerification,
} from '../services/curriculumReference';

async function main(): Promise<void> {
  if (process.argv.length > 3) throw new Error('Usage: verify:cs-reference [source-file]');
  const sourcePath = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : resolve(__dirname, '../../../scraped-courses.json');
  let source: Buffer;
  try {
    source = await readFile(sourcePath);
  } catch {
    throw new Error(`Cannot read CS reference file: ${sourcePath}`);
  }
  let input: unknown;
  try {
    input = JSON.parse(source.toString('utf8')) as unknown;
  } catch {
    throw new Error(`Invalid JSON in CS reference file: ${sourcePath}`);
  }
  let verified: CsReferenceVerification;
  try {
    verified = verifyCsReference(input);
  } catch (error) {
    if (error instanceof CsReferenceValidationError) {
      throw new Error(`Invalid CS reference file: ${sourcePath}\n${error.message}`);
    }
    throw error;
  }
  const report = {
    source: {
      path: sourcePath,
      sha256: createHash('sha256').update(source).digest('hex'),
      programUrl:
        'https://hcmiu.edu.vn/chuong-trinh-dao-tao/dao-tao-dai-hoc/khoa-cong-nghe-thong-tin/',
      code: 'CS-REFERENCE',
      provenance: 'LEGACY_HTML_REFERENCE',
    },
    readiness: false,
    blockers: [
      'Cohort and signed official curriculum are not verified.',
      'Curriculum-context prerequisites are not verified.',
      'Graduation totals and GPA-path rules require source reconciliation; catalog option credits are not graduation credits.',
      'Free-elective requirement database representation is pending.',
    ],
    creditUnits: 'Legacy lectureHours/labHours represent credit units, not verified contact hours.',
    ...verified,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'CS reference verification failed'}\n`,
  );
  process.exitCode = 1;
});
