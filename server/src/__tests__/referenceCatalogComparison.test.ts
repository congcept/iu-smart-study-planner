import { readFileSync } from 'fs';
import { resolve } from 'path';
import { verifyCsReference } from '../services/curriculumReference';
import { compareReferenceCatalogs } from '../services/referenceCatalogComparison';

const reference = () =>
  verifyCsReference(
    JSON.parse(readFileSync(resolve(__dirname, '../../../scraped-courses.json'), 'utf8')),
  );

function deepFreeze(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
}

describe('read-only exact reference catalog comparison', () => {
  it('compares the real legacy identities to a synthetic signed subset without inferring renames', () => {
    const legacy = reference();
    const first = legacy.courses.find(({ code }) => code === 'MA001IU');
    if (!first) throw new Error('Expected legacy MA001IU fixture');
    const result = compareReferenceCatalogs(legacy, [
      { code: first.code, credits: first.credits, pdfPage: 57 },
      { code: 'ZZ999IU', credits: 3, pdfPage: 58 },
    ]);
    expect(result.sharedCodes).toEqual(['MA001IU']);
    expect(result.legacyOnly).toHaveLength(55);
    expect(result.legacyOnly).toEqual(
      legacy.courses
        .filter(({ code }) => code !== first.code)
        .map(({ code, credits }) => ({ code, credits }))
        .sort((left, right) => (left.code < right.code ? -1 : left.code > right.code ? 1 : 0)),
    );
    expect(result.signedOnly).toEqual([{ code: 'ZZ999IU', credits: 3, pdfPage: 58 }]);
    expect(result.changedCredits).toEqual([]);
    expect(Object.keys(result).sort()).toEqual([
      'changedCredits',
      'legacyOnly',
      'sharedCodes',
      'signedOnly',
    ]);
  });

  it('counts canonical identities once despite repeated elective placements', () => {
    const legacy = reference();
    expect(legacy.placements).toHaveLength(71);
    expect(legacy.courses).toHaveLength(56);
    expect(legacy.placements.filter(({ code }) => code === 'IT160IU').length).toBeGreaterThan(1);
    const signed = legacy.courses.map(({ code, credits }) => ({
      code,
      credits,
      pdfPage: 57,
    }));
    const result = compareReferenceCatalogs(legacy, signed);
    expect(result.sharedCodes).toHaveLength(56);
    expect(result.sharedCodes.filter((code) => code === 'IT160IU')).toHaveLength(1);
    expect(result.legacyOnly).toEqual([]);
    expect(result.signedOnly).toEqual([]);
    expect(result.changedCredits).toEqual([]);
  });

  it('reports both credit values and physical PDF page for every exact-code conflict', () => {
    const legacy = reference();
    const courses = legacy.courses.slice(0, 2);
    const result = compareReferenceCatalogs(
      legacy,
      courses.map(({ code, credits }, index) => ({
        code,
        credits: credits + 1,
        pdfPage: 57 + index,
      })),
    );
    expect(result.changedCredits).toEqual(
      courses
        .map(({ code, credits }, index) => ({
          code,
          legacyCredits: credits,
          signedCredits: credits + 1,
          pdfPage: 57 + index,
        }))
        .sort((left, right) => (left.code < right.code ? -1 : left.code > right.code ? 1 : 0)),
    );
    expect(result.sharedCodes).toEqual(result.changedCredits.map(({ code }) => code));
  });

  it('does not mutate deeply frozen input or retain output references to source rows', () => {
    const legacy = reference();
    const signed = [{ code: 'ZZ999IU', credits: 3, pdfPage: 57 }];
    const before = JSON.stringify({ legacy, signed });
    deepFreeze(legacy);
    deepFreeze(signed);
    const result = compareReferenceCatalogs(legacy, signed);
    expect(JSON.stringify({ legacy, signed })).toBe(before);
    result.signedOnly[0].credits = 9;
    result.legacyOnly[0].credits = 9;
    expect(JSON.stringify({ legacy, signed })).toBe(before);
  });

  it('produces identical ASCII code-sorted reports regardless of source row ordering', () => {
    const legacy = reference();
    const signed = [
      ...legacy.courses.slice(0, 5).map(({ code, credits }) => ({
        code,
        credits: credits + 1,
        pdfPage: 57,
      })),
      { code: 'ZZ999IU', credits: 3, pdfPage: 58 },
      { code: 'AA999IU', credits: 2, pdfPage: 59 },
    ];
    const result = compareReferenceCatalogs(legacy, signed);
    expect(
      compareReferenceCatalogs(
        { ...legacy, courses: [...legacy.courses].reverse() },
        [...signed].reverse(),
      ),
    ).toEqual(result);
    for (const codes of [
      result.sharedCodes,
      ...[result.legacyOnly, result.signedOnly, result.changedCredits].map((rows) =>
        rows.map(({ code }) => code),
      ),
    ]) {
      expect(codes).toEqual([...codes].sort());
    }
  });

  it('supports an explicit empty signed catalog without declaring readiness or degree totals', () => {
    const result = compareReferenceCatalogs(reference(), []);
    expect(result.sharedCodes).toEqual([]);
    expect(result.legacyOnly).toHaveLength(56);
    expect(result.signedOnly).toEqual([]);
    expect(result.changedCredits).toEqual([]);
  });

  it.each([null, undefined, {}, 'catalog', 1, [null], [{}]])(
    'rejects malformed signed root or row %#',
    (input) => {
      expect(() => compareReferenceCatalogs(reference(), input)).toThrow();
    },
  );

  it.each([
    'it001iu',
    ' IT001IU',
    'IT001IU ',
    'IT1IU',
    'IT001',
    'A001IU',
    '',
    'IT001IU\n',
    1,
    null,
  ])('rejects malformed signed code %#', (code) => {
    expect(() =>
      compareReferenceCatalogs(reference(), [{ code, credits: 3, pdfPage: 57 }]),
    ).toThrow();
  });

  it.each([NaN, Infinity, -Infinity, 0, -1, 1.5, '3', null, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid, unsafe or fractional credits/page %#',
    (invalid) => {
      expect(() =>
        compareReferenceCatalogs(reference(), [{ code: 'IT001IU', credits: invalid, pdfPage: 57 }]),
      ).toThrow();
      expect(() =>
        compareReferenceCatalogs(reference(), [{ code: 'IT001IU', credits: 3, pdfPage: invalid }]),
      ).toThrow();
    },
  );

  it('rejects unmodeled fields rather than silently discarding source evidence', () => {
    for (const extra of [{ name: 'Translation' }, { prerequisites: [] }, { ready: true }]) {
      expect(() =>
        compareReferenceCatalogs(reference(), [
          { code: 'IT001IU', credits: 3, pdfPage: 57, ...extra },
        ]),
      ).toThrow();
    }
  });

  it('rejects duplicate signed identities even if their credit values agree', () => {
    const row = { code: 'IT001IU', credits: 3, pdfPage: 57 };
    expect(() => compareReferenceCatalogs(reference(), [row, { ...row }])).toThrow(
      'Duplicate course code in signed catalog: IT001IU',
    );
    expect(() => compareReferenceCatalogs(reference(), [row, { ...row, credits: 4 }])).toThrow(
      'Duplicate course code in signed catalog: IT001IU',
    );
  });

  it('defensively rejects duplicate or invalid canonical legacy credits', () => {
    const legacy = reference();
    expect(() =>
      compareReferenceCatalogs({ ...legacy, courses: [...legacy.courses, legacy.courses[0]] }, []),
    ).toThrow('Duplicate course code in legacy reference');
    for (const credits of [1.5, -1, 0, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        compareReferenceCatalogs({ ...legacy, courses: [{ ...legacy.courses[0], credits }] }, []),
      ).toThrow();
    }
  });
});
