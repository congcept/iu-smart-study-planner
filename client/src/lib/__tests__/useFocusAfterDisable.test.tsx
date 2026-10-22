import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetFocusActivations, useFocusAfterDisable } from '../useFocusAfterDisable';

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

/** A control that its own read replaces: the retry button goes away either way. */
function Vanishing({ busy, phase }: { busy: boolean; phase: 'retry' | 'failed' | 'content' }) {
  const errorRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const remember = useFocusAfterDisable(busy, () => errorRef.current ?? headingRef.current);
  return (
    <div>
      <h2 ref={headingRef} tabIndex={-1}>
        Panel heading
      </h2>
      {phase === 'failed' && (
        <div ref={errorRef} tabIndex={-1} role="alert">
          Failure message
        </div>
      )}
      {phase === 'retry' && (
        <button type="button" disabled={busy} onClick={remember}>
          Retry the read
        </button>
      )}
      {phase === 'content' && <p>The read returned a list</p>}
    </div>
  );
}

beforeEach(() => {
  // Every case starts from the state of a freshly opened page.
  resetFocusActivations();
});

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

  it('moves focus to the failure message when the remembered control is gone', () => {
    const { rerender } = render(<Vanishing busy={false} phase="retry" />);
    const retry = screen.getByRole('button', { name: 'Retry the read' });
    retry.focus();
    retry.click();
    retry.blur();
    act(() => rerender(<Vanishing busy phase="retry" />));
    expect(document.activeElement).toBe(document.body);
    act(() => rerender(<Vanishing busy={false} phase="failed" />));
    expect(document.activeElement).toBe(screen.getByRole('alert'));
  });

  it('falls back to the panel heading when the read returns content instead', () => {
    const { rerender } = render(<Vanishing busy={false} phase="retry" />);
    const retry = screen.getByRole('button', { name: 'Retry the read' });
    retry.focus();
    retry.click();
    retry.blur();
    act(() => rerender(<Vanishing busy phase="retry" />));
    act(() => rerender(<Vanishing busy={false} phase="content" />));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Panel heading' }));
  });

  it('does not take focus when a read finishes on its own', () => {
    const { rerender } = render(<Vanishing busy phase="retry" />);
    expect(document.activeElement).toBe(document.body);
    act(() => rerender(<Vanishing busy={false} phase="failed" />));
    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus to the failure message when a background read removes the control the user was on', () => {
    const { rerender } = render(<Vanishing busy={false} phase="retry" />);
    screen.getByRole('button', { name: 'Retry the read' }).focus();
    act(() => rerender(<Vanishing busy phase="retry" />));
    act(() => rerender(<Vanishing busy={false} phase="failed" />));
    expect(document.activeElement).toBe(screen.getByRole('alert'));
  });
});
