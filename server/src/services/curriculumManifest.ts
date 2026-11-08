import { z } from 'zod';

/**
 * A program source manifest is a reviewed, portable transcription of one signed curriculum
 * document. It is never produced from a page fetch at request time: the document hash and page
 * locators travel with it so a reader can check the same bytes were used.
 *
 * The verifier below proves the manifest is internally consistent. It cannot prove the document
 * says what the manifest says; that is what review and the recorded source locators are for.
 */
const code = z
  .string()
  .regex(/^[A-Z]{2,3}\d{3,4}IU$/, 'A course code must match the published IU form');
const credits = z.number().int().safe().positive();
const count = z.number().int().safe().nonnegative();
const sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'A source fingerprint must be a lowercase SHA-256 digest');
const year = z.number().int().min(1).max(4);

const courseSchema = z
  .object({
    code,
    name: z.string().trim().min(1).max(200),
    credits,
    lecture: count,
    lab: count,
  })
  .strict()
  .refine(
    ({ credits: total, lecture, lab }) => total === lecture + lab,
    'Lecture and laboratory units must sum to the declared credits',
  );

const placementSchema = z
  .object({
    code,
    year: year.nullable(),
    semester: z.number().int().min(1).max(3).nullable(),
    group: z.string().trim().min(1).max(100).nullable(),
    selectCount: z.number().int().safe().positive().nullable(),
    selectCredits: credits.nullable(),
    sourceOrder: count,
  })
  .strict()
  .refine(
    ({ selectCount, selectCredits }) => selectCount === null || selectCredits === null,
    'An elective pool is stated in courses or in credits, never both',
  )
  .refine(
    ({ group, selectCount, selectCredits }) =>
      group !== null || (selectCount === null && selectCredits === null),
    'Only an elective group may state a pool',
  );

const blockSchema = z
  .object({
    code: z.string().trim().min(1).max(20),
    name: z.string().trim().min(1).max(120),
    requiredCredits: count,
    electiveCredits: count,
    requiredCourses: z.array(code).max(400),
  })
  .strict();

