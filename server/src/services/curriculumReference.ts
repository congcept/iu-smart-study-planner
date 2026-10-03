import { z } from 'zod';

const yearSchema = z.number().int().min(1).max(4);
const semesterSchema = z.number().int().min(1).max(3);
const nonblankString = z.string().refine((value) => value.trim().length > 0, 'Must not be blank');
const rowSchema = z
  .object({
    id: z.string(),
    name: nonblankString,
    credits: z.number().int().safe().positive(),
    // The legacy HTML columns are credit units, despite their scraped field names.
    lectureHours: z.number().int().safe().nonnegative(),
    labHours: z.number().int().safe().nonnegative(),
    year: yearSchema,
    semester: semesterSchema,
    isElective: z.boolean(),
    electiveGroup: nonblankString.optional(),
    selectCount: z.number().int().safe().nonnegative(),
  })
  .strict();
const referenceSchema = z
  .array(
    z
      .object({
        year: yearSchema,
        semester: semesterSchema,
        courses: z.array(rowSchema).nonempty(),
      })
      .strict(),
  )
  .nonempty();
const codePattern = /^[A-Z]{2,}\d{3,4}IU$/;

type Issue = { path: (string | number)[]; message: string };

export class CsReferenceValidationError extends Error {
  constructor(readonly issues: Issue[]) {
    super(
      issues.map((issue) => `${issue.path.join('.') || 'reference'}: ${issue.message}`).join('\n'),
    );
    this.name = 'CsReferenceValidationError';
  }
}

export interface CsReferenceCourse {
  code: string;
  name: string;
  credits: number;
  sourceOrder: number;
}

interface SourceSlot {
  academicYear: number;
  academicSemester: number;
  sourceOrder: number;
}

export interface CsReferencePlacement extends SourceSlot {
  code: string;
  electiveGroup: string | null;
  electiveSelectCount: number | null;
  lectureCredits: number;
  labCredits: number;
}

export interface CsReferenceRequirement extends SourceSlot {
  kind: 'FREE_ELECTIVE';
  name: string;
  credits: number;
  lectureCredits: number;
  labCredits: number;
}

export interface CsReferenceGroupRequirement extends SourceSlot {
  electiveGroup: string;
  selectCount: number;
  courseCodes: string[];
}

export interface CsReferenceVerification {
  courses: CsReferenceCourse[];
  memberships: { code: string; sourceOrder: number }[];
  placements: CsReferencePlacement[];
  requirements: CsReferenceRequirement[];
  groupRequirements: CsReferenceGroupRequirement[];
  counts: {
    sourceRows: number;
    codedPlacements: number;
    uniqueCourses: number;
    repeatedPlacements: number;
    freeElectiveRequirements: number;
    electiveGroups: number;
  };
}

