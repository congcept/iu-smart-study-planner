// Course Types
export interface Course {
  id: string;
  code: string;
  name: string;
  credits: number;
  difficultyLevel: number;
  description?: string;
  category: CourseCategory;
  semesterOffered: Semester[];
  prerequisites: Prerequisite[];
  isPrerequisiteFor: Prerequisite[];
  createdAt: string;
  updatedAt: string;
}

export interface Prerequisite {
  id: string;
  courseId: string;
  prerequisiteId: string;
  isCorequisite: boolean;
  isStrict: boolean;
  prerequisite?: Course;
  course?: Course;
}

export type CourseCategory = 
  | 'REQUIRED' 
  | 'ELECTIVE' 
  | 'CORE' 
  | 'MAJOR_ELECTIVE' 
  | 'GENERAL_EDUCATION' 
  | 'FREE_ELECTIVE';

export type Semester = 'FALL' | 'SPRING' | 'SUMMER';

export type CourseStatus = 
  | 'PLANNED' 
  | 'IN_PROGRESS' 
  | 'COMPLETED' 
  | 'FAILED' 
  | 'DROPPED';

// User Types
export interface User {
  id: string;
  studentId: string;
  name: string;
  email: string;
  major?: string;
  enrollmentYear?: number;
  targetGraduationYear?: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudentRecord {
  id: string;
  userId: string;
  courseId: string;
  grade?: string;
  gradePoints?: number;
  semester?: string;
  year?: number;
  status: CourseStatus;
  course: Course;
  createdAt: string;
  updatedAt: string;
}

// Study Plan Types
export interface StudyPlan {
  id: string;
  userId: string;
  name: string;
  description?: string;
  isActive: boolean;
  semesters: PlannedSemester[];
  createdAt: string;
  updatedAt: string;
}

export interface PlannedSemester {
  id: string;
  studyPlanId: string;
  semester: Semester;
  year: number;
  courses: { courseId: string; position: number }[];
  totalCredits: number;
  difficultyScore?: number;
  createdAt: string;
  updatedAt: string;
}

// Recommendation Types
export interface Recommendation {
  courses: Course[];
  stats: {
    totalAvailable: number;
    filteredCount: number;
    recommendedCount: number;
    totalRecommendedCredits: number;
    averageDifficulty: number;
  };
}

export interface WorkloadAnalysis {
  totalCredits: number;
  averageDifficulty: number;
  workloadScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendations: string[];
}

// Graph Types for React Flow
export interface CourseNodeData {
  course: Course;
  isCompleted: boolean;
  isInProgress: boolean;
  isAvailable: boolean;
  onClick?: (course: Course) => void;
}

export interface GraphEdgeData {
  isCorequisite: boolean;
  isStrict: boolean;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  count?: number;
  details?: any;
}

// Store Types
export interface AppState {
  user: User | null;
  courses: Course[];
  studentRecords: StudentRecord[];
  studyPlans: StudyPlan[];
  activePlan: StudyPlan | null;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  setUser: (user: User | null) => void;
  setCourses: (courses: Course[]) => void;
  setStudentRecords: (records: StudentRecord[]) => void;
  setStudyPlans: (plans: StudyPlan[]) => void;
  setActivePlan: (plan: StudyPlan | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  
  // Computed
  completedCourseIds: () => string[];
  availableCourses: () => Course[];
  progress: () => { total: number; completed: number; percentage: number };
}
