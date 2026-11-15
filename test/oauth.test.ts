import { describe, expect, test } from 'bun:test';
import { normaliseBase } from '../src/lib/n8n/oauth.ts';

describe('normaliseBase', () => {
  test('bare name means an n8n Cloud instance', () => {
    expect(normaliseBase(' acme ')).toBe('https://acme.app.n8n.cloud');
  });
  test('host and full URLs keep their origin', () => {
    expect(normaliseBase('acme.app.n8n.cloud')).toBe('https://acme.app.n8n.cloud');
    expect(normaliseBase('https://n8n.example.com/')).toBe('https://n8n.example.com');
    expect(normaliseBase('https://acme.app.n8n.cloud/mcp-server/http')).toBe('https://acme.app.n8n.cloud');
  });
  test('pasted editor links resolve to the instance', () => {
    expect(normaliseBase('https://acme.app.n8n.cloud/workflow/AbC123')).toBe('https://acme.app.n8n.cloud');
    expect(normaliseBase('https://acme.app.n8n.cloud/home/workflows')).toBe('https://acme.app.n8n.cloud');
    expect(normaliseBase('https://example.com/n8n/workflow/x')).toBe('https://example.com/n8n');
  });
  test('self-hosted sub-path is kept', () => {
    expect(normaliseBase('https://example.com/n8n')).toBe('https://example.com/n8n');
  });
});
