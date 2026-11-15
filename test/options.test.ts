import { describe, expect, test } from 'bun:test';
import { splitOptions } from '../src/lib/agent/options.ts';

describe('splitOptions', () => {
  test('strips a trailing Options line into chips', () => {
    expect(splitOptions('Ready to publish the stock sync?\nOptions: Yes, publish it | Not yet\n')).toEqual({
      body: 'Ready to publish the stock sync?',
      options: ['Yes, publish it', 'Not yet'],
    });
  });

  test('options alone leave an empty body', () => {
    expect(splitOptions('options: Sheets | Shopify | WooCommerce')).toEqual({ body: '', options: ['Sheets', 'Shopify', 'WooCommerce'] });
  });

  test('malformed or misplaced lines stay plain text', () => {
    for (const t of [
      'No options here.',
      'Options: Only one',
      'Options: a | b | c | d | e',
      'Options: a || b',
      `Options: ${'x'.repeat(41)} | b`,
      'Options: Yes | No\nThen more text.',
    ]) expect(splitOptions(t)).toEqual({ body: t, options: [] });
  });
});
