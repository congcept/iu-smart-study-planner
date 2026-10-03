import { readFileSync } from 'fs';
import { resolve } from 'path';
import { CsReferenceValidationError, verifyCsReference } from '../services/curriculumReference';

interface SourceRow {
  id: string;
  name: string;
  credits: number;
  lectureHours: number;
  labHours: number;
  year: number;
  semester: number;
  isElective: boolean;
  selectCount: number;
  electiveGroup?: string;
}

interface SourceSlot {
  year: number;
  semester: number;
  courses: SourceRow[];
}

const reference = (): SourceSlot[] =>
  JSON.parse(readFileSync(resolve(__dirname, '../../../scraped-courses.json'), 'utf8'));
const row = (changes: Record<string, unknown> = {}) => ({
  id: 'IT001IU',
  name: 'Simulated course',
  credits: 3,
  lectureHours: 3,
  labHours: 0,
  year: 1,
  semester: 1,
  isElective: false,
  selectCount: 0,
  ...changes,
});
const slot = (courses: unknown[] = [row()], changes: Record<string, unknown> = {}) => ({
  year: 1,
  semester: 1,
  courses,
  ...changes,
});
const elective = (changes: Record<string, unknown> = {}) =>
  row({ isElective: true, electiveGroup: 'Group A', selectCount: 1, ...changes });

function deepFreeze(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
}

function expectInvalid(input: unknown): void {
  expect(() => verifyCsReference(input)).toThrow(CsReferenceValidationError);
}

