import type { Prisma } from '@prisma/client';

/**
 * A requirement is satisfied by a member of the student's curriculum or by a course from outside it.
 * Both cases resolve through the student's own records, so the rule is one rule and not four.
 */
export interface PrerequisiteEdge {
  prerequisiteId: string | null;
  externalPrerequisite: string | null;
  prerequisite: { id: string; code: string; name: string } | null;
}

export interface ExternalCourse {
  id: string;
  code: string;
  name: string;
}

export interface UnmetPrerequisite {
  id: string;
  code: string;
  name: string;
}

/** The codes an edge set names that are not members of the curriculum, for a catalogue lookup. */
export function externalPrerequisiteCodes(edges: readonly PrerequisiteEdge[]): string[] {
  return [
    ...new Set(
      edges.flatMap((edge) =>
        edge.prerequisiteId === null && edge.externalPrerequisite !== null
          ? [edge.externalPrerequisite]
          : [],
      ),
    ),
  ];
}

/**
 * Every prerequisite is mandatory. A member edge is met by a completion of that member; an external
 * edge is met by a completion of the course carrying that code, wherever the record came from.
 * An external code with no catalogue entry can never be met, which fails closed rather than open.
 */
export function unmetPrerequisites(
  edges: readonly PrerequisiteEdge[],
  completedCourseIds: ReadonlySet<string>,
  externalByCode: ReadonlyMap<string, ExternalCourse>,
): UnmetPrerequisite[] {
  return edges.flatMap((edge) => {
    if (edge.prerequisiteId !== null)
      return completedCourseIds.has(edge.prerequisiteId) ? [] : [edge.prerequisite!];
    const code = edge.externalPrerequisite!;
    const resolved = externalByCode.get(code);
    if (resolved && completedCourseIds.has(resolved.id)) return [];
    return [resolved ?? { id: code, code, name: code }];
  });
}

/** Resolves the external codes an edge set names against the global catalogue. */
export async function loadExternalCourses(
  tx: Prisma.TransactionClient,
  edges: readonly PrerequisiteEdge[],
): Promise<Map<string, ExternalCourse>> {
  const codes = externalPrerequisiteCodes(edges);
  if (codes.length === 0) return new Map();
  const rows = await tx.course.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true, name: true },
  });
  return new Map(rows.map((row) => [row.code, row]));
}
