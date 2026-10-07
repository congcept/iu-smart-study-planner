import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceScopeDTO, SemesterAllocationJobDTO } from '@iu-study-planner/shared';
import {
  SemesterAllocationJobRecoveryError,
  confirmSemesterAllocationJobJournal,
  readSemesterAllocationJobJournal,
  semesterAllocationJobRecoveryKey,
  writeSemesterAllocationJobJournal,
  type SemesterAllocationJobJournal,
} from '../semesterAllocationJobRecovery';

const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const curriculumId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const requestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const jobId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const scope: ResourceScopeDTO = { curriculumId, semester: 'FALL', year: 2026 };
const job = (): SemesterAllocationJobDTO => ({
  id: jobId,
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  model: 'SEMESTER_CREDIT_BUDGET_V1',
  scope: { ...scope },
  status: 'QUEUED',
  queuedAt: '2026-10-07T14:00:00.000Z',
  inputsCaptured: false,
});
const pending = (): SemesterAllocationJobJournal => ({
  version: 1,
  ownerId,
  request: { ...scope, requestId, expectedActorId: ownerId },
  job: null,
});
const receipt = (): SemesterAllocationJobJournal => ({ ...pending(), job: job() });
const saved = new Map<string, string>();
const getItem = vi.fn((key: string): string | null => saved.get(key) ?? null);
const setItem = vi.fn((key: string, value: string) => saved.set(key, value));
const removeItem = vi.fn((key: string) => saved.delete(key));
const key = semesterAllocationJobRecoveryKey(ownerId, scope);
const seed = (value: unknown) => saved.set(key, JSON.stringify(value));

