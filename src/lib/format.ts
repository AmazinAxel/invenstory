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

const EURO = 'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK'.split(' ');
const REGION_CURRENCY: Record<string, string> = {
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN', GB: 'GBP', CH: 'CHF',
  SE: 'SEK', NO: 'NOK', DK: 'DKK', IS: 'ISK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', TR: 'TRY',
  UA: 'UAH', IL: 'ILS', AE: 'AED', SA: 'SAR', EG: 'EGP', ZA: 'ZAR', NG: 'NGN', KE: 'KES', IN: 'INR', PK: 'PKR',
  BD: 'BDT', LK: 'LKR', CN: 'CNY', HK: 'HKD', TW: 'TWD', JP: 'JPY', KR: 'KRW', SG: 'SGD', MY: 'MYR', TH: 'THB',
  ID: 'IDR', PH: 'PHP', VN: 'VND', AU: 'AUD', NZ: 'NZD',
};

/** Currency for the user's locale region (first language tag with a region, else its likely region); USD fallback. */
export function localCurrency(languages: readonly string[] = navigator.languages ?? [navigator.language]): string {
  try {
    const tag = languages.find((l) => new Intl.Locale(l).region) ?? languages[0];
    const region = tag ? new Intl.Locale(tag).maximize().region : undefined;
    if (!region) return 'USD';
    return EURO.includes(region) ? 'EUR' : REGION_CURRENCY[region] ?? 'USD';
  } catch {
    return 'USD';
  }
}

export const count =(v: number) => nf.format(v);

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
