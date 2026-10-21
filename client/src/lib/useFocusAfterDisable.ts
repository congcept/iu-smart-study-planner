import { useCallback, useEffect, useRef } from 'react';

/**
 * The most recent activation wins. Without this, a slow read that settles after
 * the user has already started another one would pull focus back to the older
 * control, which is worse than leaving it where the user put it.
 */
let latestActivation = 0;

/**
 * Chromium moves focus to the body when a focused control becomes disabled.
 * Remember focus before activation and restore it after work finishes, unless
 * the user has moved focus elsewhere, the original control was removed, or a
 * newer activation has been started since.
 *
 * `fallback` covers triggers that disappear while their read runs, such as a
 * retry button inside an error block or a paging button inside a list that is
 * replaced: focus then goes to whatever the panel now shows, usually its error
 * banner or its heading.
 */
export function useFocusAfterDisable(
  disabled: boolean,
  fallback?: () => HTMLElement | null,
): () => void {
  const target = useRef<HTMLElement | null>(null);
  const activation = useRef(0);
  const wasDisabled = useRef(disabled);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  const rememberFocus = useCallback(() => {
    target.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    activation.current = ++latestActivation;
  }, []);

  useEffect(() => {
    const settled = wasDisabled.current && !disabled;
    wasDisabled.current = disabled;
    if (!settled) return;
    const element = target.current;
    target.current = null;
    if (activation.current !== latestActivation) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    if (element?.isConnected) {
      element.focus({ preventScroll: true });
      return;
    }
    const alternative = fallbackRef.current?.();
    if (alternative?.isConnected) alternative.focus({ preventScroll: true });
  }, [disabled]);

  return rememberFocus;
}
