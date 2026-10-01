/** Traverse every reachable dependent, including paths through incomplete courses. */
export function collectCompletedDependents(
  courseId: string,
  dependencyMap: ReadonlyMap<string, readonly string[]>,
  completedRecord: Readonly<Record<string, string | null>>,
): string[] {
  const completedDependents: string[] = [];
  const queue = [courseId];
  // The initiating course is handled separately by the caller, even in a cycle.
  const visited = new Set([courseId]);

  for (let index = 0; index < queue.length; index++) {
    for (const dependentId of dependencyMap.get(queue[index]) ?? []) {
      if (visited.has(dependentId)) continue;
      visited.add(dependentId);
      queue.push(dependentId);
      if (completedRecord[dependentId] !== undefined) {
        completedDependents.push(dependentId);
      }
    }
  }

  return completedDependents;
}
