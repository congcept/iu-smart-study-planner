import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContextStudentProgressDTO } from '@iu-study-planner/shared';
import { contextProgress } from '@/test/fixtures/contextProgress';
import { otherReferenceId, ownerId, referenceId } from '@/test/fixtures/curriculumReference';
import apiClient from '../api';
import { getContextStudentProgress } from '../curriculumApi';
afterEach(() => vi.restoreAllMocks());
const reply = (data: unknown, success = true) =>
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { success, data } });
describe('private contextual progress boundary', () => {
  it('reads the explicit owner route without accepting context overrides', async () => {
    const data = contextProgress(),
      get = reply(data);
    expect(await getContextStudentProgress(ownerId, referenceId)).toEqual(data);
    expect(get).toHaveBeenCalledWith(`/users/${ownerId}/progress`);
  });
  it('accepts an empty context without a degree percentage', async () => {
    const data = contextProgress();
    data.completed = [];
    data.scope.ratingPrior = null;
    data.progress = {
      totalCourses: 0,
      completedCourses: 0,
      totalCredits: null,
      completedCredits: 0,
      percentage: null,
    };
    reply(data);
    expect(await getContextStudentProgress(ownerId, referenceId)).toEqual(data);
  });
  it('excludes physical training from earned credits while retaining its record', async () => {
    const data = contextProgress();
    data.completed[0].course.code = 'PT001IU';
    data.progress.completedCredits = 0;
    reply(data);
    expect((await getContextStudentProgress(ownerId, referenceId)).completed).toHaveLength(1);
  });
  it.each([
    [
      'another owner',
      (d: ContextStudentProgressDTO) => {
        d.scope.userId = otherReferenceId;
      },
    ],
    [
      'another context',
      (d: ContextStudentProgressDTO) => {
        d.scope.curriculumId = otherReferenceId;
      },
    ],
    [
      'foreign record',
      (d: ContextStudentProgressDTO) => {
        d.completed[0].userId = otherReferenceId;
      },
    ],
    [
      'wrong course identity',
      (d: ContextStudentProgressDTO) => {
        d.completed[0].courseId = otherReferenceId;
      },
    ],
    [
      'duplicate course record',
      (d: ContextStudentProgressDTO) => {
        d.completed.push(d.completed[0]);
      },
    ],
    [
      'incorrect bucket',
      (d: ContextStudentProgressDTO) => {
        d.completed[0].status = 'PLANNED';
      },
    ],
    [
      'wrong completed count',
      (d: ContextStudentProgressDTO) => {
        d.progress.completedCourses = 0;
      },
    ],
    [
      'wrong earned credits',
      (d: ContextStudentProgressDTO) => {
        d.progress.completedCredits = 10;
      },
    ],
    [
      'invented percentage',
      (d: ContextStudentProgressDTO) => {
        Object.assign(d.progress, { percentage: 50 });
      },
    ],
    [
      'validated degree claim',
      (d: ContextStudentProgressDTO) => {
        Object.assign(d.scope, { degreeProgressAvailable: true });
      },
    ],
    [
      'missing scope',
      (d: ContextStudentProgressDTO) => {
        Reflect.deleteProperty(d, 'scope');
      },
    ],
    [
      'global prior',
      (d: ContextStudentProgressDTO) => {
        d.completed[0].course.ratingPriorMean = 4;
      },
    ],
    [
      'historical member',
      (d: ContextStudentProgressDTO) => {
        d.historicalRecords.push({ ...d.completed[0], id: otherReferenceId });
      },
    ],
  ])('rejects %s', async (_name, change) => {
    const data = contextProgress();
    change(data);
    reply(data);
    await expect(getContextStudentProgress(ownerId, referenceId)).rejects.toThrow(/verify/);
  });
  it('rejects a legacy response', async () => {
    reply({ completed: [], progress: { percentage: 0 } });
    await expect(getContextStudentProgress(ownerId, referenceId)).rejects.toThrow(/verify/);
  });
  it('rejects failed envelopes', async () => {
    reply(contextProgress(), false);
    await expect(getContextStudentProgress(ownerId, referenceId)).rejects.toThrow(/verify/);
  });
  it('rejects aliases before making requests', async () => {
    const get = reply(contextProgress());
    await expect(getContextStudentProgress('SIM', referenceId)).rejects.toThrow(/verify/);
    expect(get).not.toHaveBeenCalled();
  });
});
