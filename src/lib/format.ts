const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function money(v: number, currency: string, compact = false): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : Math.abs(v) >= 1000 ? 0 : 2,
    }).format(v);
  } catch {
    return `${nf.format(v)} ${currency}`;
  }
}

export const count = (v: number) => nf.format(v);

export function shortDate(iso: string): string {
  return new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
  ];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  let pick: [number, Intl.RelativeTimeFormatUnit] = units[0]!;
  for (const u of units) if (s >= u[0]) pick = u;
  return rtf.format(-Math.floor(s / pick[0]), pick[1]);
}
