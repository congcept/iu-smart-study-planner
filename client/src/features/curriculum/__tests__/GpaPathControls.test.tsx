import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GpaPathControls } from '../GpaPathControls';
import { useGpaPath } from '../useGpaPath';

function Controls() {
  return <GpaPathControls policy={useGpaPath()} />;
}

describe('GPA path controls', () => {
  it('exposes the mutually exclusive manual paths as radio choices', () => {
    render(<Controls />);
    expect(screen.getByRole('group')).toHaveAttribute('aria-label', 'Choose a GPA path');
    expect(screen.getByRole('button', { name: /GPA > 70/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /GPA <= 70/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
