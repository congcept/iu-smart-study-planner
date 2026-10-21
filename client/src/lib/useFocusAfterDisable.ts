import { useCallback, useEffect, useRef } from 'react';

/**
 * Chromium moves focus to the body when a focused control becomes disabled.
 * Remember focus before activation and restore it after work finishes, unless
 * the user has moved focus elsewhere or the original control was removed.
 */
export function useFocusAfterDisable(disabled: boolean): () => void {
  const target = useRef<HTMLElement | null>(null);
  const wasDisabled = useRef(disabled);
  const rememberFocus = useCallback(() => {
    target.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);

  useEffect(() => {
    const settled = wasDisabled.current && !disabled;
    wasDisabled.current = disabled;
    if (!settled) return;
    const element = target.current;
    target.current = null;
    if (element?.isConnected && document.activeElement === document.body) {
      element.focus({ preventScroll: true });
    }
  }, [disabled]);

  return rememberFocus;
}
