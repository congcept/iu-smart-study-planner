/**
 * Routes a visitor can be returned to after signing in.
 *
 * Only guarded, in-app destinations belong here. `/login` and `/register` are
 * excluded on purpose: returning to them after a successful sign-in would loop.
 */
const RETURN_PATHS = new Set(['/curriculum', '/grades', '/ratings', '/planner', '/admin']);

export const DEFAULT_SIGNED_IN_PATH = '/curriculum';

/**
 * Resolves the destination a signed-out visitor was sent away from.
 *
 * Anything that is not one of the app's own guarded paths falls back to the
 * default landing route, so a crafted history entry cannot redirect off-site.
 */
export function returnPathAfterSignIn(from: unknown): string {
  return typeof from === 'string' && RETURN_PATHS.has(from) ? from : DEFAULT_SIGNED_IN_PATH;
}
