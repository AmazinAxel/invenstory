// One-tap answers (D19): the assistant ends a message with "Options: A | B". The chat strips that line and shows
// chips. Anything that does not fit stays plain text, so a malformed line never hides content.

export function splitOptions(text: string): { body: string; options: string[] } {
  const lines = text.trimEnd().split('\n');
  const m = /^\s*options:\s*(.+)$/i.exec(lines.at(-1) ?? '');
  const options = m?.[1] ? m[1].split('|').map((o) => o.trim()) : [];
  if (options.length < 2 || options.length > 4 || options.some((o) => !o || o.length > 40)) return { body: text, options: [] };
  return { body: lines.slice(0, -1).join('\n').trimEnd(), options };
}
