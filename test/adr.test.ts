import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';

// docs/DECISIONS.md is the index of docs/adr/. Keep them in sync: one index line per ADR file, numbered 1..n with
// no gaps, and each file's heading equal to its index title.
test('docs/DECISIONS.md indexes every ADR in docs/adr/', () => {
  const index = readFileSync('docs/DECISIONS.md', 'utf8');
  const entries = [...index.matchAll(/^- \[(D(\d+)\. .+)\]\(adr\/((\d{4})-[a-z0-9-]+\.md)\)$/gm)].map((m) => ({
    title: m[1]!,
    n: Number(m[2]),
    file: m[3]!,
    fileN: Number(m[4]),
  }));
  const files = readdirSync('docs/adr').filter((f) => f.endsWith('.md')).sort();

  expect(entries.map((e) => e.file)).toEqual(files);
  entries.forEach((e, i) => {
    expect(e.n).toBe(i + 1);
    expect(e.fileN).toBe(e.n);
    expect(readFileSync(`docs/adr/${e.file}`, 'utf8').split('\n')[0]).toBe(`# ${e.title}`);
  });
});
