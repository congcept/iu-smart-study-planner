import { z } from 'zod';
import {
  UpsertResourcesSchema,
  type ResourcesSnapshotDTO,
  type UpsertResourcesDTO,
} from '@iu-study-planner/shared';

export const ResourceRequestSchema = z
  .object({
    userId: z
      .string()
      .uuid()
      .transform((id) => id.toLowerCase()),
    payload: UpsertResourcesSchema,
  })
  .strict();
export const resourceRequestKey = (userId: string) => `pending_resource_save:${userId}`;

/** JSONB key order is immaterial; revision and actor must prove this exact replacement. */
export function confirmsResourceRequest(
  snapshot: ResourcesSnapshotDTO,
  payload: UpsertResourcesDTO,
  userId: string,
) {
  const row = snapshot.resource;
  if (
    !row ||
    snapshot.curriculum.id !== payload.curriculumId ||
    snapshot.semester !== payload.semester ||
    snapshot.year !== payload.year ||
    row.revision !== payload.expectedRevision + 1 ||
    row.updatedBy !== userId ||
    row.professors !== payload.professors ||
    row.classrooms !== payload.classrooms ||
    row.labRooms !== payload.labRooms ||
    row.maxStudentsPerSection !== payload.maxStudentsPerSection
  )
    return false;
  const codes = Object.keys(payload.courseOverrides);
  return (
    Object.keys(row.courseOverrides).length === codes.length &&
    codes.every((code) => {
      const requested = payload.courseOverrides[code];
      const saved = row.courseOverrides[code];
      return (
        saved &&
        saved.capacity === requested.capacity &&
        saved.professorCount === requested.professorCount
      );
    })
  );
}
