import type {
  CourseDifficultyDTO,
  CourseStatus,
  GpaPath,
  RecommendationStatsDTO,
  Semester,
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