/** Validate and preserve the legacy CS HTML reference, without inferring degree rules. */
export function verifyCsReference(input: unknown): CsReferenceVerification {
  const parsed = referenceSchema.safeParse(input);
  if (!parsed.success) {
    throw new CsReferenceValidationError(
      parsed.error.issues.map(({ path, message }) => ({ path, message })),
    );
  }
  const issues: Issue[] = [];
  const courses = new Map<string, CsReferenceCourse>();
  const placements: CsReferencePlacement[] = [];
  const requirements: CsReferenceRequirement[] = [];
  const groups = new Map<
    string,
    { requirement: CsReferenceGroupRequirement; path: (string | number)[] }
  >();
  const seenPlacements = new Set<string>();
  let sourceOrder = 0;
  for (const [slotIndex, slot] of parsed.data.entries()) {
    for (const [rowIndex, row] of slot.courses.entries()) {
      const path = [slotIndex, 'courses', rowIndex];
      const issue = (field: string, message: string) =>
        issues.push({ path: [...path, field], message });
      const sourceSlot: SourceSlot = {
        academicYear: slot.year,
        academicSemester: slot.semester,
        sourceOrder: sourceOrder++,
      };
      if (row.year !== slot.year) issue('year', 'Row year must match its parent slot');
      if (row.semester !== slot.semester)
        issue('semester', 'Row semester must match its parent slot');
      if (row.lectureHours + row.labHours !== row.credits) {
        issue('credits', 'Lecture and lab credit units must sum to declared credits');
      }
      if (row.isElective) {
        if (!row.electiveGroup)
          issue('electiveGroup', 'An elective course must identify its group');
        if (row.selectCount <= 0)
          issue('selectCount', 'An elective group selection count must be positive');
      } else {
        if (row.selectCount !== 0)
          issue('selectCount', 'A non-elective row must have selection count zero');
        if (row.electiveGroup !== undefined)
          issue('electiveGroup', 'A non-elective row cannot identify an elective group');
      }
      const creditUnits = { lectureCredits: row.lectureHours, labCredits: row.labHours };
      if (row.id === '') {
        if (row.name.trim().toLowerCase() !== 'free elective' || row.isElective) {
          issue(
            'id',
            'A blank code is allowed only for an explicit non-elective Free elective requirement',
          );
        }
        const requirementKey = JSON.stringify([slot.year, slot.semester, null, '']);
        if (seenPlacements.has(requirementKey)) {
          issue('id', 'Duplicate Free elective requirement within the same slot');
        }
        seenPlacements.add(requirementKey);
        requirements.push({
          ...sourceSlot,
          ...creditUnits,
          kind: 'FREE_ELECTIVE',
          name: row.name,
          credits: row.credits,
        });
        continue;
      }
      if (!codePattern.test(row.id))
        issue('id', 'Invalid course code; expected uppercase letters and 3–4 digits ending in IU');
      const existing = courses.get(row.id);
      if (existing) {
        if (existing.name !== row.name) issue('name', `Conflicting name for course ${row.id}`);
        if (existing.credits !== row.credits)
          issue('credits', `Conflicting credits for course ${row.id}`);
      } else {
        courses.set(row.id, {
          code: row.id,
          name: row.name,
          credits: row.credits,
          sourceOrder: sourceSlot.sourceOrder,
        });
      }
      const electiveGroup = row.isElective ? (row.electiveGroup ?? null) : null;
      const placementKey = JSON.stringify([slot.year, slot.semester, electiveGroup, row.id]);
      if (seenPlacements.has(placementKey))
        issue('id', 'Duplicate course placement within the same slot and group');
      seenPlacements.add(placementKey);
      placements.push({
        ...sourceSlot,
        ...creditUnits,
        code: row.id,
        electiveGroup,
        electiveSelectCount: row.isElective ? row.selectCount : null,
      });
      if (row.isElective && row.electiveGroup) {
        const key = JSON.stringify([slot.year, slot.semester, row.electiveGroup]);
        const existingGroup = groups.get(key);
        if (existingGroup) {
          if (existingGroup.requirement.selectCount !== row.selectCount) {
            issue(
              'selectCount',
              'Elective selection counts must agree within the same slot and group',
            );
          }
          existingGroup.requirement.courseCodes.push(row.id);
        } else {
          groups.set(key, {
            requirement: {
              ...sourceSlot,
              electiveGroup: row.electiveGroup,
              selectCount: row.selectCount,
              courseCodes: [row.id],
            },
            path,
          });
        }
      }
    }
  }
  for (const group of groups.values()) {
    if (group.requirement.selectCount > new Set(group.requirement.courseCodes).size) {
      issues.push({
        path: [...group.path, 'selectCount'],
        message: 'Elective selection count exceeds the number of unique options',
      });
    }
  }
  if (issues.length > 0) throw new CsReferenceValidationError(issues);
  const canonicalCourses = [...courses.values()];
  return {
    courses: canonicalCourses,
    memberships: canonicalCourses.map(({ code, sourceOrder: firstSourceOrder }) => ({
      code,
      sourceOrder: firstSourceOrder,
    })),
    placements,
    requirements,
    groupRequirements: [...groups.values()].map(({ requirement }) => requirement),
    counts: {
      sourceRows: sourceOrder,
      codedPlacements: placements.length,
      uniqueCourses: courses.size,
      repeatedPlacements: placements.length - courses.size,
      freeElectiveRequirements: requirements.length,
      electiveGroups: groups.size,
    },
  };
}
