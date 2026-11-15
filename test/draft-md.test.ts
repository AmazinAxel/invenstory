import { describe, expect, test } from 'bun:test';
import { draftUrl, phoneDigits } from '../src/lib/draft.ts';
import { inline, parse } from '../src/lib/md.ts';

describe('draftUrl', () => {
  test('email with subject and body, invalid addresses dropped', () => {
    expect(draftUrl({ channel: 'email', to: 'a@b.co, nope', subject: 'Re: order #5', body: 'Hi & thanks\nBye' })).toBe(
      'mailto:a%40b.co?subject=Re%3A%20order%20%235&body=Hi%20%26%20thanks%0ABye',
    );
    expect(draftUrl({ channel: 'email', body: 'x' })).toBe('mailto:?body=x');
  });
  test('whatsapp strips formatting from numbers', () => {
    expect(draftUrl({ channel: 'whatsapp', to: '+1 (555) 010-2000', body: 'Need 50 mugs' })).toBe('https://wa.me/15550102000?text=Need%2050%20mugs');
    expect(draftUrl({ channel: 'whatsapp', body: 'hi' })).toBe('https://wa.me/?text=hi');
  });
  test('sms uses the cross-platform body form', () => {
    expect(draftUrl({ channel: 'sms', to: '+44 7700 900123', body: 'Order?' })).toBe('sms:+447700900123?&body=Order%3F');
  });
  test('phoneDigits', () => {
    expect(phoneDigits(' +49 (0)30-123 ')).toBe('+49030123');
  });
});

describe('safe markdown', () => {
  test('inline styles and safe links only', () => {
    expect(inline('**bold** and `x` [site](https://a.example) [bad](javascript:alert(1))')).toEqual([
      { t: 'b', c: [{ t: 'text', v: 'bold' }] },
      { t: 'text', v: ' and ' },
      { t: 'code', v: 'x' },
      { t: 'text', v: ' ' },
      { t: 'a', href: 'https://a.example', c: [{ t: 'text', v: 'site' }] },
      { t: 'text', v: ' ' },
      { t: 'text', v: 'bad' },
      { t: 'text', v: ')' },
    ]);
  });
  test('HTML stays text', () => {
    expect(parse('<img src=x onerror=alert(1)>')).toEqual([{ t: 'p', c: [{ t: 'text', v: '<img src=x onerror=alert(1)>' }] }]);
  });
  test('blocks: headings, lists, paragraphs, code', () => {
    const b = parse('# Title\n- one\n- two\n\n1. first\ntext\nmore\n```\ncode\n```');
    expect(b.map((x) => x.t)).toEqual(['h', 'ul', 'ol', 'p', 'pre']);
    expect((b[1] as { items: unknown[] }).items).toHaveLength(2);
    expect(b[3]).toEqual({ t: 'p', c: [{ t: 'text', v: 'text more' }] });
  });
  test('snake_case words are not italicised', () => {
    expect(inline('reorder_point and unit_cost')).toEqual([{ t: 'text', v: 'reorder_point and unit_cost' }]);
  });
});

import { humanType, parseIdeas } from '../src/lib/suggest.ts';
describe('suggestions', () => {
  test('credential type names read naturally', () => {
    expect(humanType('googleSheetsOAuth2Api')).toBe('Google Sheets');
    expect(humanType('shopifyAccessTokenApi')).toBe('Shopify Access Token');
  });
  test('ideas parse from JSON or lists', () => {
    expect(parseIdeas('Here: ["Sync Shopify stock hourly", "Flag low stock items"]')).toEqual(['Sync Shopify stock hourly', 'Flag low stock items']);
    expect(parseIdeas('1. Import sales from Sheets daily\n- Update prices weekly please')).toEqual(['Import sales from Sheets daily', 'Update prices weekly please']);
  });
});
