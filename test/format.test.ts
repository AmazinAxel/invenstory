import { describe, expect, test } from 'bun:test';
import { localCurrency } from '../src/lib/format.ts';

describe('localCurrency', () => {
  test('uses the first language tag that names a region', () => {
    expect(localCurrency(['en', 'en-GB'])).toBe('GBP');
    expect(localCurrency(['de-DE'])).toBe('EUR');
    expect(localCurrency(['ja-JP'])).toBe('JPY');
  });
  test('falls back to the likely region of a bare language', () => {
    expect(localCurrency(['ja'])).toBe('JPY');
    expect(localCurrency(['fr'])).toBe('EUR');
  });
  test('unknown or empty gives USD', () => {
    expect(localCurrency([])).toBe('USD');
    expect(localCurrency(['xx-ZZ'])).toBe('USD');
  });
});
