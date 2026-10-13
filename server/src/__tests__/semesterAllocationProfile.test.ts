import {
  SimulationAllocationPolicySchema,
  SimulationResourceEnvelopeSchema,
  SimulationSemesterAllocationInputSchema,
} from '@iu-study-planner/shared';

import {
  PROFILE_SCENARIOS,
  assertProfileExpectations,
  buildSemesterAllocationProfileFixture,
  parseSemesterAllocationProfileOptions,
  profileDigest,
  summarizeProfileSamples,
  summarizeSemesterAllocationProfileResult,
} from '../services/semesterAllocationProfile';
import { allocateSimulationSemester } from '../services/simulationSemesterAllocation';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function referenceResult() {
  const { envelope, input, policy } = buildSemesterAllocationProfileFixture('reference');
  return allocateSimulationSemester(envelope, input, policy);
}

describe('read-only semester allocation profile fixtures', () => {
  it.each([
    ['reference', 12, 8, 4, 48, 9, 3, 8, 12],
    ['max-students', 500, 20, 20, 10000, 30, 0, 20, 500],
    ['max-rounds', 100, 100, 100, 10000, 30, 0, 100, 100],
    ['max-catalog', 500, 10000, 20, 10000, 30, 0, 10000, 1],
    ['scarce', 500, 20, 20, 10000, 18, 3, 4, 10],
  ] as const)(
    'builds the %s workload with real positive targets at its stated bounds',
    (
      scenario,
      studentCount,
      catalogCount,
      perStudent,
      totalChoices,
      target,
      credits,
      sections,
      seats,
    ) => {
      const fixture = buildSemesterAllocationProfileFixture(scenario);
      expect(fixture.scenario).toBe(scenario);
      expect(SimulationSemesterAllocationInputSchema.parse(fixture.input)).toEqual(fixture.input);
      expect(SimulationResourceEnvelopeSchema.parse(fixture.envelope)).toEqual(fixture.envelope);
      expect(SimulationAllocationPolicySchema.parse(fixture.policy)).toEqual(fixture.policy);
      expect(fixture.input.students).toHaveLength(studentCount);
      expect(fixture.input.courses).toHaveLength(catalogCount);
      expect(
        fixture.input.students.reduce((sum, student) => sum + student.candidates.length, 0),
      ).toBe(totalChoices);
      expect(
        fixture.input.students.every((student) => student.candidates.length === perStudent),
      ).toBe(true);
      expect(fixture.input.students.every((student) => student.targetCredits === target)).toBe(
        true,
      );
      expect(fixture.input.courses.every((course) => course.credits === credits)).toBe(true);
      expect(fixture.envelope.envelope?.sharedSectionCeiling).toBe(sections);
      expect(fixture.envelope.envelope?.sharedSeatCeiling).toBe(sections * seats);
      expect(fixture.envelope.resources?.maxStudentsPerSection).toBe(seats);
      expect(new Set(fixture.input.students.map((student) => student.studentId)).size).toBe(
        studentCount,
      );
      expect(new Set(fixture.input.courses.map((course) => course.courseId)).size).toBe(
        catalogCount,
      );
    },
  );

  it('covers the maximum catalog through disjoint student choices rather than unused filler', () => {
    const fixture = buildSemesterAllocationProfileFixture('max-catalog');
    const chosen = fixture.input.students.flatMap((student) =>
      student.candidates.map((choice) => choice.courseId),
    );
    expect(new Set(chosen).size).toBe(10000);
    expect([...chosen].sort()).toEqual(fixture.input.courses.map((course) => course.courseId));
  });

  it('covers a real hundred-round zero-credit workload without turning its targets to zero', () => {
    const fixture = buildSemesterAllocationProfileFixture('max-rounds');
    const catalog = fixture.input.courses.map((course) => course.courseId);
    expect(fixture.input.students.every((student) => student.targetCredits > 0)).toBe(true);
    expect(
      fixture.input.students.every(
        (student) => student.candidates.map((choice) => choice.courseId).join() === catalog.join(),
      ),
    ).toBe(true);
    expect(fixture.input.courses.every((course) => course.credits === 0)).toBe(true);
  });

  it('is deterministic and each new fixture has independent mutable containers', () => {
    const first = buildSemesterAllocationProfileFixture('reference');
    const expected = buildSemesterAllocationProfileFixture('reference');
    expect(first).toEqual(expected);
    first.input.students[0].candidates.splice(0);
    first.input.courses[0].credits = 10;
    expect(buildSemesterAllocationProfileFixture('reference')).toEqual(expected);
    expect(PROFILE_SCENARIOS).toEqual([
      'reference',
      'max-students',
      'max-rounds',
      'max-catalog',
      'scarce',
      'missing-resources',
    ]);
  });

  it('retains choices and positive targets when resources are genuinely unknown', () => {
    const fixture = buildSemesterAllocationProfileFixture('missing-resources');
    expect(fixture.input).toEqual(buildSemesterAllocationProfileFixture('reference').input);
    expect(SimulationResourceEnvelopeSchema.parse(fixture.envelope)).toEqual(fixture.envelope);
    expect(fixture.envelope).toMatchObject({
      resources: null,
      resourceRevision: null,
      envelope: null,
    });
    const result = allocateSimulationSemester(fixture.envelope, fixture.input, fixture.policy);
    expect(summarizeSemesterAllocationProfileResult(result)).toMatchObject({
      studentCount: 12,
      totalChoices: 48,
      totalTargetCredits: 108,
      totalAssignedCredits: 0,
      totalRemainingCredits: 108,
      assignedCourseCount: 0,
      assignedStudentCount: 0,
      usedSections: 0,
      rounds: 0,
      meanAssignedUtility: null,
      stopReasonCounts: {
        TARGET_REACHED: 0,
        NO_REMAINING_CHOICES: 0,
        CREDIT_LIMIT: 0,
        RESOURCE_UNKNOWN: 12,
        CAPACITY_EXHAUSTED: 0,
      },
    });
  });
});

