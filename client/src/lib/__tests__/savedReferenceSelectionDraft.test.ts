import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerId, referenceId } from '@/test/fixtures/curriculumReference';
import { savedCourseId, savedPlanId, savedSemesterId } from '@/test/fixtures/savedStudyPlanCourses';
import {
  extraSelectionCourseId,
  referenceSelectionScope,
} from '@/test/fixtures/savedReferenceSelection';
import {
  loadReferenceSelectionDraft,
  referenceSelectionDraftKey,
  StoredReferenceSelectionDraftSchema,
  type StoredReferenceSelectionDraft,
} from '../savedReferenceSelectionDraft';

const scope = referenceSelectionScope;
const key = referenceSelectionDraftKey(scope);
const stored = (): StoredReferenceSelectionDraft => ({
  version: 1,
  ownerId,
  curriculumId: referenceId,
  planId: savedPlanId,
  semesterId: savedSemesterId,
  baseRevision: 7,
  draft: { year: '2.', semester: '', courseIds: [extraSelectionCourseId, savedCourseId] },
});
beforeEach(() => sessionStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('unsent reference selection draft storage', () => {
  it('returns NONE without writing or removing any recovery data', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    expect(loadReferenceSelectionDraft(scope)).toEqual({ status: 'NONE' });
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('returns a strict scoped draft and its exact raw representation without filtering courses', () => {
    const value = stored();
    const raw = JSON.stringify(value, null, 2);
    sessionStorage.setItem(key, raw);
    expect(loadReferenceSelectionDraft(scope)).toEqual({ status: 'FOUND', value, raw });
    expect(sessionStorage.getItem(key)).toBe(raw);
  });

  it('normalizes scope and stored identities while preserving selection order and raw data', () => {
    const value = stored();
    const raw = JSON.stringify({
      ...value,
      ownerId: ownerId.toUpperCase(),
      curriculumId: referenceId.toUpperCase(),
      planId: savedPlanId.toUpperCase(),
      semesterId: savedSemesterId.toUpperCase(),
      draft: { ...value.draft, courseIds: value.draft.courseIds.map((id) => id.toUpperCase()) },
    });
    sessionStorage.setItem(key, raw);
    const uppercase = {
      ownerId: ownerId.toUpperCase(),
      expectedCurriculumId: referenceId.toUpperCase(),
      planId: savedPlanId.toUpperCase(),
      semesterId: savedSemesterId.toUpperCase(),
    };
    expect(referenceSelectionDraftKey(uppercase)).toBe(key);
    expect(loadReferenceSelectionDraft(uppercase)).toEqual({ status: 'FOUND', value, raw });
  });

  it.each(['ownerId', 'curriculumId', 'planId', 'semesterId'] as const)(
    'rejects a copied envelope with mismatched %s without exposing its contents',
    (field) => {
      const value = stored();
      sessionStorage.setItem(key, JSON.stringify({ ...value, [field]: savedCourseId }));
      expect(loadReferenceSelectionDraft(scope)).toEqual({ status: 'INVALID' });
      expect(sessionStorage.getItem(key)).not.toBeNull();
    },
  );

  it.each(['ownerId', 'expectedCurriculumId', 'planId', 'semesterId'] as const)(
    'keeps %s scope in a separate storage key',
    (field) => {
      sessionStorage.setItem(key, JSON.stringify(stored()));
      const other = { ...scope, [field]: savedCourseId };
      expect(referenceSelectionDraftKey(other)).not.toBe(key);
      expect(loadReferenceSelectionDraft(other)).toEqual({ status: 'NONE' });
    },
  );

  it('distinguishes null curriculum keys but cannot restore a curriculum draft into null scope', () => {
    const unassigned = { ...scope, expectedCurriculumId: null };
    const unassignedKey = referenceSelectionDraftKey(unassigned);
    expect(unassignedKey).not.toBe(key);
    sessionStorage.setItem(unassignedKey, JSON.stringify(stored()));
    expect(loadReferenceSelectionDraft(unassigned)).toEqual({ status: 'INVALID' });
    expect(
      StoredReferenceSelectionDraftSchema.safeParse({ ...stored(), curriculumId: null }).success,
    ).toBe(false);
  });

  it.each(['', '{broken', 'null', '[]', '1', '"private draft"'])(
    'rejects malformed or non-object recovery data %j',
    (raw) => {
      sessionStorage.setItem(key, raw);
      expect(loadReferenceSelectionDraft(scope)).toEqual({ status: 'INVALID' });
    },
  );

  it('bounds the raw input before parsing and preserves oversized data for explicit handling', () => {
    const raw = ' '.repeat(16385);
    sessionStorage.setItem(key, raw);
    const parse = vi.spyOn(JSON, 'parse');
    expect(loadReferenceSelectionDraft(scope)).toEqual({ status: 'INVALID' });
    expect(parse).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(key)).toBe(raw);
  });

  it.each([
    { version: 2 },
    { baseRevision: -1 },
    { baseRevision: 1.5 },
    { baseRevision: 2147483648 },
    { ownerId: 'not-a-uuid' },
    { requestId: savedCourseId },
    { draft: { ...stored().draft, requestId: savedCourseId } },
    { draft: { ...stored().draft, year: '1'.repeat(65) } },
    { draft: { ...stored().draft, year: 2 } },
    { draft: { ...stored().draft, semester: '4' } },
    { draft: { ...stored().draft, courseIds: [savedCourseId, savedCourseId.toUpperCase()] } },
    { draft: { ...stored().draft, courseIds: ['invalid'] } },
  ])('rejects invalid envelope fields and immutable-request extras %j', (invalid) => {
    sessionStorage.setItem(key, JSON.stringify({ ...stored(), ...invalid }));
    expect(loadReferenceSelectionDraft(scope)).toEqual({ status: 'INVALID' });
  });

  it('allows bounded partial slot strings, empty selections and both revision boundaries', () => {
    for (const baseRevision of [0, 2147483647]) {
      for (const year of ['', '-', '2.', '1'.repeat(64)]) {
        expect(
          StoredReferenceSelectionDraftSchema.parse({
            ...stored(),
            baseRevision,
            draft: { year, semester: '3', courseIds: [] },
          }).draft,
        ).toEqual({ year, semester: '3', courseIds: [] });
      }
    }
  });

  it('retains exactly 100 ordered course IDs but rejects 101', () => {
    const courseIds = Array.from(
      { length: 101 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    const hundred = {
      ...stored(),
      draft: { ...stored().draft, courseIds: courseIds.slice(0, 100) },
    };
    expect(StoredReferenceSelectionDraftSchema.parse(hundred).draft.courseIds).toEqual(
      courseIds.slice(0, 100),
    );
    expect(
      StoredReferenceSelectionDraftSchema.safeParse({
        ...stored(),
        draft: { ...stored().draft, courseIds },
      }).success,
    ).toBe(false);
  });

  it('reports unavailable storage without falling back to another persistence store', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('denied');
      },
    });
    expect(loadReferenceSelectionDraft(scope)).toEqual({ status: 'UNAVAILABLE' });
  });

  it('rejects invalid requested scope before reading storage', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem');
    expect(loadReferenceSelectionDraft({ ...scope, ownerId: 'invalid' })).toEqual({
      status: 'INVALID',
    });
    expect(get).not.toHaveBeenCalled();
  });
});
