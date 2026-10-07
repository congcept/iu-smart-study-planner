import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerId } from '@/test/fixtures/curriculumReference';
import { semesterAllocationScope } from '@/test/fixtures/semesterAllocationPreview';
import {
  SemesterAllocationRunRecoveryError,
  readSemesterAllocationRunJournal,
  semesterAllocationRunRecoveryKey,
  writeSemesterAllocationRunJournal,
  type SemesterAllocationRunJournal,
} from '../semesterAllocationRunRecovery';

const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const runId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const pending = (): SemesterAllocationRunJournal => ({
  version: 1,
  ownerId,
  request: { ...semesterAllocationScope, expectedActorId: ownerId, requestId },
});
const key = () => semesterAllocationRunRecoveryKey(ownerId, semesterAllocationScope);

beforeEach(() => {
  vi.resetAllMocks();
  const saved = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn((id: string) => saved.get(id) ?? null),
    setItem: vi.fn((id: string, value: string) => saved.set(id, value)),
    removeItem: vi.fn((id: string) => saved.delete(id)),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('semester capture tab recovery journal', () => {
  it('normalizes the key and separates each administrator and scenario', () => {
    expect(
      semesterAllocationRunRecoveryKey(ownerId.toUpperCase(), {
        ...semesterAllocationScope,
        curriculumId: semesterAllocationScope.curriculumId.toUpperCase(),
      }),
    ).toBe(
      `semester_allocation_run_capture:${ownerId}:${semesterAllocationScope.curriculumId}:FALL:2026`,
    );
    expect(semesterAllocationRunRecoveryKey(otherId, semesterAllocationScope)).not.toBe(key());
    expect(
      semesterAllocationRunRecoveryKey(ownerId, { ...semesterAllocationScope, year: 2027 }),
    ).not.toBe(key());
  });

  it('reads an absent journal without creating or removing browser data', () => {
    expect(readSemesterAllocationRunJournal(ownerId, semesterAllocationScope)).toBeNull();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
  });

  it('confirms a durable pending key and then stores only its exact receipt', () => {
    const saved = writeSemesterAllocationRunJournal(pending(), null);
    expect(readSemesterAllocationRunJournal(ownerId, semesterAllocationScope)).toEqual(saved);
    const receipt = writeSemesterAllocationRunJournal({ ...saved, runId }, saved);
    expect(readSemesterAllocationRunJournal(ownerId, semesterAllocationScope)).toEqual(receipt);
    expect(JSON.parse(sessionStorage.getItem(key())!)).toEqual({ ...pending(), runId });
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
  });

  it.each([
    '{broken json',
    JSON.stringify({ ...pending(), version: 2 }),
    JSON.stringify({ ...pending(), ownerId: otherId }),
    JSON.stringify({ ...pending(), request: { ...pending().request, expectedActorId: otherId } }),
    JSON.stringify({ ...pending(), runId: `${runId}\n` }),
    JSON.stringify({ ...pending(), result: { students: [] } }),
  ])('preserves malformed or foreign journal bytes without repair %#', (raw) => {
    sessionStorage.setItem(key(), raw);
    vi.mocked(sessionStorage.setItem).mockClear();
    expect(() => readSemesterAllocationRunJournal(ownerId, semesterAllocationScope)).toThrow(
      SemesterAllocationRunRecoveryError,
    );
    expect(sessionStorage.getItem(key())).toBe(raw);
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
  });

  it('refuses to overwrite a journal changed by another mounted view', () => {
    const saved = writeSemesterAllocationRunJournal(pending(), null);
    const foreign = JSON.stringify({
      ...pending(),
      request: { ...pending().request, requestId: otherId },
    });
    sessionStorage.setItem(key(), foreign);
    vi.mocked(sessionStorage.setItem).mockClear();
    expect(() => writeSemesterAllocationRunJournal({ ...saved, runId }, saved)).toThrow(
      SemesterAllocationRunRecoveryError,
    );
    expect(sessionStorage.getItem(key())).toBe(foreign);
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it('detects semantically identical raw rewrites instead of erasing another view’s bytes', () => {
    const saved = writeSemesterAllocationRunJournal(pending(), null);
    const changed = JSON.stringify(saved, null, 2);
    sessionStorage.setItem(key(), changed);
    vi.mocked(sessionStorage.setItem).mockClear();
    expect(() => writeSemesterAllocationRunJournal({ ...saved, runId }, saved)).toThrow(
      SemesterAllocationRunRecoveryError,
    );
    expect(sessionStorage.getItem(key())).toBe(changed);
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it('blocks when storage is unreadable without dropping an existing receipt', () => {
    sessionStorage.setItem(key(), JSON.stringify({ ...pending(), runId }));
    const raw = sessionStorage.getItem(key());
    const denied = vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    expect(() => readSemesterAllocationRunJournal(ownerId, semesterAllocationScope)).toThrow(
      SemesterAllocationRunRecoveryError,
    );
    denied.mockRestore();
    expect(sessionStorage.getItem(key())).toBe(raw);
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
  });

  it('blocks an unconfirmed write rather than treating a silent storage failure as durable', () => {
    vi.mocked(sessionStorage.setItem).mockImplementation(() => undefined);
    expect(() => writeSemesterAllocationRunJournal(pending(), null)).toThrow(
      SemesterAllocationRunRecoveryError,
    );
    expect(readSemesterAllocationRunJournal(ownerId, semesterAllocationScope)).toBeNull();
  });

  it('preserves a pending retry key when receipt storage fails', () => {
    const saved = writeSemesterAllocationRunJournal(pending(), null);
    const raw = sessionStorage.getItem(key());
    vi.mocked(sessionStorage.setItem).mockImplementationOnce(() => {
      throw new Error('Full');
    });
    expect(() => writeSemesterAllocationRunJournal({ ...saved, runId }, saved)).toThrow(
      SemesterAllocationRunRecoveryError,
    );
    expect(sessionStorage.getItem(key())).toBe(raw);
  });
});
