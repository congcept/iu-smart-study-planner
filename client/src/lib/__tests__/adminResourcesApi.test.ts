import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceScopeDTO, UpsertResourcesDTO } from '@iu-study-planner/shared';
import apiClient from '../api';
import { getResources, saveResources } from '../adminResourcesApi';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const curriculumId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const resourceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const otherId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const scope: ResourceScopeDTO = { curriculumId, semester: 'FALL', year: 2026 };
const counts = { professors: 1, classrooms: 2, labRooms: 0, maxStudentsPerSection: 40 };
const courseOverrides = { MA001IU: { capacity: 0, professorCount: 0 } };
const input: UpsertResourcesDTO = { ...scope, ...counts, courseOverrides, expectedRevision: 0 };
const resource = {
  ...scope,
  ...counts,
  courseOverrides,
  id: resourceId,
  revision: 1,
  updatedBy: actorId,
  createdAt: '2026-10-04T00:00:00.000Z',
  updatedAt: '2026-10-04T00:00:00.000Z',
};
const snapshot = {
  kind: 'SIMULATION',
  curriculum: { id: curriculumId, code: 'CS', name: 'Computer Science', school: 'CSE' },
  semester: 'FALL',
  year: 2026,
  resource,
};
beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ data: { success: true, data: snapshot } });
  post.mockResolvedValue({ data: { success: true, data: snapshot } });
});

