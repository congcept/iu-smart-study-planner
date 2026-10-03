import { verifyCsReference, type CsReferenceVerification } from './curriculumReference';

export interface BackfillCourseIdentity {
  id: string;
  code: string;
  name: string;
  credits: number;
}

export interface BackfillPrerequisite {
  courseId: string;
  prerequisiteId: string;
  isStrict: boolean;
  isCorequisite: boolean;
}

type PreflightIssue = {
  kind:
    | 'MISSING_COURSE'
    | 'AMBIGUOUS_CATALOG'
    | 'CONFLICTING_NAME'
    | 'CONFLICTING_CREDITS'
    | 'EXTERNAL_PREREQUISITE'
    | 'DUPLICATE_PREREQUISITE';
  code: string;
  prerequisiteId?: string;
};

export interface CsBackfillPreflight {
  compatible: boolean;
  issues: PreflightIssue[];
  preview: null | {
    source: CsReferenceVerification;
    courseIds: { code: string; courseId: string }[];
    prerequisites: BackfillPrerequisite[];
  };
}

/** Match legacy source identities without creating courses or combining prerequisite sets. */
export function inspectCsBackfill(
  input: unknown,
  catalog: readonly BackfillCourseIdentity[],
  prerequisites: readonly BackfillPrerequisite[],
): CsBackfillPreflight {
  const source = verifyCsReference(input);
  const issues: PreflightIssue[] = [];
  const byCode = new Map<string, BackfillCourseIdentity>();
  const byId = new Map<string, BackfillCourseIdentity>();
  for (const course of catalog) {
    if (byCode.has(course.code) || byId.has(course.id)) {
      issues.push({ kind: 'AMBIGUOUS_CATALOG', code: course.code });
    }
    byCode.set(course.code, course);
    byId.set(course.id, course);
  }
  const identities: { code: string; courseId: string }[] = [];
  const sourceIds = new Set<string>();
  for (const course of source.courses) {
    const existing = byCode.get(course.code);
    if (!existing) {
      issues.push({ kind: 'MISSING_COURSE', code: course.code });
      continue;
    }
    if (existing.name !== course.name) issues.push({ kind: 'CONFLICTING_NAME', code: course.code });
    if (existing.credits !== course.credits)
      issues.push({ kind: 'CONFLICTING_CREDITS', code: course.code });
    identities.push({ code: course.code, courseId: existing.id });
    sourceIds.add(existing.id);
  }
  const edges: BackfillPrerequisite[] = [];
  const seenEdges = new Set<string>();
  for (const edge of prerequisites) {
    // Dependencies of another program's courses do not belong to this reference.
    if (!sourceIds.has(edge.courseId)) continue;
    const code = byId.get(edge.courseId)!.code;
    if (!sourceIds.has(edge.prerequisiteId)) {
      issues.push({ kind: 'EXTERNAL_PREREQUISITE', code, prerequisiteId: edge.prerequisiteId });
      continue;
    }
    const key = JSON.stringify([edge.courseId, edge.prerequisiteId]);
    if (seenEdges.has(key))
      issues.push({ kind: 'DUPLICATE_PREREQUISITE', code, prerequisiteId: edge.prerequisiteId });
    seenEdges.add(key);
    // Legacy flags are provenance; the confirmed reader policy makes every edge mandatory.
    edges.push({ ...edge });
  }
  return {
    compatible: issues.length === 0,
    issues,
    preview: issues.length === 0 ? { source, courseIds: identities, prerequisites: edges } : null,
  };
}
