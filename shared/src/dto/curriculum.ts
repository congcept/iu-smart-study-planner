import type {
  AuthUserDTO,
  CourseDifficultyDTO,
  CourseStatus,
  GpaPath,
  RecommendationStatsDTO,
  Semester,
  StudentGradesDTO,
} from './index';

export interface CurriculumSummaryDTO {
  id: string;
  code: string;
  name: string;
  school: string;
  degree: string;
  programUrl: string;
  totalCredits: number | null;
  isGpaPath: boolean;
  sourceLabel: string | null;
  sourceUrl: string | null;
  usage: 'REFERENCE_ONLY';
}

export type CurriculumPriorSource = 'CURRICULUM_RATINGS' | 'CURRICULUM_SEED';
export interface CurriculumPlacementDTO {
  id: string;
  academicYear: number | null;
  academicSemester: number | null;
  electiveGroup: string | null;
  electiveSelectCount: number | null;
  sourceOrder: number;
  sourceLabel: string | null;
}

export interface CurriculumCourseDTO extends Omit<CourseDifficultyDTO, 'ratingPriorSource'> {
  id: string;
  code: string;
  name: string;
  credits: number;
  difficultyLevel: number;
  description: string | null;
  semesterOffered: Semester[];
  ratingPriorSource: CurriculumPriorSource;
  placements: CurriculumPlacementDTO[];
}

export interface CurriculumDetailDTO extends CurriculumSummaryDTO {
  courses: CurriculumCourseDTO[];
  requirements: {
    id: string;
    kind: 'FREE_ELECTIVE';
    name: string;
    credits: number;
    academicYear: number | null;
    academicSemester: number | null;
    sourceOrder: number;
    sourceLabel: string | null;
  }[];
  prerequisites: {
    id: string;
    courseId: string;
    prerequisiteId: string;
    isStrict: boolean;
    isCorequisite: boolean;
    mandatory: true;
  }[];
  ratingPrior: { mean: number; source: CurriculumPriorSource } | null;
}

export interface CurriculumRecommendationsDTO {
  courses: CurriculumCourseDTO[];
  stats: RecommendationStatsDTO;
  scope: {
    curriculumId: string;
    usage: 'REFERENCE_ONLY';
    categoryPersonalizationAvailable: false;
    ratingPrior: CurriculumDetailDTO['ratingPrior'];
  };
}

export interface ContextStudentRecordDTO {
  id: string;
  userId: string;
  courseId: string;
  status: CourseStatus;
  grade: string | null;
  gradePoints: number | null;
  electiveGroup: string | null;
  semester: string | null;
  year: number | null;
  createdAt: string;
  updatedAt: string;
  course: CurriculumCourseDTO;
}

export interface ContextStudentProgressDTO {
  completed: ContextStudentRecordDTO[];
  inProgress: ContextStudentRecordDTO[];
  planned: ContextStudentRecordDTO[];
  historicalRecords: (Omit<ContextStudentRecordDTO, 'course'> & {
    course: Pick<CurriculumCourseDTO, 'id' | 'code' | 'name' | 'credits'>;
  })[];
  available: CurriculumCourseDTO[];
  progress: {
    totalCourses: number;
    completedCourses: number;
    totalCredits: number | null;
    completedCredits: number;
    percentage: null;
  };
  scope: {
    curriculumId: string;
    usage: 'REFERENCE_ONLY';
    degreeProgressAvailable: false;
    gpaPath: GpaPath | null;
    ratingPrior: CurriculumDetailDTO['ratingPrior'];
  };
}

export interface ContextAccountScopeDTO {
  curriculumId: string;
  usage: 'REFERENCE_ONLY';
  ratingPrior: CurriculumDetailDTO['ratingPrior'];
}

export interface ContextStudentRecordsDTO {
  records: ContextStudentRecordDTO[];
  historicalRecords: ContextStudentProgressDTO['historicalRecords'];
  scope: ContextAccountScopeDTO;
}

/** Existing saved JSON remains historical data, not a validated contextual schedule. */
export interface CachedStudyPlanDTO {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  semesters: {
    id: string;
    studyPlanId: string;
    semester: Semester;
    year: number;
    courses: unknown;
    totalCredits: number;
    difficultyScore: number | null;
    createdAt: string;
    updatedAt: string;
  }[];
}

export interface ContextStudentProfileDTO extends AuthUserDTO {
  major: string | null;
  enrollmentYear: number | null;
  targetGraduationYear: number | null;
  createdAt: string;
  updatedAt: string;
  studentRecords: ContextStudentRecordDTO[];
  historicalRecords: ContextStudentProgressDTO['historicalRecords'];
  studyPlans: CachedStudyPlanDTO[];
  stats: StudentGradesDTO['summary'] & {
    totalCourses: number;
    completedCourses: number;
    totalCredits: number;
  };
  scope: ContextAccountScopeDTO & { studyPlansValidated: false };
}

export type SemesterPreviewUnscheduledReason =
  | 'UNPLACED'
  | 'GPA_EXCLUDED'
  | 'COURSE_EXCEEDS_CREDIT_CAP'
  | 'REFERENCE_SLOT_LIMIT'
  | 'PREREQUISITE_CYCLE'
  | 'UNMET_PREREQUISITE'
  | 'NO_REMAINING_PLACEMENT';

export interface CurriculumSemesterPreviewDTO {
  scope: {
    curriculumId: string;
    usage: 'REFERENCE_ONLY';
    planningBasis: 'SELECTED_COURSES';
    ratingPrior: CurriculumDetailDTO['ratingPrior'];
    electiveRequirementsValidated: false;
    offeringValidationAvailable: false;
    calendarDatesAvailable: false;
  };
  gpaPath: GpaPath | null;
  slots: {
    academicYear: number;
    academicSemester: number;
    courseIds: string[];
    totalCredits: number;
    averageDifficulty: number;
  }[];
  courses: CurriculumCourseDTO[];
  ignoredPlannedIds: string[];
  unscheduled: { courseId: string; reason: SemesterPreviewUnscheduledReason }[];
  stats: {
    selectedCourseCount: number;
    scheduledCourseCount: number;
    unscheduledCourseCount: number;
    selectedCredits: number;
    scheduledCredits: number;
    semestersToCompletion: null;
    totalRemainingCredits: null;
    estimatedGraduation: null;
  };
  requirements: CurriculumDetailDTO['requirements'];
}