describe('verified semester profile aggregate evaluation', () => {
  it('accounts for every student, assignment and credit without exposing synthetic identities', () => {
    const result = referenceResult();
    const summary = summarizeSemesterAllocationProfileResult(result);
    expect(summary).toMatchObject({
      studentCount: 12,
      catalogCourseCount: 8,
      totalChoices: 48,
      assignedCourseCount: 36,
      assignedStudentCount: 12,
      totalTargetCredits: 108,
      totalAssignedCredits: 108,
      totalRemainingCredits: 0,
      rounds: 3,
      stopReasonCounts: {
        TARGET_REACHED: 12,
        NO_REMAINING_CHOICES: 0,
        CREDIT_LIMIT: 0,
        RESOURCE_UNKNOWN: 0,
        CAPACITY_EXHAUSTED: 0,
      },
    });
    expect(summary.totalAssignedCredits + summary.totalRemainingCredits).toBe(
      summary.totalTargetCredits,
    );
    expect(Object.values(summary.stopReasonCounts).reduce((sum, count) => sum + count, 0)).toBe(
      summary.studentCount,
    );
    expect(summary.meanAssignedUtility).toBeCloseTo(
      result.assignments.reduce((sum, row) => sum + row.studentUtility, 0) /
        result.assignments.length,
      12,
    );
    expect(Object.keys(summary).sort()).toEqual(
      [
        'studentCount',
        'catalogCourseCount',
        'totalChoices',
        'assignedCourseCount',
        'assignedStudentCount',
        'totalTargetCredits',
        'totalAssignedCredits',
        'totalRemainingCredits',
        'usedSections',
        'rounds',
        'meanAssignedUtility',
        'stopReasonCounts',
      ].sort(),
    );
    const serialized = JSON.stringify(summary);
    for (const student of result.input.students)
      expect(serialized).not.toContain(student.studentId);
    for (const course of result.input.courses) expect(serialized).not.toContain(course.courseId);
  });

  it('summarizes a deeply frozen result without modifying its pinned evidence', () => {
    const result = deepFreeze(referenceResult());
    const before = JSON.stringify(result);
    expect(summarizeSemesterAllocationProfileResult(result).assignedCourseCount).toBe(36);
    expect(JSON.stringify(result)).toBe(before);
  });

  it.each(['assignedCourseCount', 'assignedStudentCount', 'usedSections', 'rounds'] as const)(
    'rejects a forged %s before deriving benchmark aggregates',
    (field) => {
      const result = referenceResult();
      expect(() =>
        summarizeSemesterAllocationProfileResult({ ...result, [field]: result[field] + 1 }),
      ).toThrow();
    },
  );

  it('rejects false credit accounting and extra captured identity fields', () => {
    const result = referenceResult();
    expect(() =>
      summarizeSemesterAllocationProfileResult({
        ...result,
        students: result.students.map((student, index) =>
          index === 0 ? { ...student, remainingCredits: 1 } : student,
        ),
      }),
    ).toThrow();
    expect(() =>
      summarizeSemesterAllocationProfileResult({
        ...result,
        requesterEmail: 'not-captured@example.test',
      }),
    ).toThrow();
    expect(() =>
      summarizeSemesterAllocationProfileResult({ ...result, eligibilityValidated: true }),
    ).toThrow();
  });
});

