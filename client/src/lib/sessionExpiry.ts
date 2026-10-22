type Listener = () => void;

const listeners = new Set<Listener>();
const requestGenerations = new WeakMap<object, number>();
let authenticationGeneration = 0;

/**
 * A rejected sign-in also answers 401, so those requests keep owning their own
 * error copy instead of telling the whole app that the session ended.
 */
export function isAuthRequest(url: string | undefined): boolean {
  if (!url) return false;
  // Anchored: a path that merely contains an auth segment is not one of the
  // requests that owns its own error copy.
  return /^\/auth\/(login|register|logout|me|demo)(?:[/?#]|$)/.test(url);
}

/**
 * Every sign-in, sign-out or session change starts a new generation. A request
 * that was sent before the change cannot describe the session in use now.
 */
export function beginAuthenticationGeneration(): void {
  authenticationGeneration++;
}

/** Remember which session a request was sent under. */
export function bindRequestAuthentication(config: object): void {
  requestGenerations.set(config, authenticationGeneration);
}

/**
 * Whether the request still belongs to the session that is current now. A
 * refusal that belongs to an earlier session says nothing about the session in
 * use, so it must not end it.
 */
export function isRequestAuthenticationCurrent(config: object): boolean {
  const generation = requestGenerations.get(config);
  // A request that never recorded a generation cannot be shown to be stale, so
  // it keeps the plain behaviour of ending the session.
  if (generation === undefined) return true;
  return generation === authenticationGeneration;
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
