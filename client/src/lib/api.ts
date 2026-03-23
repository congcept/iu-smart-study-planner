import axios, { AxiosInstance, AxiosError } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
apiClient.interceptors.request.use(
  (config) => {
    // Add auth token if available
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

// Response interceptor
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response) {
      // Handle specific error codes
      switch (error.response.status) {
        case 401:
          // Unauthorized - redirect to login
          localStorage.removeItem('auth_token');
          window.location.href = '/login';
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

// API helper functions
export const healthCheck = async () => {
  const response = await apiClient.get('/health');
  return response.data;
};

export const getCourses = async () => {
  const response = await apiClient.get('/courses');
  return response.data;
};

export const getCourseById = async (id: string) => {
  const response = await apiClient.get(`/courses/${id}`);
  return response.data;
};

export const createCourse = async (courseData: Record<string, unknown>) => {
  const response = await apiClient.post('/courses', courseData);
  return response.data;
};

export const updateCourse = async (id: string, courseData: Record<string, unknown>) => {
  const response = await apiClient.put(`/courses/${id}`, courseData);
  return response.data;
};

export const deleteCourse = async (id: string) => {
  const response = await apiClient.delete(`/courses/${id}`);
  return response.data;
};

export const addPrerequisite = async (prereqData: Record<string, unknown>) => {
  const response = await apiClient.post('/courses/prerequisites', prereqData);
  return response.data;
};

export const removePrerequisite = async (id: string) => {
  const response = await apiClient.delete(`/courses/prerequisites/${id}`);
  return response.data;
};

export const getUsers = async () => {
  const response = await apiClient.get('/users');
  return response.data;
};

export const getUserById = async (id: string) => {
  const response = await apiClient.get(`/users/${id}`);
  return response.data;
};

export const createUser = async (userData: Record<string, unknown>) => {
  const response = await apiClient.post('/users', userData);
  return response.data;
};

export const addStudentRecord = async (userId: string, recordData: Record<string, unknown>) => {
  const response = await apiClient.post(`/users/${userId}/records`, recordData);
  return response.data;
};

export const getUserProgress = async (userId: string) => {
  const response = await apiClient.get(`/users/${userId}/progress`);
  return response.data;
};

export const getStudyPlans = async (userId: string) => {
  const response = await apiClient.get(`/study-plans/user/${userId}`);
  return response.data;
};

export const getStudyPlanById = async (id: string) => {
  const response = await apiClient.get(`/study-plans/${id}`);
  return response.data;
};

export const createStudyPlan = async (planData: Record<string, unknown>) => {
  const response = await apiClient.post('/study-plans', planData);
  return response.data;
};

export const addSemesterToPlan = async (planId: string, semesterData: Record<string, unknown>) => {
  const response = await apiClient.post(`/study-plans/${planId}/semesters`, semesterData);
  return response.data;
};

export const updateSemester = async (planId: string, semesterId: string, semesterData: Record<string, unknown>) => {
  const response = await apiClient.put(
    `/study-plans/${planId}/semesters/${semesterId}`,
    semesterData,
  );
  return response.data;
};

export const deleteSemester = async (planId: string, semesterId: string) => {
  const response = await apiClient.delete(`/study-plans/${planId}/semesters/${semesterId}`);
  return response.data;
};

export const deleteStudyPlan = async (id: string) => {
  const response = await apiClient.delete(`/study-plans/${id}`);
  return response.data;
};

export const getRecommendations = async (userId: string, params?: Record<string, unknown>) => {
  const response = await apiClient.get(`/recommendations/user/${userId}`, { params });
  return response.data;
};

export const analyzeWorkload = async (courseIds: string[]) => {
  const response = await apiClient.post('/recommendations/analyze-workload', { courseIds });
  return response.data;
};

export const getPrerequisiteChain = async (courseId: string) => {
  const response = await apiClient.get(`/recommendations/prerequisite-chain/${courseId}`);
  return response.data;
};
