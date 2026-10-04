import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlannedDemandSnapshotDTO, ResourceScopeDTO } from '@iu-study-planner/shared';
import apiClient from '../api';
import { getPlannedDemand } from '../adminResourcesApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const curriculumId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const courseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const secondCourseId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const scope: ResourceScopeDTO = { curriculumId, semester: 'FALL', year: 2026 };
const snapshot: PlannedDemandSnapshotDTO = {
  kind: 'SIMULATION',
  usage: 'REFERENCE_ONLY',
  scope,
  curriculum: { id: curriculumId, code: 'CS', name: 'Computer Science', school: 'CSE' },
  planningBasis: 'CURRENT_PLANNED_SELECTIONS',
  termBasis: 'SCENARIO_ONLY',
  recommendationDemandAvailable: false,
  eligibilityValidated: false,
  offeringValidationAvailable: false,
  resourceRevision: 3,
  cohortStudentCount: 3,
  plannedStudentCount: 2,
  plannedSelectionCount: 3,
  ignoredNonmemberSelectionCount: 1,
  courses: [
    {
      id: courseId,
      code: 'IT001IU',
      name: 'Programming',
      plannedStudentCount: 2,
      supply: null,
      utilization: null,
    },
    {
      id: secondCourseId,
      code: 'MA001IU',
      name: 'Calculus',
      plannedStudentCount: 1,
      supply: null,
      utilization: null,
    },
  ],
};
const firstCourse = snapshot.courses[0];
const alteredFirst = (changes: Record<string, unknown>) => ({
  ...snapshot,
  courses: [{ ...firstCourse, ...changes }, snapshot.courses[1]],
});
const envelope = (data: unknown) => ({ data: { success: true, data } });
beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue(envelope(snapshot));
});