export const CurriculumManifestSchema = z
  .object({
    program: z
      .object({
        code: z.string().trim().min(1).max(20),
        name: z.string().trim().min(1).max(200),
        school: z.string().trim().min(1).max(200),
        degree: z.string().trim().min(1).max(120),
        programUrl: z
          .string()
          .url()
          .refine((value) => /^https?:\/\//i.test(value)),
        cohort: z.string().trim().min(1).max(40),
      })
      .strict(),
    source: z
      .object({
        label: z.string().trim().min(1).max(200),
        url: z
          .string()
          .url()
          .refine((value) => /^https?:\/\//i.test(value)),
        sha256,
        pages: z.string().trim().min(1).max(200),
        retrievedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .strict(),
    totalCredits: credits,
    excluded: z
      .array(
        z
          .object({
            kind: z.enum(['PHYSICAL_TRAINING', 'MILITARY_TRAINING']),
            code: code.nullable(),
            credits,
            reason: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .max(20),
    blocks: z.array(blockSchema).min(1).max(20),
    courses: z.array(courseSchema).min(1).max(400),
    placements: z.array(placementSchema).min(1).max(600),
    requirements: z
      .array(
        z
          .object({
            // A document may allocate elective credits without naming a single candidate course, as
            // IT does for its three specialised slots. That is stated, not inferred.
            kind: z.enum(['FREE_ELECTIVE', 'UNNAMED_ELECTIVE']),
            name: z.string().trim().min(1).max(200),
            credits,
            year: year.nullable(),
            semester: z.number().int().min(1).max(3).nullable(),
            sourceOrder: count,
          })
          .strict(),
      )
      .max(50),
    prerequisites: z
      .array(
        z
          .object({
            course: code,
            prerequisite: code,
            kind: z.enum(['TQ', 'HT', 'SH']),
            // The prerequisite is a course from outside this programme, satisfied by a completion of
            // it wherever the record came from. It is not a member, so membership is not required.
            external: z.boolean().default(false),
            // Edges that share a group name are alternatives: any one of them satisfies the
            // requirement. A null group is a single mandatory edge, which is the normal case.
            alternativeGroup: z.string().trim().min(1).max(40).nullable().default(null),
          })
          .strict(),
      )
      .max(1200),
  })
  .strict();

export type CurriculumManifest = z.infer<typeof CurriculumManifestSchema>;

export const MANIFEST_ISSUE_CATEGORIES = [
  'SOURCE',
  'IDENTITY',
  'PLACEMENT',
  'ELECTIVE',
  'CREDIT_ARITHMETIC',
  'PREREQUISITE',
  'EXCLUSION',
] as const;

export type ManifestIssueCategory = (typeof MANIFEST_ISSUE_CATEGORIES)[number];

export interface ManifestIssue {
  category: ManifestIssueCategory;
  path: string;
  message: string;
}

export interface CurriculumManifestReport {
  mode: 'REFERENCE_ONLY';
  program: { code: string; cohort: string } | null;
  source: { label: string; sha256: string; pages: string } | null;
  counts: {
    blocks: number;
    courses: number;
    placements: number;
    electiveGroups: number;
    requirements: number;
    prerequisites: number;
    excluded: number;
  };
  credits: { declared: number; blocks: number; required: number; elective: number } | null;
  readiness: boolean;
  /** Always populated: an import is a reference transcription, never a verified cohort. */
  blockers: string[];
  issues: ManifestIssue[];
}

/**
 * Proves an untrusted manifest is self-consistent. Fails closed: any issue means no import.
 * It makes no claim that the underlying document agrees with the manifest.
 */
export function verifyCurriculumManifest(input: unknown): CurriculumManifestReport {
  const parsed = CurriculumManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      mode: 'REFERENCE_ONLY',
      program: null,
      source: null,
      counts: {
        blocks: 0,
        courses: 0,
        placements: 0,
        electiveGroups: 0,
        requirements: 0,
        prerequisites: 0,
        excluded: 0,
      },
      credits: null,
      readiness: false,
      blockers: ['The manifest does not match the required shape'],
      issues: parsed.error.issues.map((issue) => ({
        category: 'SOURCE',
        path: issue.path.join('.') || 'manifest',
        message: issue.message,
      })),
    };
  }

  const manifest = parsed.data;
  const issues: ManifestIssue[] = [];
  const fail = (category: ManifestIssueCategory, path: string, message: string) =>
    issues.push({ category, path, message });

  const byCode = new Map<string, CurriculumManifest['courses'][number]>();
  for (const course of manifest.courses) {
    if (byCode.has(course.code))
      fail('IDENTITY', `courses.${course.code}`, 'Duplicate course code');
    else byCode.set(course.code, course);
  }

  const excludedCodes = new Set(
    manifest.excluded.flatMap(({ code: excluded }) => (excluded === null ? [] : [excluded])),
  );

  // Placements: every code must be a member, and one occurrence per slot and group.
  const placementsByCode = new Map<string, CurriculumManifest['placements']>();
  const seenPlacements = new Set<string>();
  for (const [index, placement] of manifest.placements.entries()) {
    const path = `placements.${index}`;
    if (!byCode.has(placement.code)) {
      fail('PLACEMENT', path, `Placement names unknown course ${placement.code}`);
      continue;
    }
    const key = [placement.code, placement.year, placement.semester, placement.group].join(':');
    if (seenPlacements.has(key))
      fail('PLACEMENT', path, `Duplicate placement for ${placement.code} in the same slot`);
    seenPlacements.add(key);
    const list = placementsByCode.get(placement.code) ?? [];
    list.push(placement);
    placementsByCode.set(placement.code, list);
  }
  if (
    new Set(manifest.placements.map(({ sourceOrder }) => sourceOrder)).size !==
    manifest.placements.length
  )
    fail('PLACEMENT', 'placements', 'Source order must be unique across placements');

  // Blocks: declared block credits must equal the courses the block claims.
  const requiredOwner = new Map<string, string>();
  for (const block of manifest.blocks) {
    const path = `blocks.${block.code}`;
    let sum = 0;
    for (const courseCode of block.requiredCourses) {
      const course = byCode.get(courseCode);
      if (!course) {
        fail('CREDIT_ARITHMETIC', path, `Block claims unknown course ${courseCode}`);
        continue;
      }
      if (excludedCodes.has(courseCode))
        fail('EXCLUSION', path, `${courseCode} is excluded but is required`);
      const owner = requiredOwner.get(courseCode);
      if (owner)
        fail('CREDIT_ARITHMETIC', path, `${courseCode} is already required by block ${owner}`);
      else requiredOwner.set(courseCode, block.code);
      sum += course.credits;
      if (!placementsByCode.has(courseCode))
        fail('PLACEMENT', path, `${courseCode} is required but has no placement`);
    }
    if (sum !== block.requiredCredits)
      fail(
        'CREDIT_ARITHMETIC',
        path,
        `Block declares ${block.requiredCredits} required credits but its courses total ${sum}`,
      );
  }

  const blockCredits = manifest.blocks.reduce(
    (total, block) => total + block.requiredCredits + block.electiveCredits,
    0,
  );
  const required = manifest.blocks.reduce((total, block) => total + block.requiredCredits, 0);
  const elective = manifest.blocks.reduce((total, block) => total + block.electiveCredits, 0);
  if (blockCredits !== manifest.totalCredits)
    fail(
      'CREDIT_ARITHMETIC',
      'totalCredits',
      `Blocks total ${blockCredits} credits but the program declares ${manifest.totalCredits}`,
    );

  // Elective pools must agree within a group and must not exceed what the block allocates.
  const groups = new Map<string, { units: Set<string>; confirmations: number; declared: number }>();
  for (const placement of manifest.placements) {
    if (placement.group === null) continue;
    const unit =
      placement.selectCredits === null
        ? `courses:${placement.selectCount}`
        : `credits:${placement.selectCredits}`;
    const key = `${placement.group}@${placement.year}:${placement.semester}`;
    const entry = groups.get(key) ?? { units: new Set<string>(), confirmations: 0, declared: 0 };
    entry.units.add(unit);
    const declaredValue = placement.selectCredits ?? placement.selectCount ?? 0;
    if (placement.selectCount !== null || placement.selectCredits !== null) {
      entry.confirmations += 1;
      entry.declared = declaredValue;
    }
    groups.set(key, entry);
  }
  for (const [key, entry] of groups) {
    if (entry.units.size > 1)
      fail(
        'ELECTIVE',
        `groups.${key}`,
        'Every option in one pool must state the same unit and amount',
      );
    if (entry.confirmations === 0)
      fail('ELECTIVE', `groups.${key}`, 'An elective group states no pool limit');
  }
  // The elective allocation is spent by pools and by uncoded requirements together. A DS-shaped
  // program spends it as a 7-credit pool plus a 4-credit free-elective requirement; counting only
  // one of the two would reject a correct manifest.
  const poolCredits = [...groups.values()].reduce((total, entry) => total + entry.declared, 0);
  const requirementCredits = manifest.requirements.reduce(
    (total, requirement) => total + requirement.credits,
    0,
  );
  if (poolCredits + requirementCredits !== elective)
    fail(
      'ELECTIVE',
      'blocks',
      `Elective allocation is ${elective} credits but pools declare ${poolCredits} and requirements declare ${requirementCredits}`,
    );

  // Prerequisites: both endpoints are members, no self-edge, no cycle.
  const edges = new Map<string, Set<string>>();
  const alternatives = new Map<string, { prerequisites: Set<string>; kinds: Set<string> }>();
  const seenPairs = new Map<string, Set<string | null>>();
  const ordering = new Map<string, Set<string>>();
  for (const [index, edge] of manifest.prerequisites.entries()) {
    const path = `prerequisites.${index}`;
    if (!byCode.has(edge.course)) fail('PREREQUISITE', path, `Unknown course ${edge.course}`);
    if (!edge.external && !byCode.has(edge.prerequisite))
      fail('PREREQUISITE', path, `Unknown prerequisite ${edge.prerequisite}`);
    if (edge.external && byCode.has(edge.prerequisite))
      fail(
        'PREREQUISITE',
        path,
        `${edge.prerequisite} is a member, so it cannot be marked external`,
      );
    if (edge.course === edge.prerequisite)
      fail('PREREQUISITE', path, `${edge.course} cannot precede itself`);
    // The same pair may appear once alone or once inside one alternative group, never both and
    // never twice in the same group.
    const pairKey = `${edge.course}\u0000${edge.prerequisite}`;
    const pairGroups = seenPairs.get(pairKey) ?? new Set<string | null>();
    if (pairGroups.has(edge.alternativeGroup))
      fail('PREREQUISITE', path, `Duplicate edge ${edge.course} -> ${edge.prerequisite}`);
    else if (pairGroups.size > 0 && (pairGroups.has(null) || edge.alternativeGroup === null))
      fail(
        'PREREQUISITE',
        path,
        `${edge.prerequisite} is required both alone and as an alternative for ${edge.course}`,
      );
    pairGroups.add(edge.alternativeGroup);
    seenPairs.set(pairKey, pairGroups);
    const outgoing = edges.get(edge.course) ?? new Set<string>();
    outgoing.add(edge.prerequisite);
    edges.set(edge.course, outgoing);
    // Concurrency says two courses are taken together, so it cannot order them. Only prior-study
    // and prerequisite edges may form a cycle; two courses naming each other as concurrent is
    // exactly what concurrent means.
    // An external code has no node in this programme, so it never participates in ordering.
    if (edge.kind !== 'SH' && !edge.external) {
      const ordered = ordering.get(edge.course) ?? new Set<string>();
      ordered.add(edge.prerequisite);
      ordering.set(edge.course, ordered);
    }
    if (edge.alternativeGroup !== null) {
      const key = `${edge.course}#${edge.alternativeGroup}`;
      const entry = alternatives.get(key) ?? {
        prerequisites: new Set<string>(),
        kinds: new Set<string>(),
      };
      entry.prerequisites.add(edge.prerequisite);
      entry.kinds.add(edge.kind);
      alternatives.set(key, entry);
    }
    for (const excluded of [edge.course, edge.prerequisite])
      if (excludedCodes.has(excluded))
        fail('EXCLUSION', path, `${excluded} is excluded but has prerequisites`);
  }
  for (const [key, entry] of alternatives) {
    if (entry.prerequisites.size < 2)
      fail(
        'PREREQUISITE',
        `alternatives.${key}`,
        'An alternative group must offer at least two prerequisites',
      );
    if (entry.kinds.size > 1)
      fail(
        'PREREQUISITE',
        `alternatives.${key}`,
        'Every alternative in a group must state the same prerequisite kind',
      );
  }

  if (issues.every(({ category }) => category !== 'PREREQUISITE')) {
    const state = new Map<string, 'open' | 'done'>();
    const visit = (node: string, trail: string[]): string[] | null => {
      if (state.get(node) === 'done') return null;
      if (state.get(node) === 'open') return [...trail, node];
      state.set(node, 'open');
      for (const next of ordering.get(node) ?? []) {
        const cycle = visit(next, [...trail, node]);
        if (cycle) return cycle;
      }
      state.set(node, 'done');
      return null;
    };
    for (const node of ordering.keys()) {
      const cycle = visit(node, []);
      if (cycle) {
        fail('PREREQUISITE', 'prerequisites', `Cycle detected: ${cycle.join(' -> ')}`);
        break;
      }
    }
  }

  // A declared total must exclude physical training, and the exclusions must be coherent.
  for (const [index, exclusion] of manifest.excluded.entries()) {
    if (exclusion.kind === 'PHYSICAL_TRAINING' && exclusion.code === null)
      fail('EXCLUSION', `excluded.${index}`, 'A physical-training exclusion must name its course');
    if (exclusion.code !== null && !byCode.has(exclusion.code))
      fail('EXCLUSION', `excluded.${index}`, `${exclusion.code} is excluded but is not a course`);
    if (exclusion.code !== null && exclusion.credits !== byCode.get(exclusion.code)?.credits)
      fail('EXCLUSION', `excluded.${index}`, `${exclusion.code} declares a different credit value`);
  }

  const blockers = issues.map(({ category, path, message }) => `${category} ${path}: ${message}`);
  return {
    mode: 'REFERENCE_ONLY',
    program: { code: manifest.program.code, cohort: manifest.program.cohort },
    source: {
      label: manifest.source.label,
      sha256: manifest.source.sha256,
      pages: manifest.source.pages,
    },
    counts: {
      blocks: manifest.blocks.length,
      courses: manifest.courses.length,
      placements: manifest.placements.length,
      electiveGroups: groups.size,
      requirements: manifest.requirements.length,
      prerequisites: manifest.prerequisites.length,
      excluded: manifest.excluded.length,
    },
    credits: {
      declared: manifest.totalCredits,
      blocks: blockCredits,
      required,
      elective,
    },
    readiness: issues.length === 0,
    blockers,
    issues,
  };
}
