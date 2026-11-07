import { verifyCurriculumManifest, type CurriculumManifest } from '../services/curriculumManifest';

/** A small but complete manifest: two required blocks plus one credit-stated elective pool. */
function manifest(changes: Record<string, unknown> = {}): Record<string, unknown> {
  const base: CurriculumManifest = {
    program: {
      code: 'SIM',
      name: 'Simulated program',
      school: 'CSE',
      degree: 'Bachelor',
      programUrl: 'https://example.test/program',
      cohort: 'K2025',
    },
    source: {
      label: 'Simulated signed document',
      url: 'https://example.test/document.pdf',
      sha256: 'a'.repeat(64),
      pages: '5-12',
      retrievedOn: '2026-11-07',
    },
    totalCredits: 14,
    excluded: [
      {
        kind: 'PHYSICAL_TRAINING',
        code: 'PT001IU',
        credits: 3,
        reason: 'Physical training is excluded from the credit total and the grade average',
      },
    ],
    blocks: [
      {
        code: 'I',
        name: 'General education',
        requiredCredits: 6,
        electiveCredits: 0,
        requiredCourses: ['MA001IU', 'EN007IU'],
      },
      {
        code: 'III',
        name: 'Specialised',
        requiredCredits: 4,
        electiveCredits: 4,
        requiredCourses: ['IT069IU'],
      },
    ],
    courses: [
      { code: 'MA001IU', name: 'Calculus 1', credits: 3, lecture: 3, lab: 0 },
      { code: 'EN007IU', name: 'Writing AE1', credits: 3, lecture: 3, lab: 0 },
      { code: 'IT069IU', name: 'Object-Oriented Programming', credits: 4, lecture: 3, lab: 1 },
      {
        code: 'IT079IU',
        name: 'Principles of Database Management',
        credits: 4,
        lecture: 3,
        lab: 1,
      },
      { code: 'IT120IU', name: 'Entrepreneurship', credits: 3, lecture: 3, lab: 0 },
      { code: 'PT001IU', name: 'Physical Training 1', credits: 3, lecture: 0, lab: 3 },
    ],
    placements: [
      {
        code: 'MA001IU',
        year: 1,
        semester: 1,
        group: null,
        selectCount: null,
        selectCredits: null,
        sourceOrder: 0,
      },
      {
        code: 'EN007IU',
        year: 1,
        semester: 1,
        group: null,
        selectCount: null,
        selectCredits: null,
        sourceOrder: 1,
      },
      {
        code: 'IT069IU',
        year: 2,
        semester: 1,
        group: null,
        selectCount: null,
        selectCredits: null,
        sourceOrder: 2,
      },
      {
        code: 'IT079IU',
        year: 2,
        semester: 1,
        group: 'Elective group 01',
        selectCount: null,
        selectCredits: 4,
        sourceOrder: 3,
      },
      {
        code: 'IT120IU',
        year: 2,
        semester: 1,
        group: 'Elective group 01',
        selectCount: null,
        selectCredits: 4,
        sourceOrder: 4,
      },
    ],
    requirements: [],
    prerequisites: [{ course: 'IT079IU', prerequisite: 'IT069IU', kind: 'HT' }],
  };
  return { ...base, ...changes };
}

type TestBlock = {
  code: string;
  name: string;
  requiredCredits: number;
  electiveCredits: number;
  requiredCourses: string[];
};
type TestPlacement = {
  code: string;
  year: number | null;
  semester: number | null;
  group: string | null;
  selectCount: number | null;
  selectCredits: number | null;
  sourceOrder: number;
};

const blocksOf = (input: Record<string, unknown>) => input.blocks as TestBlock[];
const placementsOf = (input: Record<string, unknown>) => input.placements as TestPlacement[];

const categories = (input: unknown) =>
  verifyCurriculumManifest(input).issues.map(({ category }) => category);

