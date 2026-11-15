// Builds the link that opens a prefilled message in the user's own mail / WhatsApp / SMS app.
// Invenstory never sends messages itself.

export type Channel = 'email' | 'whatsapp' | 'sms';

export interface Draft {
  channel: Channel;
  to?: string | null;
  subject?: string | null;
  body?: string | null;
}

const enc = encodeURIComponent;

/** Keeps a leading + and digits only. */
export function phoneDigits(s: string): string {
  const t = s.trim();
  return (t.startsWith('+') ? '+' : '') + t.replace(/\D/g, '');
}

export function draftUrl(d: Draft): string {
  const to = (d.to ?? '').trim();
  const body = d.body ?? '';
  if (d.channel === 'email') {
    const q: string[] = [];
    if (d.subject) q.push(`subject=${enc(d.subject)}`);
    if (body) q.push(`body=${enc(body)}`);
    const addr = to
      .split(/[,;\s]+/)
      .filter((a) => /^[^@\s]+@[^@\s]+$/.test(a))
      .map(enc)
      .join(',');
    return `mailto:${addr}${q.length ? '?' + q.join('&') : ''}`;
  }
  if (d.channel === 'whatsapp') {
    const n = phoneDigits(to).replace(/^\+/, '');
    return `https://wa.me/${n}${body ? `?text=${enc(body)}` : ''}`;
  }
  // `?&body=` is understood by both iOS and Android messaging apps.
  return `sms:${phoneDigits(to)}${body ? `?&body=${enc(body)}` : ''}`;
}

export const channelLabel: Record<Channel, string> = { email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS' };
