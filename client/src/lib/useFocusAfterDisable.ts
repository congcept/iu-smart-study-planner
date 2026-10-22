import { useCallback, useEffect, useRef } from 'react';

/**
 * The most recent activation wins. Without this, a slow read that settles after
 * the user has already started another one would pull focus back to the older
 * control, which is worse than leaving it where the user put it.
 */
let latestActivation = 0;

/**
 * Forget the activations recorded so far. Tests use this so that every case
 * starts from the same state as a freshly opened page.
 */
export function resetFocusActivations(): void {
  latestActivation = 0;
}

/**
 * Chromium moves focus to the body when a focused control becomes disabled, and
 * when the focused control is removed from the page. Remember focus before
 * activation and restore it after work finishes, unless the user has moved
 * focus elsewhere, the original control was removed, or a newer activation has
 * been started since.
 *
 * `fallback` covers the case where the control that started the work is gone
 * and something else now holds that place: focus then goes to what the panel
 * shows instead, usually its error banner or its heading. It is only used when
 * the user really had something focused that the work removed, so a read that
 * finishes on its own never takes focus.
 */
export function useFocusAfterDisable(
  disabled: boolean,
  fallback?: () => HTMLElement | null,
): () => void {
  const target = useRef<HTMLElement | null>(null);
  const activation = useRef(0);
  const wasDisabled = useRef(disabled);
  const fallbackRef = useRef(fallback);
  const lastFocused = useRef<HTMLElement | null>(null);
  fallbackRef.current = fallback;

  const rememberFocus = useCallback(() => {
    target.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    activation.current = ++latestActivation;
  }, []);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      // The body is where the focus lands when a control is disabled or
      // removed. It never says where the user was.
      if (event.target instanceof HTMLElement && event.target !== document.body)
        lastFocused.current = event.target;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  useEffect(() => {
    const settled = wasDisabled.current && !disabled;
    wasDisabled.current = disabled;
    if (!settled) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const element = target.current;
    target.current = null;
    if (element?.isConnected) {
      if (activation.current !== latestActivation) return;
      element.focus({ preventScroll: true });
      return;
    }
    if (activation.current !== 0 && activation.current !== latestActivation) return;
    // Whatever held the focus is gone, so the place it held has to go
    // somewhere. A read that finished on its own never took that place.
    const lost = lastFocused.current ?? element;
    if (!lost || lost.isConnected) return;
    const alternative = fallbackRef.current?.();
    if (alternative?.isConnected) alternative.focus({ preventScroll: true });
  }, [disabled]);

  return rememberFocus;
}
