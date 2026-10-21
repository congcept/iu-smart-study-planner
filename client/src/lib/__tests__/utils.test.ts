import { describe, expect, it } from 'vitest';
import { formatCount, formatCredits } from '@/lib/utils';

describe('formatCount', () => {
  it('uses the singular noun for exactly one', () => {
    expect(formatCount(1, 'selected course', 'selected courses')).toBe('1 selected course');
  });

  it('uses the plural noun for zero and for more than one', () => {
    expect(formatCount(0, 'selected course', 'selected courses')).toBe('0 selected courses');
    expect(formatCount(2, 'selected course', 'selected courses')).toBe('2 selected courses');
  });
});

describe('formatCredits', () => {
  it('keeps one credit singular', () => {
    expect(formatCredits(1)).toBe('1 credit');
    expect(formatCredits(4)).toBe('4 credits');
  });
});
