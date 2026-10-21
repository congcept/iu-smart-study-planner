import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useFocusAfterDisable } from '../useFocusAfterDisable';

type Props = { busyFirst: boolean; busySecond: boolean };

function Pair({ busyFirst, busySecond }: Props) {
  const rememberFirst = useFocusAfterDisable(busyFirst);
  const rememberSecond = useFocusAfterDisable(busySecond);
  return (
    <div>
      <button type="button" disabled={busyFirst} onClick={rememberFirst}>
        First action
      </button>
      <button type="button" disabled={busySecond} onClick={rememberSecond}>
        Second action
      </button>
      <button type="button">Elsewhere</button>
    </div>
  );
}

afterEach(cleanup);

describe('useFocusAfterDisable', () => {
  it('returns focus to the remembered control once it is usable again', () => {
    const { rerender } = render(<Pair busyFirst={false} busySecond={false} />);
    const first = screen.getByRole('button', { name: 'First action' });
    first.focus();
    first.click();
    first.blur();
    act(() => rerender(<Pair busyFirst busySecond={false} />));
    expect(first).toBeDisabled();
    expect(document.activeElement).toBe(document.body);
    act(() => rerender(<Pair busyFirst={false} busySecond={false} />));
    expect(document.activeElement).toBe(first);
  });

  it('leaves focus where the user put it', () => {
    const { rerender } = render(<Pair busyFirst={false} busySecond={false} />);
    const first = screen.getByRole('button', { name: 'First action' });
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    first.focus();
    first.click();
    first.blur();
    act(() => rerender(<Pair busyFirst busySecond={false} />));
    elsewhere.focus();
    act(() => rerender(<Pair busyFirst={false} busySecond={false} />));
    expect(document.activeElement).toBe(elsewhere);
  });

  it('does not pull focus back to an older action that settles last', () => {
    const { rerender } = render(<Pair busyFirst={false} busySecond={false} />);
    const first = screen.getByRole('button', { name: 'First action' });
    const second = screen.getByRole('button', { name: 'Second action' });

    first.focus();
    first.click();
    first.blur();
    act(() => rerender(<Pair busyFirst busySecond={false} />));

    second.focus();
    second.click();
    second.blur();
    act(() => rerender(<Pair busyFirst busySecond />));
    expect(document.activeElement).toBe(document.body);

    act(() => rerender(<Pair busyFirst={false} busySecond />));
    expect(document.activeElement).toBe(document.body);

    act(() => rerender(<Pair busyFirst={false} busySecond={false} />));
    expect(document.activeElement).toBe(second);
  });
});
