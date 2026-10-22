import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { dropFocusToBody } from './dropFocusToBody';

function focusButton() {
  render(<button type="button">Reload</button>);
  const button = screen.getByRole('button', { name: 'Reload' });
  button.focus();
  expect(button).toHaveFocus();
  return button;
}

afterEach(() => {
  cleanup();
  document.body.removeAttribute('tabindex');
});

describe('dropFocusToBody', () => {
  it('moves focus from a control to the body', () => {
    const button = focusButton();
    dropFocusToBody();
    expect(button).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });

  it('leaves the body without a tabindex attribute when it had none', () => {
    expect(document.body.hasAttribute('tabindex')).toBe(false);
    focusButton();
    dropFocusToBody();
    expect(document.body.hasAttribute('tabindex')).toBe(false);
  });

  it('restores an existing tabindex value', () => {
    document.body.setAttribute('tabindex', '0');
    focusButton();
    dropFocusToBody();
    expect(document.body.getAttribute('tabindex')).toBe('0');
  });
});
