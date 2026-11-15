import { describe, expect, test } from 'bun:test';
import { nearBottom } from '../src/lib/scroll.ts';

// Args: scrollY, viewport height, document height. Tolerance defaults are part of the contract.
describe('nearBottom', () => {
  test('exactly at the bottom', () => {
    expect(nearBottom(1200, 800, 2000)).toBe(true);
  });
  test('a few pixels short still counts (sub-pixel and rounding)', () => {
    expect(nearBottom(1195, 800, 2000)).toBe(true);
  });
  test('scrolled up to read earlier messages', () => {
    expect(nearBottom(600, 800, 2000)).toBe(false);
  });
  test('short page that fits the viewport is at the bottom', () => {
    expect(nearBottom(0, 800, 500)).toBe(true);
  });
  test('tolerance is adjustable', () => {
    expect(nearBottom(1100, 800, 2000, 100)).toBe(true);
    expect(nearBottom(1099, 800, 2000, 100)).toBe(false);
  });
});
