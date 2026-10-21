import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Button } from '../Button';

describe('Button', () => {
  it('renders correctly with default props', () => {
    const { getByRole } = render(<Button>Click me</Button>);
    const button = getByRole('button', { name: /click me/i });
    expect(button).toBeTruthy();
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    const { getByRole } = render(<Button onClick={handleClick}>Click me</Button>);
    const button = getByRole('button', { name: /click me/i });
    button.click();
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when isLoading is true', () => {
    const { getByRole } = render(<Button isLoading>Loading</Button>);
    const button = getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('shows left and right icons', () => {
    const { getByTestId } = render(
      <Button
        leftIcon={<span data-testid="left-icon">L</span>}
        rightIcon={<span data-testid="right-icon">R</span>}
      >
        Click me
      </Button>,
    );
    expect(getByTestId('left-icon')).toBeTruthy();
    expect(getByTestId('right-icon')).toBeTruthy();
  });

  it('defaults to a non-submitting type so it cannot submit a surrounding form', () => {
    // A <button> without an explicit type defaults to "submit", so a plain action button
    // rendered inside a form would silently submit it. This happened in the auth form:
    // clicking "Demo student" also submitted the empty credential form and flashed a
    // spurious validation error. Defaulting the primitive to "button" removes the whole
    // class of bug rather than fixing one call site.
    const { getByRole } = render(<Button>Action</Button>);
    expect((getByRole('button', { name: 'Action' }) as HTMLButtonElement).type).toBe('button');
  });

  it('keeps an explicit submit type for real form submission controls', () => {
    const { getByRole } = render(<Button type="submit">Save</Button>);
    expect((getByRole('button', { name: 'Save' }) as HTMLButtonElement).type).toBe('submit');
  });
});
