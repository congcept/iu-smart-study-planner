import type { CurriculumDetailDTO } from '@iu-study-planner/shared';
import type { Course, CourseCategory, Prerequisite, YearSemesterGroup } from '@/types';

/**
 * Everything the curriculum map needs, derived from a program's own structure instead of the global
 * catalogue.
 *
 * The map was written against a single global list of courses, where each course carried its own
 * year and semester. A program states the same facts as placements, and states them per program, so
 * this is the seam where one becomes the other: same shapes downstream, different source of truth.
 */
export interface ContextualCurriculum {
  groups: YearSemesterGroup[];
  /** Courses in source order, each carrying the placement it was built from. */
  courses: Course[];
  byId: Map<string, Course>;
  /** Requirements the program allocates credits to without naming candidates. */
  unresolved: CurriculumDetailDTO['requirements'];
}

export interface ContextualGroupOptions {
  /**
   * Slots that hold an unnamed requirement get a card of their own, so a student can see that the
   * program expects a course there without the map inventing candidates for it.
   */
  electivesLabel?: string;
}

const categoryFor = (electiveGroup: string | null): CourseCategory =>
  electiveGroup ? 'ELECTIVE' : 'REQUIRED';

/**
 * A slot with no plausible offering. The map only uses this to order columns; nothing reads it as
 * an offering, and the screens state that offerings are unknown.
 */
const NO_OFFERING: Course['semesterOffered'] = [];

export function contextualGroups(
  detail: CurriculumDetailDTO,
  options: ContextualGroupOptions = {},
): ContextualCurriculum {
  const byId = new Map<string, Course>();
  const edges = new Map<string, Prerequisite[]>();

  for (const edge of detail.prerequisites) {
    const id = edge.courseId.toLowerCase();
    edges.set(id, [
      ...(edges.get(id) ?? []),
      {
        id: edge.id,
        courseId: edge.courseId,
        prerequisiteId: edge.prerequisiteId,
        isCorequisite: edge.isCorequisite,
        isStrict: edge.isStrict,
      },
    ]);
  }

  const courses: Course[] = [];
  for (const entry of detail.courses) {
    const key = entry.id.toLowerCase();
    // The first placement is the course's own slot, the way the global catalogue carries one. A
    // second placement is a duplicate listing and does not overwrite it.
    const primary = entry.placements[0];
    const course: Course = {
      id: entry.id,
      code: entry.code,
      name: entry.name,
      credits: entry.credits,
      difficultyLevel: entry.difficultyLevel,
      description: entry.description ?? undefined,
      category: categoryFor(null),
      semesterOffered: NO_OFFERING,
      academicYear: primary?.academicYear ?? undefined,
      academicSemester: primary?.academicSemester ?? undefined,
      electiveGroup: primary?.electiveGroup ?? undefined,
      electiveSelectCount: primary?.electiveSelectCount ?? undefined,
      prerequisites: edges.get(key) ?? [],
      isPrerequisiteFor: [],
      createdAt: '',
      updatedAt: '',
    };
    byId.set(key, course);
    courses.push(course);
  }

  const groups = new Map<string, YearSemesterGroup>();
  const groupFor = (year: number, semester: number) => {
    const key = `${year}:${semester}`;
    let group = groups.get(key);
    if (!group) {
      group = { year, semester, courses: [] };
      groups.set(key, group);
    }
    return group;
  };

  for (const entry of detail.courses) {
    const base = byId.get(entry.id.toLowerCase())!;
    // A course placed twice appears twice, in its own slot and with its own elective group, which is
    // the behaviour the map already has for repeated placements.
    for (const placement of entry.placements) {
      if (placement.academicYear === null || placement.academicSemester === null) continue;
      groupFor(placement.academicYear, placement.academicSemester).courses.push({
        ...base,
        category: categoryFor(placement.electiveGroup),
        academicYear: placement.academicYear,
        academicSemester: placement.academicSemester,
        electiveGroup: placement.electiveGroup ?? undefined,
        electiveSelectCount: placement.electiveSelectCount ?? undefined,
      });
    }
  }

  const unresolved = detail.requirements.map((requirement) => {
    if (requirement.academicYear !== null && requirement.academicSemester !== null) {
      const label = options.electivesLabel ?? 'Elective';
      groupFor(requirement.academicYear, requirement.academicSemester).courses.push({
        id: requirement.id,
        code: '—',
        name: `${label}: ${requirement.name} (${requirement.credits} credits, candidates not listed)`,
        credits: requirement.credits,
        difficultyLevel: 0,
        category: requirement.kind === 'FREE_ELECTIVE' ? 'FREE_ELECTIVE' : 'ELECTIVE',
        semesterOffered: NO_OFFERING,
        academicYear: requirement.academicYear,
        academicSemester: requirement.academicSemester,
        prerequisites: [],
        isPrerequisiteFor: [],
        createdAt: '',
        updatedAt: '',
      });
    }
    return requirement;
  });

  // Link the reverse direction so the map can highlight dependents without a second pass.
  for (const course of byId.values()) {
    for (const edge of course.prerequisites) {
      const parent = byId.get(edge.prerequisiteId.toLowerCase());
      if (parent)
        parent.isPrerequisiteFor = [
          ...parent.isPrerequisiteFor,
          {
            id: edge.id,
            courseId: edge.prerequisiteId,
            prerequisiteId: course.id,
            isCorequisite: edge.isCorequisite,
            isStrict: edge.isStrict,
          },
        ];
    }
  }

  return {
    groups: [...groups.values()].sort((a, b) => a.year - b.year || a.semester - b.semester),
    courses,
    byId,
    unresolved,
  };
}
