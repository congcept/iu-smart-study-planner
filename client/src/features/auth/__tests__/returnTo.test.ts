import { describe, expect, it } from 'vitest';
import { DEFAULT_SIGNED_IN_PATH, returnPathAfterSignIn } from '../returnTo';

describe('returnPathAfterSignIn', () => {
  it.each(['/curriculum', '/grades', '/ratings', '/planner', '/admin'])(
    'returns the guarded destination %s',
    (path) => {
      expect(returnPathAfterSignIn(path)).toBe(path);
    },
  );

  it('falls back to the default route when no destination was recorded', () => {
    expect(returnPathAfterSignIn(undefined)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(returnPathAfterSignIn(null)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(returnPathAfterSignIn('')).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it('refuses destinations that are not one of the app’s guarded paths', () => {
    expect(returnPathAfterSignIn('https://evil.test/steal')).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(returnPathAfterSignIn('//evil.test')).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(returnPathAfterSignIn('/login')).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(returnPathAfterSignIn('/register')).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(returnPathAfterSignIn('/curriculum/../../admin')).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(returnPathAfterSignIn(42)).toBe(DEFAULT_SIGNED_IN_PATH);
  });
});
