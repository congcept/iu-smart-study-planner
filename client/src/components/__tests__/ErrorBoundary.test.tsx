import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../ErrorBoundary';

function Broken(): never {
  throw new Error('internal database secret');
}

describe('ErrorBoundary', () => {
  it('shows a safe message instead of exception details', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByText('An unexpected error occurred. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText('internal database secret')).not.toBeInTheDocument();
    error.mockRestore();
  });
});
