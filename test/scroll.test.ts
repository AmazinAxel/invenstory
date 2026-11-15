import { describe, expect, test } from 'bun:test';
import { nearBottom, nextPinned } from '../src/lib/scroll.ts';

// Args: pinned, scrollY now, scrollY at the previous scroll event, atBottom (measured late, after any content growth).
describe('nextPinned', () => {
  test('content grew after our own scroll: scrollY unchanged but no longer at bottom, stays pinned', () => {
    expect(nextPinned(true, 754, 754, false)).toBe(true);
  });
  test('our scroll moved down while the page grew: stays pinned', () => {
    expect(nextPinned(true, 838, 754, false)).toBe(true);
  });
  test('reader scrolls up away from the bottom: unpins', () => {
    expect(nextPinned(true, 600, 754, false)).toBe(false);
  });
  test('reader scrolls back to the bottom: re-pins', () => {
    expect(nextPinned(false, 1200, 900, true)).toBe(true);
  });
  test('scrollY dropped but still at the bottom (content shrank, browser clamped): stays pinned', () => {
    expect(nextPinned(true, 700, 754, true)).toBe(true);
  });
  test('unpinned reader scrolling down but not yet at the bottom: stays unpinned', () => {
    expect(nextPinned(false, 900, 800, false)).toBe(false);
  });
  test('sub-pixel upward jitter is not a reader scroll', () => {
    expect(nextPinned(true, 753, 754, false)).toBe(true);
  });
});

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
