const PRODUCTION_ORIGIN_ERROR = 'Production requires CORS_ORIGIN to be one explicit HTTP(S) origin';

/** Keep local behavior; production must name one browser origin before startup. */
export function readCorsOrigin(env: NodeJS.ProcessEnv): string {
  if (env.NODE_ENV !== 'production') return env.CORS_ORIGIN || 'http://localhost:5173';

  const raw = env.CORS_ORIGIN;
  // Check the original syntax before URL can discard whitespace or normalize paths.
  if (
    !raw ||
    /[\s\\@,*?#]/u.test(raw) ||
    Array.from(raw).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    !/^https?:\/\/[^/]+\/?$/i.test(raw)
  ) {
    throw new Error(PRODUCTION_ORIGIN_ERROR);
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(PRODUCTION_ORIGIN_ERROR);
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    /[*,]/u.test(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(PRODUCTION_ORIGIN_ERROR);
  }
  return parsed.origin;
}