describe('read-only legacy CS reference verification', () => {
  it('reports the actual checked-in source without dropping coded occurrences or requirements', () => {
    const result = verifyCsReference(reference());
    expect(result.counts).toEqual({
      sourceRows: 72,
      codedPlacements: 71,
      uniqueCourses: 56,
      repeatedPlacements: 15,
      freeElectiveRequirements: 1,
      electiveGroups: 3,
    });
    expect(result.courses).toHaveLength(56);
    expect(result.memberships).toHaveLength(56);
    expect(result.placements).toHaveLength(71);
    expect(result.groupRequirements).toMatchObject([
      { academicYear: 2, academicSemester: 2, selectCount: 1 },
      { academicYear: 3, academicSemester: 1, selectCount: 2 },
      { academicYear: 4, academicSemester: 2, selectCount: 2 },
    ]);
    expect(result.groupRequirements.map(({ courseCodes }) => courseCodes.length)).toEqual([
      14, 3, 16,
    ]);
  });

  it('keeps global source order stable, including the position reserved by a blank requirement', () => {
    const input = reference();
    const rows = input.flatMap(({ courses }) => courses);
    const result = verifyCsReference(input);
    expect(result.placements.map(({ code, sourceOrder }) => ({ code, sourceOrder }))).toEqual(
      rows.flatMap(({ id }, sourceOrder) => (id ? [{ code: id, sourceOrder }] : [])),
    );
    expect(result.requirements[0].sourceOrder).toBe(rows.findIndex(({ id }) => id === ''));
    const firstOccurrences = new Map<string, number>();
    rows.forEach(({ id }, sourceOrder) => {
      if (id && !firstOccurrences.has(id)) firstOccurrences.set(id, sourceOrder);
    });
    expect(result.courses.map(({ code, sourceOrder }) => ({ code, sourceOrder }))).toEqual(
      Array.from(firstOccurrences, ([code, sourceOrder]) => ({ code, sourceOrder })),
    );
    expect(result.memberships).toEqual(
      Array.from(firstOccurrences, ([code, sourceOrder]) => ({ code, sourceOrder })),
    );
  });

  it('represents the blank Free elective as a requirement rather than a global course', () => {
    const result = verifyCsReference(reference());
    expect(result.requirements).toMatchObject([
      {
        kind: 'FREE_ELECTIVE',
        name: 'Free elective',
        credits: 3,
        academicYear: 3,
        academicSemester: 2,
        lectureCredits: 3,
        labCredits: 0,
      },
    ]);
    expect(result.courses.some(({ code }) => code === '')).toBe(false);
    expect(result.placements.some(({ code }) => code === '')).toBe(false);
  });

  it('preserves one code in different groups and years without duplicating global identity', () => {
    const result = verifyCsReference([
      slot([elective(), elective({ electiveGroup: 'Group B' })]),
      slot([row({ year: 2 })], { year: 2 }),
    ]);
    expect(result.courses).toHaveLength(1);
    expect(result.memberships).toHaveLength(1);
    expect(result.placements).toMatchObject([
      { code: 'IT001IU', academicYear: 1, electiveGroup: 'Group A', sourceOrder: 0 },
      { code: 'IT001IU', academicYear: 1, electiveGroup: 'Group B', sourceOrder: 1 },
      { code: 'IT001IU', academicYear: 2, electiveGroup: null, sourceOrder: 2 },
    ]);
    expect(result.counts.repeatedPlacements).toBe(2);
  });

  it('verifies deeply frozen input without mutating source rows or their ordering', () => {
    const input = reference();
    const before = JSON.stringify(input);
    deepFreeze(input);
    verifyCsReference(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(input[0].courses[0])).toBe(true);
  });

  it('rejects invalid root and slot structures instead of producing an empty catalog', () => {
    for (const input of [null, undefined, {}, 1, 'courses', [], [null], [slot([], {})]]) {
      expectInvalid(input);
    }
    expectInvalid([{ year: 1, semester: 1 }]);
    expectInvalid([slot([], { courses: {} })]);
  });

  it('rejects invalid or out-of-range parent slots', () => {
    for (const year of [0, 5, 1.5, NaN, Infinity, '1']) {
      expectInvalid([slot([row({ year })], { year })]);
    }
    for (const semester of [0, 4, 1.5, NaN, Infinity, '1']) {
      expectInvalid([slot([row({ semester })], { semester })]);
    }
  });

  it('rejects invalid course structures and returns actionable issue paths', () => {
    for (const invalidRow of [null, [], {}, { id: 'IT001IU' }]) {
      expectInvalid([slot([invalidRow])]);
    }
    try {
      verifyCsReference([slot([row({ credits: '3' })])]);
      throw new Error('Invalid input unexpectedly accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(CsReferenceValidationError);
      if (!(error instanceof CsReferenceValidationError)) throw error;
      expect(error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: [0, 'courses', 0, 'credits'] })]),
      );
    }
  });

  it('rejects unknown source fields instead of silently dropping unmodeled data', () => {
    expectInvalid([slot([row({ prerequisites: ['IT002IU'] })])]);
    expectInvalid([slot([row()], { track: 'Unmodeled specialization' })]);
  });

  it('rejects malformed IDs rather than trimming or inventing course identities', () => {
    for (const id of ['it001iu', ' IT001IU', 'IT001IU ', 'IT1IU', 'IT001', 'A001IU', 1, null]) {
      expectInvalid([slot([row({ id })])]);
    }
  });

  it('requires a nonblank course name and an explicit boolean elective flag', () => {
    for (const name of ['', '   ', null, 1]) expectInvalid([slot([row({ name })])]);
    for (const isElective of ['false', 0, null]) {
      expectInvalid([slot([row({ isElective })])]);
    }
  });

  it('rejects nonfinite, fractional and nonpositive course credits', () => {
    for (const credits of [NaN, Infinity, -Infinity, 0, -1, 1.5, '3', null]) {
      expectInvalid([slot([row({ credits })])]);
    }
    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    expectInvalid([slot([row({ credits: unsafe, lectureHours: unsafe })])]);
  });

  it('validates lecture and lab credit units and their sum', () => {
    for (const invalid of [NaN, Infinity, -1, 0.5, '3', null, Number.MAX_SAFE_INTEGER + 1]) {
      expectInvalid([slot([row({ lectureHours: invalid })])]);
      expectInvalid([slot([row({ labHours: invalid })])]);
    }
    expectInvalid([slot([row({ lectureHours: 2, labHours: 0 })])]);
    expectInvalid([slot([row({ lectureHours: 3, labHours: 1 })])]);
    expect(verifyCsReference([slot([row({ lectureHours: 2, labHours: 1 })])]).courses).toHaveLength(
      1,
    );
  });

  it('rejects row placement that conflicts with its parent slot', () => {
    expectInvalid([slot([row({ year: 2 })])]);
    expectInvalid([slot([row({ semester: 2 })])]);
  });

  it('requires an elective group for electives and forbids dangling groups on required rows', () => {
    for (const electiveGroup of [undefined, '', '   ', null, 1]) {
      expectInvalid([slot([elective({ electiveGroup })])]);
    }
    expectInvalid([slot([row({ electiveGroup: 'Group A' })])]);
  });

  it('requires positive integer elective selections and zero for non-elective rows', () => {
    for (const selectCount of [0, -1, 1.5, NaN, Infinity, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
      expectInvalid([slot([elective({ selectCount })])]);
    }
    expectInvalid([slot([row({ selectCount: 1 })])]);
  });

  it('rejects inconsistent group selections and selections larger than unique option counts', () => {
    expectInvalid([slot([elective({ selectCount: 2 })])]);
    expectInvalid([slot([elective(), elective({ id: 'IT002IU', selectCount: 2 })])]);
  });

  it('rejects conflicting global names or credits across otherwise distinct placements', () => {
    expectInvalid([
      slot([row()]),
      slot([row({ year: 2, name: 'Conflicting course' })], { year: 2 }),
    ]);
    expectInvalid([
      slot([row()]),
      slot([row({ year: 2, credits: 4, lectureHours: 4 })], { year: 2 }),
    ]);
  });

  it('rejects duplicate occurrences of a code in the same slot and group', () => {
    expectInvalid([slot([row(), row()])]);
    expectInvalid([slot([elective(), elective()])]);
  });

  it('allows a blank identity only for an explicit non-elective Free elective requirement', () => {
    expectInvalid([slot([row({ id: '', name: 'Unknown course' })])]);
    expectInvalid([slot([elective({ id: '', name: 'Free elective' })])]);
    expectInvalid([slot([row({ id: '', name: 'Free elective', selectCount: 1 })])]);
    expectInvalid([
      slot([row({ id: '', name: 'Free elective' }), row({ id: '', name: 'Free elective' })]),
    ]);
    const result = verifyCsReference([slot([row({ id: '', name: ' Free Elective ' })])]);
    expect(result.requirements).toHaveLength(1);
    expect(result.courses).toHaveLength(0);
  });
});