describe('readonly admin planned-demand adapter', () => {
  it('reads only the explicit scenario scope through the admin cookie endpoint', async () => {
    expect(await getPlannedDemand(scope)).toEqual(snapshot);
    expect(get).toHaveBeenCalledExactlyOnceWith('/admin/demand', { params: scope });
    expect(post).not.toHaveBeenCalled();
  });

  it('normalizes scope, curriculum and course UUIDs without fabricating evidence', async () => {
    get.mockResolvedValue(
      envelope({
        ...snapshot,
        scope: { ...scope, curriculumId: curriculumId.toUpperCase() },
        curriculum: { ...snapshot.curriculum, id: curriculumId.toUpperCase() },
        courses: snapshot.courses.map((course) => ({ ...course, id: course.id.toUpperCase() })),
      }),
    );
    expect(await getPlannedDemand({ ...scope, curriculumId: curriculumId.toUpperCase() })).toEqual(
      snapshot,
    );
    expect(get).toHaveBeenCalledExactlyOnceWith('/admin/demand', { params: scope });
  });

  it('preserves absent resource revision and unknown capacity/utilization', async () => {
    const absent = { ...snapshot, resourceRevision: null };
    get.mockResolvedValue(envelope(absent));
    expect(await getPlannedDemand(scope)).toEqual(absent);
    expect(
      absent.courses.every((course) => course.supply === null && course.utilization === null),
    ).toBe(true);
  });

  it('accepts a zero-demand current-member course without substituting recommendations', async () => {
    const zero = {
      ...snapshot,
      cohortStudentCount: 0,
      plannedStudentCount: 0,
      plannedSelectionCount: 0,
      ignoredNonmemberSelectionCount: 0,
      courses: snapshot.courses.map((course) => ({ ...course, plannedStudentCount: 0 })),
    };
    get.mockResolvedValue(envelope(zero));
    expect(await getPlannedDemand(scope)).toEqual(zero);
  });

  it('accepts an empty reference with assigned students and no current-member selections', async () => {
    const empty = { ...snapshot, courses: [], plannedStudentCount: 0, plannedSelectionCount: 0 };
    get.mockResolvedValue(envelope(empty));
    expect(await getPlannedDemand(scope)).toEqual(empty);
  });

  it('does not equate distinct planned students with the summed course demand', async () => {
    expect((await getPlannedDemand(scope)).plannedStudentCount).toBe(2);
    expect(snapshot.plannedSelectionCount).toBe(3);
  });

  it('allows disjoint course selections to have three distinct students', async () => {
    const disjoint = { ...snapshot, plannedStudentCount: 3, resourceRevision: 2147483647 };
    get.mockResolvedValue(envelope(disjoint));
    expect(await getPlannedDemand(scope)).toEqual(disjoint);
  });

  it.each([
    { curriculumId: 'CS' },
    { curriculumId: null },
    { semester: 'WINTER' },
    { year: '2026' },
    { year: 2026.5 },
    { year: 1999 },
    { year: 2101 },
    { userId: otherId },
    { role: 'ADMIN' },
    { courseIds: [courseId] },
  ])('rejects invalid or expanded scope %j before HTTP', async (changes) => {
    await expect(
      getPlannedDemand({ ...scope, ...changes } as unknown as ResourceScopeDTO),
    ).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    {
      ...snapshot,
      scope: { ...scope, curriculumId: otherId },
      curriculum: { ...snapshot.curriculum, id: otherId },
    },
    { ...snapshot, scope: { ...scope, semester: 'SPRING' } },
    { ...snapshot, scope: { ...scope, year: 2027 } },
    { ...snapshot, curriculum: { ...snapshot.curriculum, id: otherId } },
    { ...snapshot, scope: { ...scope, userId: otherId } },
  ])('rejects a response from a different or expanded scope %j', async (data) => {
    get.mockResolvedValue(envelope(data));
    await expect(getPlannedDemand(scope)).rejects.toThrow();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it.each([
    { kind: 'OFFICIAL' },
    { usage: 'DEGREE_VALIDATED' },
    { planningBasis: 'RECOMMENDATIONS' },
    { termBasis: 'VALIDATED_OFFERINGS' },
    { recommendationDemandAvailable: true },
    { eligibilityValidated: true },
    { offeringValidationAvailable: true },
  ])('rejects fabricated recommendation, eligibility or offering claims %j', async (changes) => {
    get.mockResolvedValue(envelope({ ...snapshot, ...changes }));
    await expect(getPlannedDemand(scope)).rejects.toThrow();
  });

  it.each([
    { ...snapshot, students: [{ id: otherId, name: 'Private student' }] },
    { ...snapshot, userId: otherId },
    { ...snapshot, curriculum: { ...snapshot.curriculum, studentCount: 3 } },
    { ...snapshot, curriculum: { ...snapshot.curriculum, name: '' } },
    alteredFirst({ studentIds: [otherId] }),
    alteredFirst({ students: [{ name: 'Private student' }] }),
    alteredFirst({ name: '' }),
    alteredFirst({ id: 'IT001IU' }),
    alteredFirst({ supply: 40 }),
    alteredFirst({ utilization: 0.5 }),
    alteredFirst({ recommendationDemand: 3 }),
  ])('rejects private fields, malformed metadata and fabricated capacity %j', async (data) => {
    get.mockResolvedValue(envelope(data));
    await expect(getPlannedDemand(scope)).rejects.toThrow();
  });

  it.each([
    { ...snapshot, resourceRevision: 0 },
    { ...snapshot, resourceRevision: 2147483648 },
    { ...snapshot, resourceRevision: 1.5 },
    { ...snapshot, cohortStudentCount: -1 },
    { ...snapshot, plannedStudentCount: 4 },
    { ...snapshot, plannedStudentCount: 0 },
    { ...snapshot, plannedSelectionCount: 2 },
    { ...snapshot, ignoredNonmemberSelectionCount: -1 },
    { ...snapshot, ignoredNonmemberSelectionCount: 1.5 },
    {
      ...snapshot,
      cohortStudentCount: 0,
      plannedStudentCount: 0,
      plannedSelectionCount: 0,
      courses: [],
    },
    { ...snapshot, courses: [{ ...firstCourse, plannedStudentCount: 3 }] },
    {
      ...snapshot,
      courses: [
        { ...firstCourse, plannedStudentCount: -1 },
        { ...snapshot.courses[1], plannedStudentCount: 4 },
      ],
    },
    {
      ...snapshot,
      courses: [
        { ...firstCourse, plannedStudentCount: 1.5 },
        { ...snapshot.courses[1], plannedStudentCount: 1.5 },
      ],
    },
    {
      ...snapshot,
      courses: [
        { ...firstCourse, plannedStudentCount: 2 },
        { ...firstCourse, plannedStudentCount: 1 },
      ],
    },
    {
      ...snapshot,
      courses: [
        { ...firstCourse, plannedStudentCount: 2 },
        { ...snapshot.courses[1], code: firstCourse.code },
      ],
    },
    {
      ...snapshot,
      courses: [
        { ...firstCourse, id: courseId.toUpperCase(), plannedStudentCount: 2 },
        { ...firstCourse, plannedStudentCount: 1 },
      ],
    },
  ])('rejects invalid revisions, duplicate courses or contradictory counts %j', async (data) => {
    get.mockResolvedValue(envelope(data));
    await expect(getPlannedDemand(scope)).rejects.toThrow();
  });

  it.each([
    null,
    {},
    { success: false, data: snapshot },
    { success: true },
    { success: 'true', data: snapshot },
    { success: true, data: null },
  ])('rejects missing or unsuccessful envelopes %j', async (data) => {
    get.mockResolvedValue({ data });
    await expect(getPlannedDemand(scope)).rejects.toThrow();
  });

  it('propagates denied access or transport failures without pretending demand is empty', async () => {
    const denied = { response: { status: 403 } };
    get.mockRejectedValueOnce(denied);
    await expect(getPlannedDemand(scope)).rejects.toBe(denied);
    expect(get).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });
});