describe('observational profile sample summaries', () => {
  it('reports millisecond samples with the middle observed value for odd sample counts', () => {
    const samples = [9.5, 1.25, 3.75];
    expect(summarizeProfileSamples(samples)).toEqual({
      sampleCount: 3,
      minMs: 1.25,
      medianMs: 3.75,
      maxMs: 9.5,
    });
    expect(samples).toEqual([9.5, 1.25, 3.75]);
  });

  it('averages the two middle observed values for an even sample count', () => {
    expect(summarizeProfileSamples([10, 2, 9, 1])).toEqual({
      sampleCount: 4,
      minMs: 1,
      medianMs: 5.5,
      maxMs: 10,
    });
    expect(summarizeProfileSamples([0])).toEqual({
      sampleCount: 1,
      minMs: 0,
      medianMs: 0,
      maxMs: 0,
    });
  });

  it.each(
    [[], [-1], [NaN], [Infinity], [-Infinity], [1, NaN]].map((samples) => [samples] as [number[]]),
  )('rejects unavailable or invalid timing measurements %j', (samples) => {
    expect(() => summarizeProfileSamples(samples)).toThrow();
  });
});

describe('independent profile allocation accounting', () => {
  type Result = ReturnType<typeof referenceResult>;
  const mutations: Array<[string, (result: Result) => void]> = [
    [
      'balanced but false per-student credits',
      (result) => {
        result.students[0].assignedCredits--;
        result.students[0].remainingCredits++;
      },
    ],
    [
      'missing assigned course in student result',
      (result) => {
        result.students[0].courseIds.pop();
      },
    ],
    [
      'duplicate student assigned course',
      (result) => {
        result.students[0].courseIds[1] = result.students[0].courseIds[0];
      },
    ],
    [
      'forged student target',
      (result) => {
        result.students[0].targetCredits++;
        result.students[0].remainingCredits++;
      },
    ],
    [
      'missing captured student result',
      (result) => {
        result.students.pop();
      },
    ],
    [
      'duplicate captured student result',
      (result) => {
        result.students[1] = {
          ...result.students[0],
          courseIds: [...result.students[0].courseIds],
        };
      },
    ],
    [
      'forged original course demand',
      (result) => {
        result.courses[0].demandStudentCount++;
      },
    ],
    [
      'missing catalog ledger row',
      (result) => {
        result.courses.pop();
      },
    ],
    [
      'extra catalog ledger row',
      (result) => {
        result.courses.push({
          ...result.courses[0],
          courseId: 'aaaaaaaa-0000-4000-8000-999999999999',
        });
      },
    ],
    [
      'duplicate catalog ledger row',
      (result) => {
        result.courses.push({ ...result.courses[0] });
      },
    ],
    [
      'forged ledger credits',
      (result) => {
        result.courses[0].credits++;
      },
    ],
    [
      'forged assigned-course count',
      (result) => {
        result.assignedCourseCount++;
      },
    ],
    [
      'forged assigned-student count',
      (result) => {
        result.assignedStudentCount++;
      },
    ],
    [
      'forged rounds',
      (result) => {
        result.rounds++;
      },
    ],
    [
      'false public reference usage',
      (result) => {
        Object.assign(result, { usage: 'PRODUCTION' });
      },
    ],
    [
      'false eligibility validation',
      (result) => {
        Object.assign(result, { eligibilityValidated: true });
      },
    ],
    [
      'false allocation validation',
      (result) => {
        Object.assign(result, { allocationValidated: true });
      },
    ],
    [
      'false timetable validation',
      (result) => {
        Object.assign(result, { timetableValidated: true });
      },
    ],
    [
      'false persistence claim',
      (result) => {
        Object.assign(result, { persisted: true });
      },
    ],
  ];

  it('accepts verified tiny fixture evidence through the independent check', () => {
    const result = deepFreeze(referenceResult());
    expect(() => assertProfileExpectations('reference', result)).not.toThrow();
    const missing = buildSemesterAllocationProfileFixture('missing-resources');
    const missingResult = allocateSimulationSemester(
      missing.envelope,
      missing.input,
      missing.policy,
    );
    expect(() => assertProfileExpectations('missing-resources', missingResult)).not.toThrow();
  });

  it.each(mutations)(
    'rejects %s without relying on the replay schema or summary helper',
    (_name, mutate) => {
      const result = referenceResult();
      mutate(result);
      expect(() => assertProfileExpectations('reference', result)).toThrow();
    },
  );

  it('rejects a fixture result claimed under another scenario', () => {
    expect(() => assertProfileExpectations('missing-resources', referenceResult())).toThrow();
  });
});

