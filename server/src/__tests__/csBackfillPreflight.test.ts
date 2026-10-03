import {
  inspectCsBackfill,
  type BackfillCourseIdentity,
  type BackfillPrerequisite,
} from '../services/csBackfillPreflight';

const course = (id: string, name: string) => ({
  id,
  name,
  credits: 3,
  lectureHours: 3,
  labHours: 0,
  year: 1,
  semester: 1,
  isElective: false,
  selectCount: 0,
});
const source = () => [
  {
    year: 1,
    semester: 1,
    courses: [
      course('MA001IU', 'Calculus'),
      course('IT064IU', 'Computing'),
      course('', 'Free elective'),
    ],
  },
];
const catalog: BackfillCourseIdentity[] = [
  { id: 'a', code: 'MA001IU', name: 'Calculus', credits: 3 },
  { id: 'b', code: 'IT064IU', name: 'Computing', credits: 3 },
];
const edge: BackfillPrerequisite = {
  courseId: 'b',
  prerequisiteId: 'a',
  isStrict: false,
  isCorequisite: true,
};

describe('CS backfill identity preflight', () => {
  it('maps every source code to existing IDs and preserves requirements and legacy edge flags', () => {
    const result = inspectCsBackfill(source(), catalog, [edge]);
    expect(result.compatible).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.preview?.courseIds).toEqual([
      { code: 'MA001IU', courseId: 'a' },
      { code: 'IT064IU', courseId: 'b' },
    ]);
    expect(result.preview?.source.requirements).toMatchObject([
      { name: 'Free elective', credits: 3, sourceOrder: 2 },
    ]);
    expect(result.preview?.prerequisites).toEqual([edge]);
  });

  it('reports missing identities and returns no partial write preview', () => {
    expect(inspectCsBackfill(source(), catalog.slice(0, 1), [])).toMatchObject({
      compatible: false,
      preview: null,
      issues: [{ kind: 'MISSING_COURSE', code: 'IT064IU' }],
    });
  });

  it.each([
    [{ ...catalog[0], name: 'Different name' }, 'CONFLICTING_NAME'],
    [{ ...catalog[0], credits: 4 }, 'CONFLICTING_CREDITS'],
  ] as const)(
    'reports global metadata conflicts without changing the source or catalog %#',
    (conflict, kind) => {
      const rows = [conflict, catalog[1]];
      const before = JSON.stringify(rows);
      expect(inspectCsBackfill(source(), rows, [])).toMatchObject({
        compatible: false,
        preview: null,
        issues: [{ kind, code: 'MA001IU' }],
      });
      expect(JSON.stringify(rows)).toBe(before);
    },
  );

  it('rejects ambiguous code or ID mappings', () => {
    for (const duplicate of [
      { ...catalog[0], id: 'other' },
      { ...catalog[1], id: 'a' },
    ]) {
      expect(inspectCsBackfill(source(), [...catalog, duplicate], [])).toMatchObject({
        compatible: false,
        preview: null,
        issues: expect.arrayContaining([expect.objectContaining({ kind: 'AMBIGUOUS_CATALOG' })]),
      });
    }
  });

  it('blocks prerequisite references outside the source membership', () => {
    expect(
      inspectCsBackfill(source(), catalog, [{ ...edge, prerequisiteId: 'external' }]),
    ).toMatchObject({
      compatible: false,
      preview: null,
      issues: [{ kind: 'EXTERNAL_PREREQUISITE', code: 'IT064IU', prerequisiteId: 'external' }],
    });
  });

  it('ignores incoming dependencies from courses outside this reference instead of unioning programs', () => {
    const result = inspectCsBackfill(source(), catalog, [
      edge,
      { ...edge, courseId: 'another-program' },
    ]);
    expect(result.compatible).toBe(true);
    expect(result.preview?.prerequisites).toEqual([edge]);
  });

  it('blocks repeated legacy edges instead of silently collapsing inconsistent input', () => {
    expect(inspectCsBackfill(source(), catalog, [edge, { ...edge, isStrict: true }])).toMatchObject(
      {
        compatible: false,
        preview: null,
        issues: [{ kind: 'DUPLICATE_PREREQUISITE', code: 'IT064IU', prerequisiteId: 'a' }],
      },
    );
  });

  it('preserves repeated placements while mapping a global identity only once', () => {
    const input = [
      ...source(),
      {
        year: 2,
        semester: 1,
        courses: [
          {
            ...course('MA001IU', 'Calculus'),
            year: 2,
            isElective: true,
            electiveGroup: 'Group 1',
            selectCount: 1,
          },
        ],
      },
    ];
    const result = inspectCsBackfill(input, catalog, []);
    expect(result.compatible).toBe(true);
    expect(result.preview?.courseIds).toHaveLength(2);
    expect(result.preview?.source.placements.filter(({ code }) => code === 'MA001IU')).toHaveLength(
      2,
    );
  });

  it('validates malformed source before creating a preview', () => {
    expect(() =>
      inspectCsBackfill(
        [{ year: 1, semester: 1, courses: [course('invalid', 'Invalid')] }],
        catalog,
        [],
      ),
    ).toThrow('Invalid course code');
  });
});