describe('admin resources adapter', () => {
  it('reads the explicitly selected simulation scope through the admin cookie endpoint', async () => {
    expect(await getResources(scope)).toEqual(snapshot);
    expect(get).toHaveBeenCalledExactlyOnceWith('/admin/resources', { params: scope });
  });

  it('normalizes the requested and returned UUIDs without changing resource evidence', async () => {
    get.mockResolvedValue({
      data: {
        success: true,
        data: {
          ...snapshot,
          curriculum: { ...snapshot.curriculum, id: curriculumId.toUpperCase() },
          resource: {
            ...resource,
            id: resourceId.toUpperCase(),
            curriculumId: curriculumId.toUpperCase(),
            updatedBy: actorId.toUpperCase(),
          },
        },
      },
    });
    expect(await getResources({ ...scope, curriculumId: curriculumId.toUpperCase() })).toEqual(
      snapshot,
    );
    expect(get).toHaveBeenCalledExactlyOnceWith('/admin/resources', { params: scope });
  });

  it('keeps a confirmed absent resource null without fabricating capacity or a revision', async () => {
    const absent = { ...snapshot, resource: null };
    get.mockResolvedValue({ data: { success: true, data: absent } });
    expect(await getResources(scope)).toEqual(absent);
  });

  it('accepts a historical row whose actor is explicitly unknown on reads', async () => {
    const historical = { ...snapshot, resource: { ...resource, updatedBy: null } };
    get.mockResolvedValue({ data: { success: true, data: historical } });
    expect(await getResources(scope)).toEqual(historical);
  });

  it('saves a strict normalized input once and requires the next revision with an identified actor', async () => {
    expect(await saveResources({ ...input, curriculumId: curriculumId.toUpperCase() })).toEqual(
      snapshot,
    );
    expect(post).toHaveBeenCalledExactlyOnceWith('/admin/resources', input);
  });

  it('accepts a successful update only at the requested next revision', async () => {
    const updated = { ...snapshot, resource: { ...resource, revision: 9 } };
    post.mockResolvedValue({ data: { success: true, data: updated } });
    expect(await saveResources({ ...input, expectedRevision: 8 })).toEqual(updated);
  });

  it('preserves zero and upper-bound simulation counts and optional override fields', async () => {
    const boundary = {
      ...input,
      professors: 0,
      classrooms: 100000,
      labRooms: 100000,
      maxStudentsPerSection: 100000,
      courseOverrides: { MA001IU: { capacity: 100000 }, IT001IU: { professorCount: 0 } },
    };
    const saved = {
      ...snapshot,
      resource: {
        ...resource,
        professors: boundary.professors,
        classrooms: boundary.classrooms,
        labRooms: boundary.labRooms,
        maxStudentsPerSection: boundary.maxStudentsPerSection,
        courseOverrides: boundary.courseOverrides,
      },
    };
    post.mockResolvedValue({ data: { success: true, data: saved } });
    await saveResources(boundary);
    expect(post).toHaveBeenCalledExactlyOnceWith('/admin/resources', boundary);
  });

  it.each([
    { curriculumId: 'CS' },
    { semester: 'WINTER' },
    { year: 1999 },
    { year: 2101 },
    { year: 2026.5 },
    { role: 'ADMIN' },
  ])('rejects invalid or expanded read scope %j before HTTP', async (override) => {
    await expect(getResources({ ...scope, ...override } as ResourceScopeDTO)).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    { professors: -1 },
    { professors: 100001 },
    { professors: 1.5 },
    { classrooms: -1 },
    { labRooms: 100001 },
    { maxStudentsPerSection: 0 },
    { maxStudentsPerSection: 100001 },
    { expectedRevision: -1 },
    { expectedRevision: 2147483648 },
    { expectedRevision: 1.5 },
    { expectedRevision: undefined },
    { updatedBy: actorId },
    { revision: 1 },
  ])('rejects invalid counts, revision or actor assignment %j before writing', async (override) => {
    await expect(saveResources({ ...input, ...override } as UpsertResourcesDTO)).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    { MA001IU: {} },
    { MA001IU: { capacity: -1 } },
    { MA001IU: { capacity: 100001 } },
    { MA001IU: { professorCount: 1.5 } },
    { MA001IU: { professorCount: 100001 } },
    { MA001IU: { capacity: 3, demand: 10 } },
    { '': { capacity: 1 } },
    { ' MA001IU': { capacity: 1 } },
    { 'MA001IU ': { capacity: 1 } },
    { ['A'.repeat(101)]: { capacity: 1 } },
    JSON.parse('{"__proto__":{"capacity":1}}') as Record<string, unknown>,
    { constructor: { capacity: 1 } },
    { prototype: { capacity: 1 } },
    Object.fromEntries(
      Array.from({ length: 501 }, (_, index) => [`COURSE${index}`, { capacity: 1 }]),
    ),
  ])(
    'rejects malformed, excessive or unsafe override entries %j before writing',
    async (overrides) => {
      await expect(
        saveResources({ ...input, courseOverrides: overrides } as UpsertResourcesDTO),
      ).rejects.toThrow();
      expect(post).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    { ...snapshot, kind: 'REAL_ENROLLMENT' },
    { ...snapshot, curriculum: { ...snapshot.curriculum, id: otherId } },
    { ...snapshot, semester: 'SPRING' },
    { ...snapshot, year: 2027 },
    { ...snapshot, curriculum: { ...snapshot.curriculum, school: '' } },
    { ...snapshot, curriculum: { ...snapshot.curriculum, degree: 'Bachelor' } },
    { ...snapshot, expectedRevision: 0 },
    { ...snapshot, resource: { ...resource, curriculumId: otherId } },
    { ...snapshot, resource: { ...resource, semester: 'SUMMER' } },
    { ...snapshot, resource: { ...resource, year: 2027 } },
    { ...snapshot, resource: { ...resource, revision: 0 } },
    { ...snapshot, resource: { ...resource, revision: 2147483648 } },
    { ...snapshot, resource: { ...resource, updatedAt: 'yesterday' } },
    { ...snapshot, resource: { ...resource, id: 'invalid' } },
    { ...snapshot, resource: { ...resource, updatedBy: 'student-id' } },
    { ...snapshot, resource: { ...resource, demand: 100 } },
  ])('rejects malformed, nonsimulation or mismatched read snapshots %j', async (data) => {
    get.mockResolvedValue({ data: { success: true, data } });
    await expect(getResources(scope)).rejects.toThrow();
  });

  it.each([
    { ...snapshot, resource: null },
    { ...snapshot, resource: { ...resource, revision: 2 } },
    { ...snapshot, resource: { ...resource, updatedBy: null } },
    { ...snapshot, curriculum: { ...snapshot.curriculum, id: otherId }, resource: null },
  ])(
    'does not confirm a POST from absent, wrong-revision, actorless or wrong-scope evidence %j',
    async (data) => {
      post.mockResolvedValue({ data: { success: true, data } });
      await expect(saveResources(input)).rejects.toThrow();
      expect(post).toHaveBeenCalledTimes(1);
    },
  );

  it('propagates read failures without substituting an empty configuration', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    await expect(getResources(scope)).rejects.toThrow('offline');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('propagates a lost write response without automatically retrying', async () => {
    post.mockRejectedValueOnce(new Error('lost response'));
    await expect(saveResources(input)).rejects.toThrow('lost response');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each([{ success: false, data: snapshot }, { success: true }])(
    'rejects unsuccessful or incomplete envelopes %j',
    async (envelope) => {
      get.mockResolvedValue({ data: envelope });
      post.mockResolvedValue({ data: envelope });
      await expect(getResources(scope)).rejects.toThrow();
      await expect(saveResources(input)).rejects.toThrow();
    },
  );
});