describe('profile evidence digests', () => {
  it('is deterministic for identical JSON without mutating frozen evidence', () => {
    const value = deepFreeze(buildSemesterAllocationProfileFixture('reference'));
    const before = JSON.stringify(value);
    const digest = profileDigest(value);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(profileDigest(JSON.parse(before))).toBe(digest);
    expect(profileDigest(buildSemesterAllocationProfileFixture('missing-resources'))).not.toBe(
      digest,
    );
    expect(JSON.stringify(value)).toBe(before);
  });

  it.each([undefined, () => 1, Symbol('unserializable')])(
    'rejects values with no JSON representation %#',
    (value) => {
      expect(() => profileDigest(value)).toThrow();
    },
  );

  it('rejects cyclic evidence rather than emitting an identity for incomplete JSON', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => profileDigest(cyclic)).toThrow();
  });
});

describe('bounded explicit semester profiling options', () => {
  it('defaults to all scenarios, three measured samples and one warm-up with a process deadline', () => {
    expect(parseSemesterAllocationProfileOptions([])).toEqual({
      scenario: 'all',
      samples: 3,
      warmup: 1,
      timeoutMs: 60000,
    });
  });

  it.each(PROFILE_SCENARIOS)(
    'accepts the supported %s scenario with the smallest measurement settings',
    (scenario) => {
      expect(
        parseSemesterAllocationProfileOptions([
          '--scenario',
          scenario,
          '--samples',
          '1',
          '--warmup',
          '0',
          '--timeout-ms',
          '1000',
        ]),
      ).toEqual({ scenario, samples: 1, warmup: 0, timeoutMs: 1000 });
    },
  );

  it('accepts upper measurement bounds and flag reordering', () => {
    expect(
      parseSemesterAllocationProfileOptions([
        '--timeout-ms',
        '120000',
        '--warmup',
        '3',
        '--scenario',
        'all',
        '--samples',
        '10',
      ]),
    ).toEqual({ scenario: 'all', samples: 10, warmup: 3, timeoutMs: 120000 });
  });

  it.each(
    [
      ['--scenario', 'unknown'],
      ['--scenario', 'REFERENCE'],
      ['--scenario'],
      ['--samples'],
      ['--warmup'],
      ['--timeout-ms'],
      ['--unknown', '1'],
      ['constructor', '1'],
      ['toString', '1'],
      ['__proto__', '1'],
      ['--samples=2'],
      ['reference'],
      ['--samples', '1', '--samples', '2'],
      ['--scenario', 'reference', '--scenario', 'scarce'],
      ['--warmup', '0', '--warmup', '1'],
      ['--timeout-ms', '1000', '--timeout-ms', '2000'],
      ['--samples', '0'],
      ['--samples', '11'],
      ['--samples', '-1'],
      ['--samples', '+1'],
      ['--samples', '1.5'],
      ['--samples', '1e0'],
      ['--samples', 'Infinity'],
      ['--samples', 'NaN'],
      ['--samples', ' 1'],
      ['--samples', '1\n'],
      ['--samples', '3\n'],
      ['--warmup', '-1'],
      ['--warmup', '4'],
      ['--warmup', '0.5'],
      ['--timeout-ms', '999'],
      ['--timeout-ms', '120001'],
      ['--timeout-ms', '1000.0'],
      ['--timeout-ms', '9007199254740993'],
      ['--scenario', 'all', 'unused'],
    ].map((argv) => [argv] as [string[]]),
  )('rejects unknown, repeated, missing or unsafe CLI options %j', (argv) => {
    expect(() => parseSemesterAllocationProfileOptions(argv)).toThrow();
  });
});
