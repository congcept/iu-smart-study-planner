import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceScopeDTO } from '@iu-study-planner/shared';
import {
  AllocationJobRecoveryError,
  allocationJobRecoveryKey,
  readAllocationJobJournal,
  writeAllocationJobJournal,
  type AllocationJobJournal,
} from '../allocationJobRecovery';

const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const curriculumId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const requestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const jobId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const scope: ResourceScopeDTO = { curriculumId, semester: 'FALL', year: 2026 };
const pending = (): AllocationJobJournal => ({
  version: 1,
  ownerId,
  request: { ...scope, requestId, expectedActorId: ownerId },
});
const receipt = (): AllocationJobJournal => ({ ...pending(), jobId });
const saved = new Map<string, string>();
const getItem = vi.fn((key: string): string | null => saved.get(key) ?? null);
const setItem = vi.fn((key: string, value: string) => saved.set(key, value));
const removeItem = vi.fn((key: string) => saved.delete(key));
const key = allocationJobRecoveryKey(ownerId, scope);
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

describe('simulation queue session recovery', () => {
  it('reads an empty scenario without creating or deleting a request', () => {
    expect(readAllocationJobJournal(ownerId, scope)).toBeNull();
    expect(getItem).toHaveBeenCalledExactlyOnceWith(key);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('uses a normalized account and exact scenario key without storage access', () => {
    expect(
      allocationJobRecoveryKey(ownerId.toUpperCase(), {
        ...scope,
        curriculumId: curriculumId.toUpperCase(),
      }),
    ).toBe(`allocation_job_request:${ownerId}:${curriculumId}:FALL:2026`);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it.each([
    [otherId, scope],
    [ownerId, { ...scope, curriculumId: otherId }],
    [ownerId, { ...scope, semester: 'SPRING' as const }],
    [ownerId, { ...scope, year: 2027 }],
  ] as const)('isolates another account or scenario %#', (owner, scenario) => {
    seed(receipt());
    expect(allocationJobRecoveryKey(owner, scenario)).not.toBe(key);
    expect(readAllocationJobJournal(owner, scenario)).toBeNull();
    expect(saved.get(key)).toBe(JSON.stringify(receipt()));
    expect(setItem).not.toHaveBeenCalled();
  });

  it('durably saves and reads back a pending retry identity before a caller can POST', () => {
    expect(writeAllocationJobJournal(pending(), null)).toEqual(pending());
    expect(setItem).toHaveBeenCalledExactlyOnceWith(key, JSON.stringify(pending()));
    expect(getItem).toHaveBeenCalledTimes(2);
    expect(readAllocationJobJournal(ownerId, scope)).toEqual(pending());
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('attaches one verified receipt and permits an identical explicit retry', () => {
    seed(pending());
    expect(writeAllocationJobJournal(receipt(), pending())).toEqual(receipt());
    expect(writeAllocationJobJournal(receipt(), receipt())).toEqual(receipt());
    expect(readAllocationJobJournal(ownerId, scope)).toEqual(receipt());
  });

  it('normalizes all UUIDs and property ordering before compare-and-set and read-back', () => {
    const upper: AllocationJobJournal = {
      jobId: jobId.toUpperCase(),
      request: {
        expectedActorId: ownerId.toUpperCase(),
        requestId: requestId.toUpperCase(),
        year: 2026,
        semester: 'FALL',
        curriculumId: curriculumId.toUpperCase(),
      },
      ownerId: ownerId.toUpperCase(),
      version: 1,
    };
    seed(upper);
    expect(readAllocationJobJournal(ownerId, scope)).toEqual(receipt());
    expect(writeAllocationJobJournal(upper, upper)).toEqual(receipt());
    expect(saved.get(key)).toBe(JSON.stringify(receipt()));
  });

  it('permits an explicit new request identity only against the observed receipt', () => {
    seed(receipt());
    const next = { ...pending(), request: { ...pending().request, requestId: otherId } };
    expect(writeAllocationJobJournal(next, receipt())).toEqual(next);
    expect(readAllocationJobJournal(ownerId, scope)).toEqual(next);
  });

  it.each([
    [pending(), null],
    [receipt(), null],
    [receipt(), pending()],
    [{ ...pending(), request: { ...pending().request, requestId: otherId } }, pending()],
  ] as const)(
    'refuses a stale expected journal %# without overwriting the live value',
    (current, expected) => {
      seed(current);
      const before = saved.get(key);
      expect(() => writeAllocationJobJournal(receipt(), expected)).toThrow(
        AllocationJobRecoveryError,
      );
      expect(saved.get(key)).toBe(before);
      expect(setItem).not.toHaveBeenCalled();
      expect(removeItem).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, otherId])(
    'cannot remove or replace a known receipt with %j under the same retry identity',
    (nextJobId) => {
      seed(receipt());
      expect(() =>
        writeAllocationJobJournal({ ...pending(), jobId: nextJobId }, receipt()),
      ).toThrow(AllocationJobRecoveryError);
      expect(saved.get(key)).toBe(JSON.stringify(receipt()));
      expect(setItem).not.toHaveBeenCalled();
    },
  );

  it.each([
    { version: 2 },
    { ownerId: otherId },
    { ownerId: `${ownerId}\n` },
    { jobId: 'job' },
    { jobId: `${jobId}\n` },
    { jobId: null },
    { runId: otherId },
    { outcome: { status: 'SUCCEEDED' } },
    { request: { ...pending().request, expectedActorId: otherId } },
    { request: { ...pending().request, curriculumId: otherId } },
    { request: { ...pending().request, semester: 'SPRING' } },
    { request: { ...pending().request, year: 2027 } },
    { request: { ...pending().request, requestId: `${requestId}\n` } },
    { request: { ...pending().request, actorId: ownerId } },
  ])(
    'blocks malformed, tampered or foreign stored data %# on both read and conditional write',
    (fields) => {
      seed({ ...pending(), ...fields });
      const before = saved.get(key);
      expect(() => readAllocationJobJournal(ownerId, scope)).toThrow(AllocationJobRecoveryError);
      expect(() => writeAllocationJobJournal(pending(), null)).toThrow(AllocationJobRecoveryError);
      expect(saved.get(key)).toBe(before);
      expect(setItem).not.toHaveBeenCalled();
      expect(removeItem).not.toHaveBeenCalled();
    },
  );

  it.each(['{', 'null', '[]', '"request"'])(
    'preserves invalid stored JSON %j for recovery',
    (raw) => {
      saved.set(key, raw);
      expect(() => readAllocationJobJournal(ownerId, scope)).toThrow(AllocationJobRecoveryError);
      expect(() => writeAllocationJobJournal(pending(), null)).toThrow(AllocationJobRecoveryError);
      expect(saved.get(key)).toBe(raw);
      expect(setItem).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...pending(), ownerId: otherId },
    { ...pending(), request: { ...pending().request, curriculumId: otherId } },
    { ...pending(), request: { ...pending().request, semester: 'SPRING' as const } },
    { ...pending(), request: { ...pending().request, year: 2027 } },
    { ...pending(), jobId: 'job' },
  ])('refuses malformed or cross-scenario caller expectations %#', (expected) => {
    seed(pending());
    expect(() => writeAllocationJobJournal(receipt(), expected)).toThrow(
      AllocationJobRecoveryError,
    );
    expect(saved.get(key)).toBe(JSON.stringify(pending()));
    expect(setItem).not.toHaveBeenCalled();
  });

  it('refuses an owner/expected-actor mismatch before any storage operation', () => {
    expect(() => writeAllocationJobJournal({ ...pending(), ownerId: otherId }, null)).toThrow(
      AllocationJobRecoveryError,
    );
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('blocks denied reads without clearing an existing pending request', () => {
    seed(pending());
    getItem.mockImplementation(() => {
      throw new Error('storage denied');
    });
    expect(() => readAllocationJobJournal(ownerId, scope)).toThrow(AllocationJobRecoveryError);
    expect(() => writeAllocationJobJournal(receipt(), pending())).toThrow(
      AllocationJobRecoveryError,
    );
    expect(saved.get(key)).toBe(JSON.stringify(pending()));
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('blocks denied writes while preserving the original pending request', () => {
    seed(pending());
    setItem.mockImplementation(() => {
      throw new Error('storage full');
    });
    expect(() => writeAllocationJobJournal(receipt(), pending())).toThrow(
      AllocationJobRecoveryError,
    );
    expect(saved.get(key)).toBe(JSON.stringify(pending()));
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('rejects a silently dropped write instead of authorizing a non-durable request', () => {
    setItem.mockImplementation(() => saved);
    expect(() => writeAllocationJobJournal(pending(), null)).toThrow(AllocationJobRecoveryError);
    expect(saved.has(key)).toBe(false);
    expect(removeItem).not.toHaveBeenCalled();
  });

  it.each([
    '{',
    JSON.stringify({ ...pending(), request: { ...pending().request, requestId: otherId } }),
    JSON.stringify({ ...pending(), ownerId: otherId }),
  ])('blocks changed read-back %# without deleting or replacing evidence', (raw) => {
    setItem.mockImplementation((storageKey) => saved.set(storageKey, raw));
    expect(() => writeAllocationJobJournal(pending(), null)).toThrow(AllocationJobRecoveryError);
    expect(saved.get(key)).toBe(raw);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('keeps a physically saved retry identity when the confirming read is denied', () => {
    getItem
      .mockImplementationOnce(() => null)
      .mockImplementationOnce(() => {
        throw new Error('read-back denied');
      });
    expect(() => writeAllocationJobJournal(pending(), null)).toThrow(AllocationJobRecoveryError);
    expect(saved.get(key)).toBe(JSON.stringify(pending()));
    expect(readAllocationJobJournal(ownerId, scope)).toEqual(pending());
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('only changes the selected account/scenario during a verified save', () => {
    const otherKey = allocationJobRecoveryKey(otherId, { ...scope, year: 2027 });
    saved.set(otherKey, 'preserved foreign tab journal');
    expect(writeAllocationJobJournal(pending(), null)).toEqual(pending());
    expect(saved.get(otherKey)).toBe('preserved foreign tab journal');
    expect(saved.size).toBe(2);
  });
});
