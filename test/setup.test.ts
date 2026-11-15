import { describe, expect, test } from 'bun:test';
import { setupComplete } from '../src/lib/setup.ts';
import { NAME_PREFIX } from '../src/lib/agent/tools.ts';

const flow = (name: string, active: boolean) => ({ id: name, name, active });

describe('setupComplete', () => {
  test('needs data and an active Invenstory automation', () => {
    expect(setupComplete(3, 0, [flow(`${NAME_PREFIX}Sheets sync`, true)])).toBe(true);
    expect(setupComplete(0, 5, [flow(`${NAME_PREFIX}Shopify sales`, true)])).toBe(true);
  });
  test('no data keeps setup open', () => {
    expect(setupComplete(0, 0, [flow(`${NAME_PREFIX}Sheets sync`, true)])).toBe(false);
  });
  test('drafts and core or foreign workflows do not count', () => {
    expect(setupComplete(3, 0, [flow(`${NAME_PREFIX}Sheets sync`, false)])).toBe(false);
    expect(setupComplete(3, 0, [flow('invenstory-api', true), flow('Other', true)])).toBe(false);
  });
});
