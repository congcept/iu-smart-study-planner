import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumSemesterPreviewDTO } from '@iu-study-planner/shared';
import apiClient, { getCurriculumSemesterPreview } from '../api';

const curriculumId = '11111111-1111-4111-8111-111111111111';
const courseId = '33333333-3333-4333-8333-333333333333';
const otherId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function preview(): CurriculumSemesterPreviewDTO {
  return {
    scope: {
      curriculumId,
      usage: 'REFERENCE_ONLY',
      planningBasis: 'SELECTED_COURSES',
      ratingPrior: { mean: 2, source: 'CURRICULUM_SEED' },
      electiveRequirementsValidated: false,
      offeringValidationAvailable: false,
      calendarDatesAvailable: false,
    },
    gpaPath: null,
    slots: [
      {
        academicYear: 1,
        academicSemester: 1,
        courseIds: [courseId],
        totalCredits: 3,
        averageDifficulty: 2,
      },
    ],
    courses: [
      {
        id: courseId,
        code: 'MA001IU',
        name: 'Scoped Calculus',
        credits: 3,
        difficultyLevel: 2,
        description: null,
        semesterOffered: ['FALL'],
        avgRating: null,
        ratingCount: 0,
        ratingDifficulty: 2,
        ratingPriorMean: 2,
        ratingPriorSource: 'CURRICULUM_SEED',
        placements: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            academicYear: 1,
            academicSemester: 1,
            electiveGroup: null,
            electiveSelectCount: null,
            sourceOrder: 0,
            sourceLabel: null,
          },
        ],
      },
    ],
    ignoredPlannedIds: [],
    unscheduled: [],
    stats: {
      selectedCourseCount: 1,
      scheduledCourseCount: 1,
      unscheduledCourseCount: 0,
      selectedCredits: 3,
      scheduledCredits: 3,
      semestersToCompletion: null,
      totalRemainingCredits: null,
      estimatedGraduation: null,
    },
    requirements: [],
  };
}
const reply = (data: unknown, success = true) =>
  vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { success, data } });
beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('curriculum semester preview API boundary', () => {
  it('posts only intensity and accepts a consistent reference response', async () => {
    const data = preview();
    const post = reply(data);
    expect(await getCurriculumSemesterPreview('high', curriculumId)).toEqual(data);
    expect(post).toHaveBeenCalledWith('/recommendations/plan-semester', { intensityMode: 'high' });
  });
  it('rejects a response for another curriculum instead of rendering stale context', async () => {
    reply({ ...preview(), scope: { ...preview().scope, curriculumId: otherId } });
    await expect(getCurriculumSemesterPreview('normal', curriculumId)).rejects.toThrow(/verify/);
  });
  it('accepts an empty reference curriculum without inventing totals or a prior', async () => {
    const data = preview();
    data.courses = [];
    data.slots = [];
    data.scope.ratingPrior = null;
    data.stats = {
      ...data.stats,
      selectedCourseCount: 0,
      scheduledCourseCount: 0,
      selectedCredits: 0,
      scheduledCredits: 0,
    };
    reply(data);
    expect(await getCurriculumSemesterPreview('low', curriculumId)).toEqual(data);
  });
  it('retains unscheduled courses and historical selections with their explicit reasons', async () => {
    const data = preview();
    data.slots = [];
    data.unscheduled = [{ courseId, reason: 'UNMET_PREREQUISITE' }];
    data.ignoredPlannedIds = [otherId];
    data.stats = {
      ...data.stats,
      scheduledCourseCount: 0,
      unscheduledCourseCount: 1,
      scheduledCredits: 0,
    };
    reply(data);
    expect(await getCurriculumSemesterPreview('normal', curriculumId)).toEqual(data);
  });
  it.each([
    ['legacy plan', { semesters: [], stats: { estimatedGraduation: '2026' } }],
    ['absent data', undefined],
    ['malformed data', 'invalid'],
    ['unverified context', { ...preview(), scope: { ...preview().scope, curriculumId: 'CS' } }],
    [
      'validated timetable claim',
      { ...preview(), scope: { ...preview().scope, calendarDatesAvailable: true } },
    ],
    [
      'invented graduation',
      { ...preview(), stats: { ...preview().stats, estimatedGraduation: '2026-12' } },
    ],
  ])('rejects %s', async (_label, data) => {
    reply(data);
    await expect(getCurriculumSemesterPreview('normal', curriculumId)).rejects.toThrow(/verify/);
  });
  it.each([
    [
      'foreign scheduled course',
      (data: CurriculumSemesterPreviewDTO) => {
        data.slots[0].courseIds = [otherId];
      },
    ],
    [
      'course scheduled twice',
      (data: CurriculumSemesterPreviewDTO) => {
        data.slots[0].courseIds.push(courseId);
      },
    ],
    [
      'duplicate slot',
      (data: CurriculumSemesterPreviewDTO) => {
        data.slots.push(data.slots[0]);
      },
    ],
    [
      'overlapping unscheduled course',
      (data: CurriculumSemesterPreviewDTO) => {
        data.unscheduled.push({ courseId, reason: 'UNMET_PREREQUISITE' });
      },
    ],
    [
      'missing selected course',
      (data: CurriculumSemesterPreviewDTO) => {
        data.slots = [];
      },
    ],
    [
      'historical member',
      (data: CurriculumSemesterPreviewDTO) => {
        data.ignoredPlannedIds = [courseId];
      },
    ],
    [
      'incorrect credit summary',
      (data: CurriculumSemesterPreviewDTO) => {
        data.stats.selectedCredits = 6;
      },
    ],
    [
      'incorrect selected count',
      (data: CurriculumSemesterPreviewDTO) => {
        data.stats.selectedCourseCount = 2;
      },
    ],
    [
      'incorrect slot credits',
      (data: CurriculumSemesterPreviewDTO) => {
        data.slots[0].totalCredits = 6;
      },
    ],
    [
      'incorrect slot difficulty',
      (data: CurriculumSemesterPreviewDTO) => {
        data.slots[0].averageDifficulty = 4;
      },
    ],
    [
      'missing placement',
      (data: CurriculumSemesterPreviewDTO) => {
        data.courses[0].placements = [];
      },
    ],
    [
      'missing prior',
      (data: CurriculumSemesterPreviewDTO) => {
        data.scope.ratingPrior = null;
      },
    ],
    [
      'global prior fallback',
      (data: CurriculumSemesterPreviewDTO) => {
        data.courses[0].ratingPriorMean = 3;
      },
    ],
    [
      'false rating confidence',
      (data: CurriculumSemesterPreviewDTO) => {
        data.courses[0].ratingCount = 1;
      },
    ],
    [
      'invalid difficulty',
      (data: CurriculumSemesterPreviewDTO) => {
        data.courses[0].ratingDifficulty = Number.NaN;
      },
    ],
  ])('rejects %s', async (_label, change) => {
    const data = preview();
    change(data);
    reply(data);
    await expect(getCurriculumSemesterPreview('normal', curriculumId)).rejects.toThrow(/verify/);
  });
  it('rejects failed envelopes even when a preview is present', async () => {
    reply(preview(), false);
    await expect(getCurriculumSemesterPreview('normal', curriculumId)).rejects.toThrow(/verify/);
  });
  it('preserves transport failures for the dashboard retry state', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('Offline'));
    await expect(getCurriculumSemesterPreview('normal', curriculumId)).rejects.toThrow('Offline');
  });
});
