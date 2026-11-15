// Minimal, safe markdown: parses to a small tree that Svelte renders as text nodes.
// Never produces HTML strings, so LLM output and n8n data cannot inject markup.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'b'; c: Inline[] }
  | { t: 'i'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'a'; href: string; c: Inline[] };

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'pre'; v: string };

const SAFE_HREF = /^(https?:|mailto:)/i;

export function inline(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^`([^`]+)`/.exec(rest))) {
      flush();
      out.push({ t: 'code', v: m[1]! });
    } else if ((m = /^\*\*(.+?)\*\*/.exec(rest)) || (m = /^__(.+?)__/.exec(rest))) {
      flush();
      out.push({ t: 'b', c: inline(m[1]!) });
    } else if ((m = /^\*([^*\s][^*]*?)\*/.exec(rest)) || (m = /^_([^_\s][^_]*?)_(?![A-Za-z0-9])/.exec(rest))) {
      flush();
      out.push({ t: 'i', c: inline(m[1]!) });
    } else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      flush();
      if (SAFE_HREF.test(m[2]!)) out.push({ t: 'a', href: m[2]!, c: inline(m[1]!) });
      else out.push({ t: 'text', v: m[1]! });
    } else {
      buf += s[i];
      i++;
      continue;
    }
    i += m[0].length;
  }
  flush();
  return out;
}

export function parse(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const endPara = () => {
    if (para.length) blocks.push({ t: 'p', c: inline(para.join(' ')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^```/.test(line)) {
      endPara();
      const code: string[] = [];
      while (++i < lines.length && !/^```/.test(lines[i]!)) code.push(lines[i]!);
      blocks.push({ t: 'pre', v: code.join('\n') });
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      endPara();
      blocks.push({ t: 'h', level: h[1]!.length as 1 | 2 | 3, c: inline(h[2]!) });
      continue;
    }
    const li = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      endPara();
      const kind = /\d/.test(li[1]!) ? 'ol' : 'ul';
      const last = blocks[blocks.length - 1];
      if (last && last.t === kind) last.items.push(inline(li[2]!));
      else blocks.push({ t: kind, items: [inline(li[2]!)] });
      continue;
    }
    if (!line.trim()) endPara();
    else para.push(line.trim());
  }
  endPara();
  return blocks;
}
