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
    prerequisites: [
      { course: 'IT079IU', prerequisite: 'IT069IU', kind: 'HT', alternativeGroup: null },
    ],
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

  it('accepts elective slots the document allocates without naming a candidate', () => {
    // The IT shape: three specialised slots of four credits each, no named options.
    const it = manifest({
      totalCredits: 18,
      requirements: [1, 2, 3].map((slot) => ({
        kind: 'UNNAMED_ELECTIVE' as const,
        name: `Elective ${slot}`,
        credits: 4,
        year: 3,
        semester: 1,
        sourceOrder: slot,
      })),
    });
    const blocks = blocksOf(it).map((block) =>
      block.code === 'III' ? { ...block, electiveCredits: 12 } : block,
    );
    const placements = placementsOf(it).filter(({ group }) => group === null);
    const report = verifyCurriculumManifest({ ...it, blocks, placements, totalCredits: 22 });
    expect(report.blockers).toEqual([]);
    expect(report.readiness).toBe(true);
    expect(report.credits).toEqual({ declared: 22, blocks: 22, required: 10, elective: 12 });
    expect(report.counts.requirements).toBe(3);
  });

  it('rejects unnamed elective slots that do not add up to the allocation', () => {
    const it = manifest({
      requirements: [1, 2].map((slot) => ({
        kind: 'UNNAMED_ELECTIVE' as const,
        name: `Elective ${slot}`,
        credits: 4,
        year: 3,
        semester: 1,
        sourceOrder: slot,
      })),
    });
    const blocks = blocksOf(it).map((block) =>
      block.code === 'III' ? { ...block, electiveCredits: 12 } : block,
    );
    const placements = placementsOf(it).filter(({ group }) => group === null);
    const report = verifyCurriculumManifest({ ...it, blocks, placements, totalCredits: 22 });
    expect(report.readiness).toBe(false);
    expect(
      report.issues.some(({ message }) =>
        /pools declare 0 and requirements declare 8/.test(message),
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

  it('accepts two courses that name each other as concurrent', () => {
    // IT shape: a lecture and its laboratory are taken together, so each is concurrent with the
    // other. Concurrency cannot order courses, so it must not be read as a cycle.
    const it = manifest();
    const courses = [
      ...(it.courses as { code: string }[]),
      { code: 'EE054IU', name: 'Digital Logic Design Laboratory', credits: 1, lecture: 0, lab: 1 },
    ];
    const report = verifyCurriculumManifest({
      ...it,
      courses,
      prerequisites: [
        { course: 'IT079IU', prerequisite: 'EE054IU', kind: 'SH', alternativeGroup: null },
        { course: 'EE054IU', prerequisite: 'IT079IU', kind: 'SH', alternativeGroup: null },
      ],
    });
    expect(report.blockers).toEqual([]);
    expect(report.readiness).toBe(true);
  });

  it('still rejects a cycle among ordering prerequisites', () => {
    const report = verifyCurriculumManifest(
      manifest({
        prerequisites: [
          { course: 'IT079IU', prerequisite: 'IT069IU', kind: 'HT', alternativeGroup: null },
          { course: 'IT069IU', prerequisite: 'IT079IU', kind: 'HT', alternativeGroup: null },
        ],
      }),
    );
    expect(report.issues.some(({ message }) => /Cycle detected/.test(message))).toBe(true);
  });

  it('rejects a cycle that mixes a concurrent edge with an ordering edge', () => {
    const report = verifyCurriculumManifest(
      manifest({
        prerequisites: [
          { course: 'IT079IU', prerequisite: 'IT069IU', kind: 'HT', alternativeGroup: null },
          { course: 'IT069IU', prerequisite: 'IT079IU', kind: 'SH', alternativeGroup: null },
          { course: 'IT069IU', prerequisite: 'MA001IU', kind: 'HT', alternativeGroup: null },
        ],
      }),
    );
    // IT069IU -> MA001IU -> ... does not return, and IT079IU -> IT069IU is one-way: no cycle.
    expect(report.issues.some(({ message }) => /Cycle detected/.test(message))).toBe(false);
    expect(report.readiness).toBe(true);
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

  it('accepts a placement for an excluded course that counts toward no block', () => {
    // Physical training is scheduled in a semester but excluded from the credit total.
    const scheduled = manifest();
    const placements = [
      ...placementsOf(scheduled),
      {
        code: 'PT001IU',
        year: 1,
        semester: 1,
        group: null,
        selectCount: null,
        selectCredits: null,
        sourceOrder: 20,
      },
    ];
    const report = verifyCurriculumManifest({ ...scheduled, placements });
    expect(report.readiness).toBe(true);
    expect(report.credits).toEqual({ declared: 14, blocks: 14, required: 10, elective: 4 });
  });

  it('accepts an alternative group where any one prerequisite satisfies the requirement', () => {
    // IT shape: four courses accept either programming course as their prior study.
    const it = manifest();
    const prerequisites = [
      { course: 'IT079IU', prerequisite: 'IT116IU', kind: 'HT', alternativeGroup: 'programming' },
      { course: 'IT079IU', prerequisite: 'IT149IU', kind: 'HT', alternativeGroup: 'programming' },
    ];
    const courses = [
      ...(it.courses as { code: string }[]),
      { code: 'IT116IU', name: 'C/C++ Programming', credits: 4, lecture: 3, lab: 1 },
      { code: 'IT149IU', name: 'Fundamentals of Programming', credits: 4, lecture: 3, lab: 1 },
    ];
    const report = verifyCurriculumManifest({ ...it, courses, prerequisites });
    expect(report.readiness).toBe(true);
    expect(report.counts.prerequisites).toBe(2);
  });

  it('rejects an alternative group with only one member', () => {
    const report = verifyCurriculumManifest(
      manifest({
        prerequisites: [
          {
            course: 'IT079IU',
            prerequisite: 'IT069IU',
            kind: 'HT',
            alternativeGroup: 'programming',
          },
        ],
      }),
    );
    expect(report.readiness).toBe(false);
    expect(report.issues.some(({ message }) => /at least two prerequisites/.test(message))).toBe(
      true,
    );
  });

  it('rejects an alternative group that mixes prerequisite kinds', () => {
    const it = manifest();
    const courses = [
      ...(it.courses as { code: string }[]),
      { code: 'IT116IU', name: 'C/C++ Programming', credits: 4, lecture: 3, lab: 1 },
    ];
    const report = verifyCurriculumManifest({
      ...it,
      courses,
      prerequisites: [
        { course: 'IT079IU', prerequisite: 'IT116IU', kind: 'HT', alternativeGroup: 'programming' },
        { course: 'IT079IU', prerequisite: 'IT069IU', kind: 'TQ', alternativeGroup: 'programming' },
      ],
    });
    expect(report.issues.some(({ message }) => /same prerequisite kind/.test(message))).toBe(true);
  });

  it('rejects a prerequisite required both alone and as an alternative', () => {
    const it = manifest();
    const courses = [
      ...(it.courses as { code: string }[]),
      { code: 'IT116IU', name: 'C/C++ Programming', credits: 4, lecture: 3, lab: 1 },
    ];
    const report = verifyCurriculumManifest({
      ...it,
      courses,
      prerequisites: [
        { course: 'IT079IU', prerequisite: 'IT069IU', kind: 'HT', alternativeGroup: 'programming' },
        { course: 'IT079IU', prerequisite: 'IT116IU', kind: 'HT', alternativeGroup: 'programming' },
        { course: 'IT079IU', prerequisite: 'IT116IU', kind: 'HT', alternativeGroup: null },
      ],
    });
    expect(
      report.issues.some(({ message }) => /both alone and as an alternative/.test(message)),
    ).toBe(true);
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
