import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumSummaryDTO } from '@iu-study-planner/shared';
import apiClient from '../api';
import { getCurriculumReferences } from '../curriculumApi';

vi.mock('../api', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const reference: CurriculumSummaryDTO = {
  id,
  code: 'CS',
  name: 'Computer Science',
  school: 'CSE',
  degree: 'Bachelor',
  programUrl: 'https://example.test/program',
  totalCredits: null,
  isGpaPath: true,
  sourceLabel: null,
  sourceUrl: null,
  usage: 'REFERENCE_ONLY',
};
beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ data: { success: true, data: [reference] } });
});

describe('curriculum reference list adapter', () => {
  it('reads the public reference list without owner, assignment or school query overrides', async () => {
    expect(await getCurriculumReferences()).toEqual([reference]);
    expect(get).toHaveBeenCalledExactlyOnceWith('/curricula');
  });

  it('normalizes reference UUIDs while preserving nullable source evidence and metadata', async () => {
    get.mockResolvedValue({
      data: { success: true, data: [{ ...reference, id: id.toUpperCase() }] },
    });
    expect(await getCurriculumReferences()).toEqual([reference]);
  });

  it('keeps all returned schools and list order without implying assignment eligibility', async () => {
    const business: CurriculumSummaryDTO = {
      ...reference,
      id: otherId,
      code: 'BA',
      name: 'Business Administration',
      school: 'Business',
      totalCredits: 120,
      isGpaPath: false,
      sourceLabel: 'Signed source',
      sourceUrl: 'http://example.test/signed.pdf',
    };
    get.mockResolvedValue({ data: { success: true, data: [business, reference] } });
    expect(await getCurriculumReferences()).toEqual([business, reference]);
  });

  it('accepts an explicit empty list without inventing a reference or a default curriculum', async () => {
    get.mockResolvedValue({ data: { success: true, data: [] } });
    expect(await getCurriculumReferences()).toEqual([]);
  });

  it.each([
    { id: 'CS' },
    { code: '' },
    { name: '' },
    { school: '' },
    { degree: '' },
    { programUrl: 'not-a-url' },
    { programUrl: 'javascript:alert(1)' },
    { sourceUrl: 'ftp://example.test/reference' },
    { sourceLabel: {} },
    { totalCredits: -1 },
    { totalCredits: 1.5 },
    { totalCredits: Number.MAX_SAFE_INTEGER + 1 },
    { totalCredits: undefined },
    { isGpaPath: 'true' },
    { usage: 'VERIFIED' },
    { courses: [] },
    { assignmentAvailable: true },
  ])('rejects malformed, expanded or nonreference metadata %j', async (override) => {
    get.mockResolvedValue({ data: { success: true, data: [{ ...reference, ...override }] } });
    await expect(getCurriculumReferences()).rejects.toThrow(/verify/);
  });

  it.each([
    [reference, reference],
    [reference, { ...reference, id: id.toUpperCase(), code: 'Other reference' }],
  ])('rejects duplicate normalized reference identifiers %j', async (references) => {
    get.mockResolvedValue({ data: { success: true, data: references } });
    await expect(getCurriculumReferences()).rejects.toThrow(/verify/);
  });

  it.each([
    { success: false, data: [reference] },
    { success: true },
    { success: true, data: null },
    { success: true, data: reference },
    { success: true, data: { curriculums: [reference] } },
  ])('rejects unsuccessful, incomplete or nonarray envelopes %j', async (envelope) => {
    get.mockResolvedValue({ data: envelope });
    await expect(getCurriculumReferences()).rejects.toThrow(/verify/);
  });

  it('preserves a transport failure for explicit retry instead of substituting an empty list', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    await expect(getCurriculumReferences()).rejects.toThrow('offline');
    expect(get).toHaveBeenCalledTimes(1);
  });
});
