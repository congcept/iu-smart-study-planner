import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { proposedSelectionBody } from '@/test/fixtures/proposedReferenceSelection';
import { referenceSelectionScope } from '@/test/fixtures/savedReferenceSelection';
import { ProposedReferenceSelectionCheck } from '../ProposedReferenceSelectionCheck';

vi.mock('@/lib/savedStudyPlanReferenceSelectionApi', () => ({
  previewReferenceSelection: vi.fn(),
}));

describe('proposed selection check heading', () => {
  it('renders the check title at heading level 4', () => {
    render(
      <ProposedReferenceSelectionCheck
        {...referenceSelectionScope}
        input={proposedSelectionBody()}
        courses={[]}
        onInvalidated={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Check proposed courses', level: 4 }),
    ).toBeInTheDocument();
  });
});
