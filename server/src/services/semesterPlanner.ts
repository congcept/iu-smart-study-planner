import { Course, Prerequisite } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

type CourseWithPrereqs = Course & {
  prerequisites: (Prerequisite & { prerequisite?: Course })[];
  isPrerequisiteFor?: { course: { id: string } }[];
};

interface IntensityConfig {
  maxCreditsPerSemester: number;
  maxSemesters: number;
  preferredMinCredits: number;
}

const INTENSITY_CONFIGS: Record<string, IntensityConfig> = {
  low: { maxCreditsPerSemester: 9, maxSemesters: 18, preferredMinCredits: 6 },
  normal: { maxCreditsPerSemester: 15, maxSemesters: 12, preferredMinCredits: 12 },
  high: { maxCreditsPerSemester: 21, maxSemesters: 10, preferredMinCredits: 15 },
  max: { maxCreditsPerSemester: 24, maxSemesters: 8, preferredMinCredits: 21 },
};

interface SemesterSlot {
  year: number;
  semester: number;
  recommendedCourseIds: string[];
  totalCredits: number;
}

interface PlanResult {
  semesters: SemesterSlot[];
  nextRecommendedIds: string[];
  stats: {
    totalRemainingCredits: number;
    semestersToCompletion: number;
    estimatedGraduationSemester: string;
  };
}

class SemesterPlanner {
  private scrapedSemesters: {
    year: number;
    semester: number;
    courses: { code: string; credits: number }[];
  }[];

  private courseToSlotIndex: Map<string, number>;

  constructor() {
    const scrapedPath = join(__dirname, '../../../scraped-courses.json');
    const raw = JSON.parse(readFileSync(scrapedPath, 'utf8')) as {
      year: number;
      semester: number;
      courses: { id: string; credits: number }[];
    }[];

    this.scrapedSemesters = raw.map((s) => ({
      year: s.year,
      semester: s.semester,
      courses: s.courses.map((c) => ({
        code: c.id,
        credits: c.credits,
      })),
    }));

    this.courseToSlotIndex = new Map();
    this.scrapedSemesters.forEach((sem, idx) => {
      sem.courses.forEach((c) => {
        if (!this.courseToSlotIndex.has(c.code)) {
          this.courseToSlotIndex.set(c.code, idx);
        }
      });
    });
  }

  plan(
    allCourses: CourseWithPrereqs[],
    completedCourseIds: Set<string>,
    intensityMode: string,
  ): PlanResult {
    const config = INTENSITY_CONFIGS[intensityMode] ?? INTENSITY_CONFIGS.normal;

    const remainingCourses = allCourses.filter((c) => !completedCourseIds.has(c.id));
    const totalRemainingCredits = remainingCourses.reduce((sum, c) => sum + c.credits, 0);

    const semesters: SemesterSlot[] = [];
    const plannedIds = new Set<string>();

    for (
      let slotIdx = 0;
      slotIdx < config.maxSemesters &&
      this.hasRemaining(remainingCourses, plannedIds, completedCourseIds);
      slotIdx++
    ) {
      const scrapedSem = this.scrapedSemesters[slotIdx % this.scrapedSemesters.length];
      const yearOffset = Math.floor(slotIdx / this.scrapedSemesters.length);

      const available = remainingCourses.filter(
        (c) => !plannedIds.has(c.id) && this.arePrerequisitesMet(c, completedCourseIds, plannedIds),
      );

      const scored = available.map((course) => {
        let score = 0;
        const intendedIdx = this.courseToSlotIndex.get(course.code) ?? slotIdx;
        const semGap = intendedIdx - slotIdx;

        if (semGap < 0) {
          score += 200;
          score += Math.abs(semGap) * 50;
        } else if (semGap === 0) {
          score += 100;
        } else if (semGap <= 2) {
          score += 10;
        } else {
          score -= semGap * 100;
        }

        if (course.category === 'REQUIRED') score += 100;
        else if (course.category === 'CORE') score += 80;
        else if (course.category === 'MAJOR_ELECTIVE') score += 50;
        else score += 30;

        const unlockCount = course.isPrerequisiteFor?.length ?? 0;
        score += unlockCount * 10;

        return { course, score };
      });

      scored.sort((a, b) => b.score - a.score);

      const semesterCourses: CourseWithPrereqs[] = [];
      let semesterCredits = 0;

      for (const { course } of scored) {
        if (semesterCredits + course.credits > config.maxCreditsPerSemester) continue;

        semesterCourses.push(course);
        semesterCredits += course.credits;
        plannedIds.add(course.id);

        if (semesterCredits >= config.preferredMinCredits) break;
      }

      if (semesterCourses.length > 0) {
        semesters.push({
          year: scrapedSem.year + yearOffset,
          semester: scrapedSem.semester,
          recommendedCourseIds: semesterCourses.map((c) => c.id),
          totalCredits: semesterCredits,
        });
      }
    }

    const nextRecommendedIds = semesters.length > 0 ? semesters[0].recommendedCourseIds : [];
    const semestersToCompletion = semesters.length;

    const monthsToAdvance = semestersToCompletion * 5;
    const gradDate = new Date(Date.now() + monthsToAdvance * 30 * 24 * 60 * 60 * 1000);
    const gradSemester = gradDate.getMonth() < 6 ? 'Spring' : 'Fall';
    const gradYear = gradDate.getFullYear();

    return {
      semesters,
      nextRecommendedIds,
      stats: {
        totalRemainingCredits,
        semestersToCompletion,
        estimatedGraduationSemester: `${gradSemester} ${gradYear}`,
      },
    };
  }

  private arePrerequisitesMet(
    course: CourseWithPrereqs,
    completedIds: Set<string>,
    plannedIds: Set<string>,
  ): boolean {
    // All database relationships are mandatory, including legacy recommended/corequisite rows.
    // Available candidates are computed before the slot is filled, so plannedIds here
    // contains only courses assigned to earlier semesters.
    return course.prerequisites.every(
      (p) => completedIds.has(p.prerequisiteId) || plannedIds.has(p.prerequisiteId),
    );
  }

  private hasRemaining(
    remaining: CourseWithPrereqs[],
    plannedIds: Set<string>,
    completedIds: Set<string>,
  ): boolean {
    const unaccounted = remaining.filter((c) => !plannedIds.has(c.id) && !completedIds.has(c.id));
    return unaccounted.some((c) => this.arePrerequisitesMet(c, completedIds, plannedIds));
  }
}

export default SemesterPlanner;
