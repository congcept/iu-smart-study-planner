import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LoadingSpinner } from '../LoadingSpinner';

describe('LoadingSpinner', () => {
  // The spinner is decorative in every call site: it sits next to text (or inside a button
  // whose label already describes the action), so it must not add a stray graphic node to
  // the accessibility tree. The ring variant already declared this; the icon variant did
  // not, which meant the same component exposed itself differently depending on a prop.
  it.each(['icon', 'ring'] as const)(
    'is hidden from assistive technology with the %s variant',
    (variant) => {
      const { container } = render(<LoadingSpinner variant={variant} />);
      const root = container.firstElementChild;
      expect(root).not.toBeNull();
      expect(root).toHaveAttribute('aria-hidden', 'true');
    },
  );
});
