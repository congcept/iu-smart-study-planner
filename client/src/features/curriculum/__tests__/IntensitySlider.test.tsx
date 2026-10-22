import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntensitySlider } from '../IntensitySlider';

afterEach(cleanup);

describe('course load options', () => {
  it('names every option with the load it suggests', () => {
    render(<IntensitySlider mode="normal" onChange={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Low: Suggest up to 9 credits per semester' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Normal: Suggest up to 15 credits per semester' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'High: Suggest up to 18 credits per semester' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Max: Suggest up to 21 credits per semester' }),
    ).toBeInTheDocument();
  });

  it('keeps the visible word at the front of the name', () => {
    render(<IntensitySlider mode="low" onChange={vi.fn()} />);
    const low = screen.getByRole('button', { name: /^Low/ });
    expect(low).toHaveTextContent('Low');
    expect(low).toHaveAccessibleName(/^Low/);
    expect(low).toHaveAttribute('aria-pressed', 'true');
  });
});
