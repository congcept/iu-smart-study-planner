import axios, { AxiosInstance, AxiosError } from 'axios';
import type {
  ApiResponse,
  CreateCourseDTO,
  CreatePrerequisiteDTO,
  CreateUserDTO,
  UpdateStudentRecordDTO,
  CreateStudyPlanDTO,
  CreateSemesterDTO,
  AnalyzeWorkloadDTO,
} from '@iu-study-planner/shared';
import type {
  Course,
  User,
  StudentRecord,
  StudyPlan,
  Recommendation,
  WorkloadAnalysis,
} from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response) {
      switch (error.response.status) {
        case 401:
          localStorage.removeItem('auth_token');
          console.warn('Unauthorized request. Please authenticate once login flow is available.');
          break;
        case 403:
          console.error('Access forbidden');
          break;
        case 404:
          console.error('Resource not found');
          break;
        case 500:
          console.error('Server error');
          break;
        default:
          console.error('API error:', error.response.data);
      }
    }
    return Promise.reject(error);
  },
);

export default apiClient;

export const healthCheck = async (): Promise<
  ApiResponse<{ status: string; timestamp: string }>
> => {
  const response = await apiClient.get('/health');
  return response.data;
};

export const getCourses = async (): Promise<ApiResponse<Course[]>> => {
  const response = await apiClient.get('/courses');
  return response.data;
};

export const getCourseById = async (id: string): Promise<ApiResponse<Course>> => {
  const response = await apiClient.get(`/courses/${id}`);
  return response.data;
};

export const createCourse = async (courseData: CreateCourseDTO): Promise<ApiResponse<Course>> => {
  const response = await apiClient.post('/courses', courseData);
  return response.data;
};

export const updateCourse = async (
  id: string,
  courseData: Partial<CreateCourseDTO>,
): Promise<ApiResponse<Course>> => {
  const response = await apiClient.put(`/courses/${id}`, courseData);
  return response.data;
};

export const deleteCourse = async (id: string): Promise<ApiResponse<null>> => {
  const response = await apiClient.delete(`/courses/${id}`);
  return response.data;
};

export const addPrerequisite = async (
  prereqData: CreatePrerequisiteDTO,
): Promise<ApiResponse<unknown>> => {
  const response = await apiClient.post('/courses/prerequisites', prereqData);
  return response.data;
};

export const removePrerequisite = async (id: string): Promise<ApiResponse<null>> => {
  const response = await apiClient.delete(`/courses/prerequisites/${id}`);
  return response.data;
};

export const getUsers = async (): Promise<ApiResponse<User[]>> => {
  const response = await apiClient.get('/users');
  return response.data;
};

export const getUserById = async (
  id: string,
): Promise<
  ApiResponse<
    User & {
      studentRecords: StudentRecord[];
      stats: { totalCourses: number; completedCourses: number; totalCredits: number; gpa: number };
    }
  >
> => {
  const response = await apiClient.get(`/users/${id}`);
  return response.data;
};

export const createUser = async (userData: CreateUserDTO): Promise<ApiResponse<User>> => {
  const response = await apiClient.post('/users', userData);
  return response.data;
};

export const addStudentRecord = async (
  userId: string,
  recordData: UpdateStudentRecordDTO,
): Promise<ApiResponse<StudentRecord & { course: Course }>> => {
  const response = await apiClient.post(`/users/${userId}/records`, recordData);
  return response.data;
};

export const getUserProgress = async (
  userId: string,
): Promise<
  ApiResponse<{
    completed: (StudentRecord & { course: Course })[];
    inProgress: (StudentRecord & { course: Course })[];
    planned: (StudentRecord & { course: Course })[];
    available: Course[];
    progress: {
      totalCourses: number;
      completedCourses: number;
      totalCredits: number;
      completedCredits: number;
      percentage: number;
    };
  }>
> => {
  const response = await apiClient.get(`/users/${userId}/progress`);
  return response.data;
};

export const getStudyPlans = async (userId: string): Promise<ApiResponse<StudyPlan[]>> => {
  const response = await apiClient.get(`/study-plans/user/${userId}`);
  return response.data;
};

export const getStudyPlanById = async (id: string): Promise<ApiResponse<StudyPlan>> => {
  const response = await apiClient.get(`/study-plans/${id}`);
  return response.data;
};

export const createStudyPlan = async (
  planData: CreateStudyPlanDTO,
): Promise<ApiResponse<StudyPlan>> => {
  const response = await apiClient.post('/study-plans', planData);
  return response.data;
};

export const addSemesterToPlan = async (
  planId: string,
  semesterData: CreateSemesterDTO,
): Promise<ApiResponse<unknown>> => {
  const response = await apiClient.post(`/study-plans/${planId}/semesters`, semesterData);
  return response.data;
};

export const updateSemester = async (
  planId: string,
  semesterId: string,
  semesterData: Partial<CreateSemesterDTO>,
): Promise<ApiResponse<unknown>> => {
  const response = await apiClient.put(
    `/study-plans/${planId}/semesters/${semesterId}`,
    semesterData,
  );
  return response.data;
};

export const deleteSemester = async (
  planId: string,
  semesterId: string,
): Promise<ApiResponse<null>> => {
  const response = await apiClient.delete(`/study-plans/${planId}/semesters/${semesterId}`);
  return response.data;
};

export const deleteStudyPlan = async (id: string): Promise<ApiResponse<null>> => {
  const response = await apiClient.delete(`/study-plans/${id}`);
  return response.data;
};

export const getRecommendations = async (
  userId: string,
  params?: { maxCredits?: number; maxDifficulty?: number },
): Promise<ApiResponse<Recommendation>> => {
  const response = await apiClient.get(`/recommendations/user/${userId}`, { params });
  return response.data;
};

export const analyzeWorkload = async (
  courseIds: string[],
): Promise<ApiResponse<WorkloadAnalysis>> => {
  const response = await apiClient.post('/recommendations/analyze-workload', {
    courseIds,
  } as AnalyzeWorkloadDTO);
  return response.data;
};

export const getPrerequisiteChain = async (courseId: string): Promise<ApiResponse<unknown>> => {
  const response = await apiClient.get(`/recommendations/prerequisite-chain/${courseId}`);
  return response.data;
};
