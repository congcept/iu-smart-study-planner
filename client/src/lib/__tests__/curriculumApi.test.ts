import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumDetailDTO } from '@iu-study-planner/shared';
import {
  curriculumReference,
  otherReferenceId,
  referenceId,
} from '@/test/fixtures/curriculumReference';
import apiClient from '../api';
import { getCurriculumReference } from '../curriculumApi';

afterEach(() => vi.restoreAllMocks());
const reply = (data: unknown, success = true) =>
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { success, data } });
describe('curriculum reference boundary', () => {
  it('reads only the explicit context and accepts its reference metadata', async () => {
    const data = curriculumReference();
    const get = reply(data);
    expect(await getCurriculumReference(referenceId.toUpperCase())).toEqual(data);
    expect(get).toHaveBeenCalledWith(`/curricula/${referenceId}`);
  });
  it('accepts empty contexts without inventing a prior or degree total', async () => {
    const data = curriculumReference();
    data.courses = [];
    data.ratingPrior = null;
    reply(data);
    expect(await getCurriculumReference(referenceId)).toEqual(data);
  });
  it('preserves transport failures for retry', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('offline'));
    await expect(getCurriculumReference(referenceId)).rejects.toThrow('offline');
  });
  it('rejects invalid identifiers before making a request', async () => {
    const get = reply(curriculumReference());
    await expect(getCurriculumReference('CS')).rejects.toThrow(/verify/);
    expect(get).not.toHaveBeenCalled();
  });
  it('rejects another context', async () => {
    reply({ ...curriculumReference(), id: otherReferenceId });
    await expect(getCurriculumReference(referenceId)).rejects.toThrow(/verify/);
  });
  it('rejects failed envelopes', async () => {
    reply(curriculumReference(), false);
    await expect(getCurriculumReference(referenceId)).rejects.toThrow(/verify/);
  });
  it.each([
    ['duplicate course', (d: CurriculumDetailDTO) => d.courses.push(d.courses[0])],
    [
      'duplicate placement',
      (d: CurriculumDetailDTO) => d.courses[0].placements.push(d.courses[0].placements[0]),
    ],
    [
      'global course category',
      (d: CurriculumDetailDTO) => Object.assign(d.courses[0], { category: 'REQUIRED' }),
    ],
    [
      'global prior',
      (d: CurriculumDetailDTO) => {
        d.courses[0].ratingPriorMean = 3;
      },
    ],
    [
      'false rating count',
      (d: CurriculumDetailDTO) => {
        d.courses[0].ratingCount = 2;
      },
    ],
    [
      'missing prior',
      (d: CurriculumDetailDTO) => {
        d.ratingPrior = null;
      },
    ],
    [
      'foreign prerequisite',
      (d: CurriculumDetailDTO) =>
        d.prerequisites.push({
          id: otherReferenceId,
          courseId: d.courses[0].id,
          prerequisiteId: otherReferenceId,
          isStrict: false,
          isCorequisite: true,
          mandatory: true,
        }),
    ],
    [
      'optional prerequisite',
      (d: CurriculumDetailDTO) =>
        d.prerequisites.push({
          id: otherReferenceId,
          courseId: d.courses[0].id,
          prerequisiteId: d.courses[0].id,
          isStrict: false,
          isCorequisite: true,
          mandatory: false as unknown as true,
        }),
    ],
    [
      'invalid placement',
      (d: CurriculumDetailDTO) => {
        d.courses[0].placements[0].academicSemester = 4;
      },
    ],
    [
      'invalid source link',
      (d: CurriculumDetailDTO) => {
        d.sourceUrl = 'javascript:alert(1)';
      },
    ],
    [
      'validated degree claim',
      (d: CurriculumDetailDTO) => {
        d.usage = 'VALIDATED' as unknown as 'REFERENCE_ONLY';
      },
    ],
  ])('rejects %s', async (_name, change) => {
    const data = curriculumReference();
    change(data);
    reply(data);
    await expect(getCurriculumReference(referenceId)).rejects.toThrow(/verify/);
  });
});
