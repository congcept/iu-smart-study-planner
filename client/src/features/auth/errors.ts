import { isAxiosError } from 'axios';
import type { ApiResponse } from '@iu-study-planner/shared';

export function authErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError<ApiResponse>(error)) {
    return error.response?.data.error || 'Could not reach the server. Please try again.';
  }
  return error instanceof Error ? error.message : fallback;
}