describe('curriculum manifest verification', () => {
  it('accepts a self-consistent manifest and reports its arithmetic', () => {
    const report = verifyCurriculumManifest(manifest());
    expect(report.readiness).toBe(true);
    expect(report.mode).toBe('REFERENCE_ONLY');
    expect(report.blockers).toEqual([]);
    expect(report.program).toEqual({ code: 'SIM', cohort: 'K2025' });
    expect(report.source?.sha256).toBe('a'.repeat(64));
    expect(report.counts).toEqual({
      blocks: 2,
      courses: 6,
      placements: 5,
      electiveGroups: 1,
      requirements: 0,
      prerequisites: 1,
      excluded: 1,
    });
    expect(report.credits).toEqual({ declared: 14, blocks: 14, required: 10, elective: 4 });
  });

  it('fails closed on an unexpected shape instead of throwing', () => {
    const report = verifyCurriculumManifest({ program: { code: 'SIM' } });
    expect(report.readiness).toBe(false);
    expect(report.program).toBeNull();
    expect(report.credits).toBeNull();
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it('rejects a course whose units do not sum to its credits', () => {
    const report = verifyCurriculumManifest(
      manifest({
        courses: [
          { code: 'MA001IU', name: 'Calculus 1', credits: 4, lecture: 3, lab: 0 },
          { code: 'EN007IU', name: 'Writing AE1', credits: 3, lecture: 3, lab: 0 },
          { code: 'IT069IU', name: 'Object-Oriented Programming', credits: 4, lecture: 3, lab: 1 },
          {
            code: 'IT079IU',
            name: 'Principles of Database Management',
            credits: 4,
            lecture: 3,
            lab: 1,
          },
          { code: 'IT120IU', name: 'Entrepreneurship', credits: 3, lecture: 3, lab: 0 },
          { code: 'PT001IU', name: 'Physical Training 1', credits: 3, lecture: 0, lab: 3 },
        ],
      }),
    );
    expect(report.readiness).toBe(false);
    expect(report.issues.some(({ message }) => /sum to the declared credits/.test(message))).toBe(
      true,
    );
  });

  it('rejects a placement that names an unknown course', () => {
    const report = verifyCurriculumManifest(
      manifest({
        placements: [
          ...placementsOf(manifest()),
          {
            code: 'ZZ999IU',
            year: 3,
            semester: 1,
            group: null,
            selectCount: null,
            selectCredits: null,
            sourceOrder: 9,
          },
        ],
      }),
    );
    expect(report.readiness).toBe(false);
    expect(
      categories(
        manifest({
          placements: [
            ...placementsOf(manifest()),
            {
              code: 'ZZ999IU',
              year: 3,
              semester: 1,
              group: null,
              selectCount: null,
              selectCredits: null,
              sourceOrder: 9,
            },
          ],
        }),
      ),
    ).toContain('PLACEMENT');
  });

  it('rejects the same course placed twice in one slot', () => {
    const report = verifyCurriculumManifest(
      manifest({
        placements: [
          ...placementsOf(manifest()),
          {
            code: 'MA001IU',
            year: 1,
            semester: 1,
            group: null,
            selectCount: null,
            selectCredits: null,
            sourceOrder: 10,
          },
        ],
      }),
    );
    expect(report.issues.some(({ message }) => /Duplicate placement/.test(message))).toBe(true);
  });

  it('rejects a block whose declared credits disagree with its own courses', () => {
    const blocked = manifest();
    const blocks = blocksOf(blocked).map((block, index) =>
      index === 0 ? { ...block, requiredCredits: 7 } : block,
    );
    const report = verifyCurriculumManifest({ ...blocked, blocks, totalCredits: 15 });
    expect(report.readiness).toBe(false);
    expect(report.issues.some(({ message }) => /its courses total 6/.test(message))).toBe(true);
  });

  it('rejects blocks that do not add up to the declared program total', () => {
    const report = verifyCurriculumManifest(manifest({ totalCredits: 124 }));
    expect(report.readiness).toBe(false);
    expect(
      report.issues.some(({ message }) =>
        /Blocks total 14 credits but the program declares 124/.test(message),
      ),
    ).toBe(true);
  });

  it('rejects a pool whose options state different units', () => {
    const mixed = manifest();
    // One option states a course count, the other a credit total: the same pool, two units.
    const placements = placementsOf(mixed).map((placement, index) =>
      placement.group === null || index !== 3
        ? placement
        : { ...placement, selectCount: 1, selectCredits: null },
    );
    const report = verifyCurriculumManifest({ ...mixed, placements });
    expect(report.readiness).toBe(false);
    expect(
      report.issues.some(({ message }) => /state the same unit and amount/.test(message)),
    ).toBe(true);
  });

  it('accepts a pool and an uncoded requirement that together spend the allocation', () => {
    // The DS shape: 11 elective credits, spent as a 7-credit pool plus a 4-credit free elective.
    const ds = manifest({
      totalCredits: 14,
      requirements: [
        {
          kind: 'FREE_ELECTIVE',
          name: 'Free elective',
          credits: 4,
          year: 3,
          semester: 2,
          sourceOrder: 0,
        },
      ],
    });
    const placements = placementsOf(ds).map((placement) =>
      placement.group === null ? placement : { ...placement, selectCredits: 7 },
    );
    const blocks = blocksOf(ds).map((block) =>
      block.code === 'III' ? { ...block, electiveCredits: 11 } : block,
    );
    const report = verifyCurriculumManifest({
      ...ds,
      blocks,
      placements,
      totalCredits: 21,
    });
    expect(report.readiness).toBe(true);
    expect(report.credits).toEqual({ declared: 21, blocks: 21, required: 10, elective: 11 });
  });

  it('rejects a pool and a requirement that overspend or underspend the allocation', () => {
    const ds = manifest({
      requirements: [
        {
          kind: 'FREE_ELECTIVE',
          name: 'Free elective',
          credits: 4,
          year: 3,
          semester: 2,
          sourceOrder: 0,
        },
      ],
    });
    const report = verifyCurriculumManifest({ ...ds, totalCredits: 18 });
    expect(report.readiness).toBe(false);
    expect(
      report.issues.some(({ message }) =>
        /pools declare 4 and requirements declare 4/.test(message),
      ),
    ).toBe(true);
  });

  it('rejects a pool that disagrees with the elective credits the block allocates', () => {
    const oversized = manifest();
    const placements = placementsOf(oversized).map((placement) =>
      placement.group === null ? placement : { ...placement, selectCredits: 8 },
    );
    const report = verifyCurriculumManifest({ ...oversized, placements });
    expect(report.readiness).toBe(false);
    expect(
      report.issues.some(({ message }) =>
        /pools declare 8 and requirements declare 0/.test(message),
      ),
    ).toBe(true);
  });

  it('rejects a prerequisite edge that points at itself', () => {
    const report = verifyCurriculumManifest(
      manifest({ prerequisites: [{ course: 'IT069IU', prerequisite: 'IT069IU', kind: 'HT' }] }),
    );
    expect(report.issues.some(({ message }) => /cannot precede itself/.test(message))).toBe(true);
  });

  it('rejects a prerequisite cycle', () => {
    const report = verifyCurriculumManifest(
      manifest({
        prerequisites: [
          { course: 'IT079IU', prerequisite: 'IT069IU', kind: 'HT' },
          { course: 'IT069IU', prerequisite: 'IT079IU', kind: 'HT' },
        ],
      }),
    );
    expect(report.readiness).toBe(false);
    expect(report.issues.some(({ message }) => /Cycle detected/.test(message))).toBe(true);
  });

  it('rejects a prerequisite that names a course outside the program', () => {
    const report = verifyCurriculumManifest(
      manifest({ prerequisites: [{ course: 'IT079IU', prerequisite: 'ZZ999IU', kind: 'HT' }] }),
    );
    expect(report.issues.some(({ message }) => /Unknown prerequisite ZZ999IU/.test(message))).toBe(
      true,
    );
  });

  it('rejects an excluded course that is also required or placed', () => {
    const excludedButRequired = manifest();
    const blocks = blocksOf(excludedButRequired).map((block, index) =>
      index === 0 ? { ...block, requiredCourses: [...block.requiredCourses, 'PT001IU'] } : block,
    );
    const report = verifyCurriculumManifest({ ...excludedButRequired, blocks });
    expect(report.issues.some(({ category }) => category === 'EXCLUSION')).toBe(true);
  });

  it('rejects a course required by two blocks', () => {
    const shared = manifest();
    const duplicated = blocksOf(shared).map((block, index) =>
      index === 1
        ? { ...block, requiredCourses: [...block.requiredCourses, 'MA001IU'], requiredCredits: 7 }
        : block,
    );
    const report = verifyCurriculumManifest({ ...shared, blocks: duplicated, totalCredits: 17 });
    expect(report.issues.some(({ message }) => /already required by block I/.test(message))).toBe(
      true,
    );
  });

  it('rejects a placement that states both pool units', () => {
    const report = verifyCurriculumManifest(
      manifest({
        placements: [
          {
            code: 'MA001IU',
            year: 1,
            semester: 1,
            group: 'Group',
            selectCount: 2,
            selectCredits: 4,
            sourceOrder: 0,
          },
        ],
      }),
    );
    expect(report.readiness).toBe(false);
    expect(report.issues.some(({ message }) => /never both/.test(message))).toBe(true);
  });

  it('rejects a pool limit on a placement with no elective group', () => {
    const report = verifyCurriculumManifest(
      manifest({
        placements: [
          {
            code: 'MA001IU',
            year: 1,
            semester: 1,
            group: null,
            selectCount: 2,
            selectCredits: null,
            sourceOrder: 0,
          },
        ],
      }),
    );
    expect(
      report.issues.some(({ message }) => /Only an elective group may state a pool/.test(message)),
    ).toBe(true);
  });
});
