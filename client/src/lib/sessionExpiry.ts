type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * A rejected sign-in also answers 401, so those requests keep owning their own
 * error copy instead of telling the whole app that the session ended.
 */
export function isAuthRequest(url: string | undefined): boolean {
  if (!url) return false;
  return /\/auth\/(login|register|logout|me|demo)/.test(url);
}

/** Any authenticated read can discover that the session is gone. */
export function notifySessionExpired(): void {
  for (const listener of listeners) listener();
}

export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
