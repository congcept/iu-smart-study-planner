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

describe('ErrorBoundary escape hatch', () => {
  it('offers a reload for errors that retrying cannot clear', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );

    // Try Again re-renders the same subtree, so a deterministic failure just
    // throws again. Without a reload the user has no way to reach the app.
    const reload = screen.getByRole('button', { name: 'Reload the page' });
    expect(reload).toBeEnabled();
    expect(reload).toHaveAttribute('type', 'button');
    error.mockRestore();
  });
});
