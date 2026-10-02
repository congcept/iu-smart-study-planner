import { isAxiosError } from 'axios';
import type { ApiResponse } from '@iu-study-planner/shared';

export function authErrorMessage(error: unknown, fallback: string) {
  let message: string | undefined;
  if (isAxiosError<ApiResponse>(error)) {
    if (!error.response) {
      return 'Could not connect to the planner. Check your connection and try again.';
    }
    message = error.response.data?.error;
  } else if (error instanceof Error) {
    message = error.message;
  }
  switch (message) {
    case 'Invalid email or password':
      return 'Email or password is incorrect. Check both and try again.';
    case 'Email or student ID is already registered':
      return 'This email or student ID is already registered. Sign in, or check your details.';
    case 'Demo login is unavailable':
      return 'Demo sign-in is unavailable. Use your own account or explore the curriculum without an account.';
    case 'Validation error':
      return 'Check the required fields and try again.';
    default:
      return fallback;
  }
}
