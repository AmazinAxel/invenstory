import { describe, expect, test } from 'bun:test';
import { shouldPromptPush, type PushState } from '../src/lib/push.ts';

describe('shouldPromptPush', () => {
  test('asks once when push is available but off', () => {
    expect(shouldPromptPush('off', false)).toBe(true);
  });
  test('stays quiet once handled (accepted, blocked or dismissed)', () => {
    expect(shouldPromptPush('off', true)).toBe(false);
  });
  test('stays quiet when push cannot be asked for or is already on', () => {
    for (const s of ['unsupported', 'needs-install', 'denied', 'on'] as PushState[]) {
      expect(shouldPromptPush(s, false)).toBe(false);
    }
  });
});
