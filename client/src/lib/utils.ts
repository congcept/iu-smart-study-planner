import type { CourseCategory } from '../types';

export const categoryColors: Record<CourseCategory, string> = {
  REQUIRED: 'bg-blue-500',
  CORE: 'bg-purple-500',
  ELECTIVE: 'bg-green-500',
  MAJOR_ELECTIVE: 'bg-amber-500',
  GENERAL_EDUCATION: 'bg-gray-500',
  FREE_ELECTIVE: 'bg-pink-500',
};

export const categoryLabels: Record<CourseCategory, string> = {
  REQUIRED: 'Required',
  CORE: 'Core',
  ELECTIVE: 'Elective',
  MAJOR_ELECTIVE: 'Major Elective',
  GENERAL_EDUCATION: 'General Education',
  FREE_ELECTIVE: 'Free Elective',
};

export const difficultyColors: Record<number, string> = {
  1: 'text-green-500',
  2: 'text-lime-500',
  3: 'text-yellow-500',
  4: 'text-orange-500',
  5: 'text-red-500',
};

export const difficultyLabels: Record<number, string> = {
  1: 'Very Easy',
  2: 'Easy',
  3: 'Moderate',
  4: 'Difficult',
  5: 'Very Difficult',
};

export const semesterLabels: Record<string, string> = {
  FALL: 'Fall',
  SPRING: 'Spring',
  SUMMER: 'Summer',
};

export const statusColors: Record<string, string> = {
  PLANNED: 'bg-gray-200 text-gray-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  DROPPED: 'bg-orange-100 text-orange-700',
};

export const formatCredits = (credits: number): string => {
  return `${credits} ${credits === 1 ? 'credit' : 'credits'}`;
};

export const formatSemester = (semester: string, year: number): string => {
  return `${semesterLabels[semester] || semester} ${year}`;
};

export const calculateGPA = (records: { gradePoints?: number }[]): number => {
  const validRecords = records.filter((r) => r.gradePoints !== undefined);
  if (validRecords.length === 0) return 0;

  const total = validRecords.reduce((sum, r) => sum + (r.gradePoints || 0), 0);
  return Math.round((total / validRecords.length) * 100) / 100;
};

export const riskLevelColors: Record<string, string> = {
  LOW: 'bg-green-500',
  MEDIUM: 'bg-yellow-500',
  HIGH: 'bg-orange-500',
  CRITICAL: 'bg-red-500',
};

export const riskLevelLabels: Record<string, string> = {
  LOW: 'Low Risk',
  MEDIUM: 'Medium Risk',
  HIGH: 'High Risk',
  CRITICAL: 'Critical Risk',
};
