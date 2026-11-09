import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectCs2025Catalog, readCs2025CatalogEvidence } from '../services/cs2025CatalogEvidence';
import { compareReferenceCatalogs } from '../services/referenceCatalogComparison';
import { verifyCsReference } from '../services/curriculumReference';

const input = () =>
  JSON.parse(
    readFileSync(resolve(__dirname, '../../../docs/phase-1/cs-2025-catalog-evidence.json'), 'utf8'),
  ) as unknown;
const evidence = () => readCs2025CatalogEvidence(input());
const legacy = () =>
  verifyCsReference(
    JSON.parse(
      readFileSync(resolve(__dirname, '../../../scraped-courses.json'), 'utf8'),
    ) as unknown,
  );

describe('bounded CS 2025 catalog evidence', () => {
  it('retains the artifact identity, explicit free elective and every unresolved gate', () => {
    const parsed = evidence();
    expect(parsed.readiness).toBe(false);
    expect(parsed.scope).toBe('TABLE_6_CATALOG_ONLY');
    expect(parsed.source).toEqual({
      officialUrl:
        'https://hcmiu.edu.vn/wp-content/uploads/2026/04/CTDT-K2025-Nganh-Khoa-hoc-May-tinh-Signed_compressed.pdf',
      retrievedOn: '2026-10-18',
      bytes: 11072162,
      sha256: '00dc4476c314b80324b53f85fc5ead94e7f89350b93dd2b96e76d642ca160c9b',
      pdfPages: 576,
      cohort: '2025',
      programCode: '7480101',
    });
    expect(parsed.requirements).toEqual([
      { kind: 'FREE_ELECTIVE', credits: 3, pdfPage: 11, sourceRow: 54 },
    ]);
    expect(parsed.blockers.map(({ code }) => code).sort()).toEqual([
      'COHORT_AND_GRADUATION_UNVERIFIED',
      'ELECTIVE_RULE_CONFLICTS',
      'INTERNAL_SOURCE_CONFLICTS',
      'PREREQUISITE_POLICY_CONFLICTS',
    ]);
    expect(parsed.courses).toHaveLength(57);
  });
  it('reports literal identities rather than inferring substitutions or changed degree requirements', () => {
    const result = compareReferenceCatalogs(legacy(), evidence().courses);
    expect(result.sharedCodes).toHaveLength(52);
    expect(result.changedCredits).toEqual([]);
    expect(result.legacyOnly.map(({ code }) => code)).toEqual([
      'IT044IU',
      'IT154IU',
      'IT168IU',
      'MA026IU',
    ]);
    expect(result.signedOnly).toEqual([
      { code: 'IT131IU', credits: 4, pdfPage: 10 },
      { code: 'IT175IU', credits: 4, pdfPage: 10 },
      { code: 'MA033IU', credits: 3, pdfPage: 8 },
      { code: 'MA036IU', credits: 3, pdfPage: 7 },
      { code: 'PE008IU', credits: 3, pdfPage: 11 },
    ]);
  });
  it('rejects an HTML challenge or truncated PDF without returning a successful report', () => {
    for (const body of ['<script>challenge</script>', '%PDF-truncated']) {
      expect(() => inspectCs2025Catalog(legacy(), input(), Buffer.from(body))).toThrow(
        'PDF does not match',
      );
    }
  });
  it('rejects same-length unrelated bytes even with a PDF prefix', () => {
    const body = Buffer.alloc(11072162);
    body.write('%PDF-');
    expect(() => inspectCs2025Catalog(legacy(), input(), body)).toThrow('PDF does not match');
  });
  it.each([
    { readiness: true },
    { scope: 'VERIFIED_CURRICULUM' },
    { statedGraduationCredits: 130 },
    { statedGraduationCreditsPdfPage: 7 },
  ])('rejects unsupported evidence claims %#', (change) => {
    expect(() => readCs2025CatalogEvidence({ ...evidence(), ...change })).toThrow();
  });
  it.each([
    { sha256: '0'.repeat(64) },
    { bytes: 1 },
    { pdfPages: 575 },
    { cohort: '2024' },
    { programCode: '7480103' },
    { retrievedOn: '2026-10-19' },
    { officialUrl: 'https://example.test/curriculum.pdf' },
  ])('rejects a different source artifact identity %#', (change) => {
    const parsed = evidence();
    expect(() =>
      readCs2025CatalogEvidence({ ...parsed, source: { ...parsed.source, ...change } }),
    ).toThrow();
  });
  it('rejects duplicate/missing catalog identities and non-catalog page locators', () => {
    const parsed = evidence();
    expect(() =>
      readCs2025CatalogEvidence({ ...parsed, courses: parsed.courses.slice(1) }),
    ).toThrow();
    const duplicate = [...parsed.courses];
    duplicate[1] = duplicate[0];
    expect(() => readCs2025CatalogEvidence({ ...parsed, courses: duplicate })).toThrow();
    for (const pdfPage of [6, 12, 576, 1.5]) {
      const courses = [...parsed.courses];
      courses[0] = { ...courses[0], pdfPage };
      expect(() => readCs2025CatalogEvidence({ ...parsed, courses })).toThrow();
    }
  });
  it('rejects fractional credits and blank requirement codes masquerading as courses', () => {
    const parsed = evidence();
    for (const change of [{ credits: 1.5 }, { code: '' }, { prerequisites: [] }]) {
      const courses = [...parsed.courses];
      courses[0] = { ...courses[0], ...change };
      expect(() => readCs2025CatalogEvidence({ ...parsed, courses })).toThrow();
    }
    expect(() => readCs2025CatalogEvidence({ ...parsed, requirements: [] })).toThrow();
  });
  it('rejects lost/duplicate blocker categories and out-of-document locators', () => {
    const parsed = evidence();
    expect(() =>
      readCs2025CatalogEvidence({ ...parsed, blockers: parsed.blockers.slice(1) }),
    ).toThrow();
    const blockers = [...parsed.blockers];
    blockers[1] = blockers[0];
    expect(() => readCs2025CatalogEvidence({ ...parsed, blockers })).toThrow();
    expect(() =>
      readCs2025CatalogEvidence({
        ...parsed,
        blockers: parsed.blockers.map((row) => ({ ...row, pdfPages: [577] })),
      }),
    ).toThrow();
  });
  it('does not accept extra activation/graph metadata or mutate source evidence', () => {
    const parsed = evidence();
    const before = JSON.stringify(parsed);
    Object.freeze(parsed.courses);
    Object.freeze(parsed);
    expect(compareReferenceCatalogs(legacy(), parsed.courses).sharedCodes).toHaveLength(52);
    expect(JSON.stringify(parsed)).toBe(before);
    expect(() =>
      readCs2025CatalogEvidence({ ...parsed, prerequisites: [], active: true }),
    ).toThrow();
  });
});