beforeEach(() => {
  saved.clear();
  vi.clearAllMocks();
  getItem.mockImplementation((key) => saved.get(key) ?? null);
  setItem.mockImplementation((key, value) => saved.set(key, value));
  vi.stubGlobal('sessionStorage', { getItem, setItem, removeItem });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('semester request tab journal', () => {
  it('reads and confirms an empty scenario without changing browser data', () => {
    expect(readSemesterAllocationJobJournal(ownerId, scope)).toBeNull();
    expect(confirmSemesterAllocationJobJournal(null, ownerId, scope)).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('uses a distinct normalized namespace without accessing storage', () => {
    expect(
      semesterAllocationJobRecoveryKey(ownerId.toUpperCase(), {
        ...scope,
        curriculumId: curriculumId.toUpperCase(),
      }),
    ).toBe(`semester_allocation_job_request:${ownerId}:${curriculumId}:FALL:2026`);
    expect(getItem).not.toHaveBeenCalled();
  });

  it.each([
    [otherId, scope],
    [ownerId, { ...scope, curriculumId: otherId }],
    [ownerId, { ...scope, semester: 'SPRING' as const }],
    [ownerId, { ...scope, year: 2027 }],
  ] as const)('isolates another owner or scenario %#', (owner, scenario) => {
    seed(receipt());
    expect(readSemesterAllocationJobJournal(owner, scenario)).toBeNull();
    expect(saved.get(key)).toBe(JSON.stringify(receipt()));
    expect(setItem).not.toHaveBeenCalled();
  });

  it('saves a durable pending key, then its full immutable queued receipt', () => {
    const observed = writeSemesterAllocationJobJournal(pending());
    expect(getItem).toHaveBeenCalledTimes(2);
    expect(setItem).toHaveBeenCalledExactlyOnceWith(key, JSON.stringify(pending()));
    const confirmed = writeSemesterAllocationJobJournal({ ...observed, job: job() }, observed);
    expect(confirmed).toEqual(receipt());
    expect(confirmSemesterAllocationJobJournal(confirmed, ownerId, scope)).toEqual(receipt());
    expect(writeSemesterAllocationJobJournal(confirmed, confirmed)).toEqual(receipt());
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('normalizes UUIDs on write but preserves noncanonical existing bytes on a read-only check', () => {
    const upper = {
      ...receipt(),
      ownerId: ownerId.toUpperCase(),
      request: {
        ...pending().request,
        curriculumId: curriculumId.toUpperCase(),
        requestId: requestId.toUpperCase(),
        expectedActorId: ownerId.toUpperCase(),
      },
      job: {
        ...job(),
        id: jobId.toUpperCase(),
        scope: { ...scope, curriculumId: curriculumId.toUpperCase() },
      },
    };
    const raw = JSON.stringify(upper, null, 2);
    saved.set(key, raw);
    const observed = readSemesterAllocationJobJournal(ownerId, scope);
    expect(observed).toEqual(receipt());
    expect(confirmSemesterAllocationJobJournal(observed, ownerId, scope)).toEqual(receipt());
    expect(saved.get(key)).toBe(raw);
    expect(setItem).not.toHaveBeenCalled();
    expect(writeSemesterAllocationJobJournal(observed!, observed)).toEqual(receipt());
    expect(saved.get(key)).toBe(JSON.stringify(receipt()));
  });

  it('permits a new pending key only against an observed full receipt', () => {
    seed(receipt());
    const observed = readSemesterAllocationJobJournal(ownerId, scope);
    const next = { ...pending(), request: { ...pending().request, requestId: otherId } };
    expect(writeSemesterAllocationJobJournal(next, observed)).toEqual(next);
    expect(readSemesterAllocationJobJournal(ownerId, scope)).toEqual(next);
  });

  it.each([
    [null, receipt()],
    [pending(), { ...pending(), request: { ...pending().request, requestId: otherId } }],
    [receipt(), { ...receipt(), request: { ...pending().request, requestId: otherId } }],
  ] as const)(
    'refuses receipt-without-key or replacement of an uncertain key %#',
    (previous, next) => {
      if (previous !== null) seed(previous);
      const before = saved.get(key);
      expect(() => writeSemesterAllocationJobJournal(next, previous)).toThrow(
        SemesterAllocationJobRecoveryError,
      );
      expect(saved.get(key)).toBe(before);
      expect(setItem).not.toHaveBeenCalled();
    },
  );

  it.each([null, { ...job(), id: otherId }, { ...job(), queuedAt: '2026-10-07T14:00:00.001Z' }])(
    'cannot remove or replace known receipt metadata under the same request ID %#',
    (changed) => {
      seed(receipt());
      const observed = readSemesterAllocationJobJournal(ownerId, scope);
      expect(() =>
        writeSemesterAllocationJobJournal({ ...receipt(), job: changed }, observed),
      ).toThrow(SemesterAllocationJobRecoveryError);
      expect(saved.get(key)).toBe(JSON.stringify(receipt()));
      expect(setItem).not.toHaveBeenCalled();
    },
  );

  it.each([
    '{',
    'null',
    '[]',
    '"request"',
    JSON.stringify({ ...pending(), version: 2 }),
    JSON.stringify({ ...pending(), ownerId: otherId }),
    JSON.stringify({ ...pending(), ownerId: `${ownerId}\n` }),
    JSON.stringify({ ...pending(), request: { ...pending().request, expectedActorId: otherId } }),
    JSON.stringify({ ...pending(), request: { ...pending().request, curriculumId: otherId } }),
    JSON.stringify({ ...pending(), request: { ...pending().request, year: 2027 } }),
    JSON.stringify({
      ...pending(),
      request: { ...pending().request, requestId: `${requestId}\n` },
    }),
    JSON.stringify({ ...pending(), request: { ...pending().request, students: [] } }),
    JSON.stringify({ version: 1, ownerId, request: pending().request }),
    JSON.stringify({ ...pending(), jobId }),
    JSON.stringify({ ...pending(), outcome: { status: 'SUCCEEDED' } }),
    JSON.stringify({ ...receipt(), job: { ...job(), model: 'ONE_COURSE_PER_STUDENT_ROUND_V1' } }),
    JSON.stringify({ ...receipt(), job: { ...job(), kind: 'OFFICIAL' } }),
    JSON.stringify({ ...receipt(), job: { ...job(), inputsCaptured: true } }),
    JSON.stringify({ ...receipt(), job: { ...job(), status: 'SUCCEEDED' } }),
    JSON.stringify({ ...receipt(), job: { ...job(), scope: { ...scope, semester: 'SPRING' } } }),
    JSON.stringify({ ...receipt(), job: { ...job(), scope: { ...scope, curriculumId: otherId } } }),
    JSON.stringify({ ...receipt(), job: { ...job(), id: `${jobId}\n` } }),
    JSON.stringify({ ...receipt(), job: { ...job(), queuedAt: 'not a time' } }),
    JSON.stringify({ ...receipt(), job: { ...job(), authorId: ownerId } }),
    JSON.stringify({ ...receipt(), job: { ...job(), students: [] } }),
  ])(
    'blocks malformed/private/foreign bytes on read and write without repairing them %#',
    (raw) => {
      saved.set(key, raw);
      expect(() => readSemesterAllocationJobJournal(ownerId, scope)).toThrow(
        SemesterAllocationJobRecoveryError,
      );
      expect(() => writeSemesterAllocationJobJournal(pending())).toThrow(
        SemesterAllocationJobRecoveryError,
      );
      expect(saved.get(key)).toBe(raw);
      expect(setItem).not.toHaveBeenCalled();
      expect(removeItem).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...pending(), ownerId: otherId },
    { ...pending(), request: { ...pending().request, curriculumId: otherId } },
    { ...pending(), request: { ...pending().request, semester: 'SPRING' as const } },
    { ...pending(), request: { ...pending().request, year: 2027 } },
    { ...pending(), request: { ...pending().request, requestId: 'bad' } },
  ])('validates caller expectations before reading or overwriting evidence %#', (previous) => {
    seed(pending());
    expect(() => writeSemesterAllocationJobJournal(receipt(), previous)).toThrow(
      SemesterAllocationJobRecoveryError,
    );
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('rejects an owner/actor mismatch before accessing storage', () => {
    expect(() => writeSemesterAllocationJobJournal({ ...pending(), ownerId: otherId })).toThrow(
      SemesterAllocationJobRecoveryError,
    );
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it.each([
    (value: SemesterAllocationJobJournal) => JSON.stringify(value, null, 2),
    (value: SemesterAllocationJobJournal) =>
      JSON.stringify({ ...value, ownerId: ownerId.toUpperCase() }),
    (value: SemesterAllocationJobJournal) =>
      JSON.stringify({
        job: value.job,
        request: value.request,
        ownerId: value.ownerId,
        version: value.version,
      }),
  ])('rejects semantically equal raw rewrites during asynchronous work %#', (change) => {
    const observed = writeSemesterAllocationJobJournal(pending());
    const raw = change(observed);
    saved.set(key, raw);
    setItem.mockClear();
    expect(() => confirmSemesterAllocationJobJournal(observed, ownerId, scope)).toThrow(
      SemesterAllocationJobRecoveryError,
    );
    expect(() => writeSemesterAllocationJobJournal({ ...observed, job: job() }, observed)).toThrow(
      SemesterAllocationJobRecoveryError,
    );
    expect(saved.get(key)).toBe(raw);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('rejects mutations to the expected object even when saved bytes are unchanged', () => {
    const observed = writeSemesterAllocationJobJournal(pending());
    observed.request.requestId = otherId;
    expect(() => confirmSemesterAllocationJobJournal(observed, ownerId, scope)).toThrow(
      SemesterAllocationJobRecoveryError,
    );
    expect(saved.get(key)).toBe(JSON.stringify(pending()));
  });

  it('detects a changed or deleted journal before receipt storage', () => {
    const observed = writeSemesterAllocationJobJournal(pending());
    saved.delete(key);
    setItem.mockClear();
    expect(() => writeSemesterAllocationJobJournal({ ...observed, job: job() }, observed)).toThrow(
      SemesterAllocationJobRecoveryError,
    );
    expect(saved.has(key)).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('blocks denied reads without dropping the existing request key', () => {
    seed(pending());
    getItem.mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => readSemesterAllocationJobJournal(ownerId, scope)).toThrow(
      SemesterAllocationJobRecoveryError,
    );
    expect(() => writeSemesterAllocationJobJournal(receipt(), pending())).toThrow(
      SemesterAllocationJobRecoveryError,
    );
    expect(saved.get(key)).toBe(JSON.stringify(pending()));
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('blocks unavailable storage without inventing a fresh key', () => {
    vi.stubGlobal('sessionStorage', undefined);
    expect(() => readSemesterAllocationJobJournal(ownerId, scope)).toThrow(
      SemesterAllocationJobRecoveryError,
    );
    expect(() => writeSemesterAllocationJobJournal(pending())).toThrow(
      SemesterAllocationJobRecoveryError,
    );
    expect(setItem).not.toHaveBeenCalled();
  });

  it('preserves the original pending key on denied receipt writes', () => {
    const observed = writeSemesterAllocationJobJournal(pending());
    const raw = saved.get(key);
    setItem.mockImplementation(() => {
      throw new Error('full');
    });
    expect(() => writeSemesterAllocationJobJournal({ ...observed, job: job() }, observed)).toThrow(
      SemesterAllocationJobRecoveryError,
    );
    expect(saved.get(key)).toBe(raw);
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('refuses a silently dropped write instead of authorizing a non-durable POST', () => {
    setItem.mockImplementation(() => saved);
    expect(() => writeSemesterAllocationJobJournal(pending())).toThrow(
      SemesterAllocationJobRecoveryError,
    );
    expect(saved.has(key)).toBe(false);
  });

  it.each([
    '{',
    JSON.stringify({ ...pending(), request: { ...pending().request, requestId: otherId } }),
    JSON.stringify(pending(), null, 2),
  ])('blocks unverified read-back bytes %# without automatic deletion or rewrite', (raw) => {
    setItem.mockImplementation((storageKey) => saved.set(storageKey, raw));
    expect(() => writeSemesterAllocationJobJournal(pending())).toThrow(
      SemesterAllocationJobRecoveryError,
    );
    expect(saved.get(key)).toBe(raw);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('keeps the physically saved retry key when the confirming read is denied', () => {
    getItem
      .mockImplementationOnce(() => null)
      .mockImplementationOnce(() => {
        throw new Error('readback denied');
      });
    expect(() => writeSemesterAllocationJobJournal(pending())).toThrow(
      SemesterAllocationJobRecoveryError,
    );
    expect(saved.get(key)).toBe(JSON.stringify(pending()));
    expect(readSemesterAllocationJobJournal(ownerId, scope)).toEqual(pending());
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('preserves every other journal namespace and scenario during a verified write', () => {
    const otherKey = semesterAllocationJobRecoveryKey(otherId, { ...scope, year: 2027 });
    saved.set(otherKey, 'foreign tab bytes');
    saved.set(`allocation_job_request:${ownerId}:${curriculumId}:FALL:2026`, 'one-course bytes');
    saved.set(
      `semester_allocation_run_capture:${ownerId}:${curriculumId}:FALL:2026`,
      'capture bytes',
    );
    writeSemesterAllocationJobJournal(pending());
    expect(saved.get(otherKey)).toBe('foreign tab bytes');
    expect(saved.size).toBe(4);
  });
});
