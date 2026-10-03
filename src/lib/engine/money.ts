import type { ISODate } from './dates';

/**
 * Money is an integer count of the currency's minor unit plus an ISO currency code.
 * Conversion multiplies integers by a rate held as a scaled BigInt (10 decimal places) and
 * rounds half-to-even exactly once — no binary floating point ever touches an amount.
 * If no rate exists, conversion returns null and the UI says "unconverted" instead of guessing.
 */

export interface Money {
  minor: number;
  currency: string;
}

const EXPONENT: Record<string, number> = {
  JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, HUF: 2, BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3,
};

export function exponent(currency: string): number {
  return EXPONENT[currency] ?? 2;
}

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'MKD', 'RSD', 'BGN', 'PLN', 'CZK', 'SEK', 'NOK', 'DKK',
  'HUF', 'RON', 'TRY', 'CAD', 'AUD', 'JPY'] as const;

const SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥', CHF: 'CHF ', MKD: 'ден ' };

/** Parse a user-typed amount ("18", "18.5", "1,234.56", "12,5") into minor units. Null if invalid. */
export function parseAmount(input: string, currency: string): number | null {
  let s = input.trim().replace(/[\s€$£¥]|ден|MKD|EUR|USD/gi, '');
  if (!s) return null;
  // "1.234,56" / "12,5" (decimal comma) vs "1,234.56" (thousands comma)
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const exp = exponent(currency);
  const [int, frac = ''] = s.replace('-', '').split('.');
  if (frac.length > exp && /[1-9]/.test(frac.slice(exp))) return null; // more precision than the currency has
  const minor = Number(int) * 10 ** exp + Number((frac + '0'.repeat(exp)).slice(0, exp) || '0');
  if (!Number.isSafeInteger(minor)) return null;
  return s.startsWith('-') ? -minor : minor;
}

export function toMajor(minor: number, currency: string): number {
  return minor / 10 ** exponent(currency);
}

export interface FormatOptions {
  /** show + for positives */
  signed?: boolean;
  /** drop minor units when they're zero or the amount is large */
  compact?: boolean;
  /** always drop minor units */
  whole?: boolean;
}

export function formatMoney(minor: number, currency: string, opts: FormatOptions = {}): string {
  const exp = exponent(currency);
  const abs = Math.abs(minor);
  const major = abs / 10 ** exp;
  const dropMinor = opts.whole || (opts.compact && (abs % 10 ** exp === 0 || major >= 10_000));
  const digits = dropMinor ? 0 : exp;
  const num = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
    dropMinor ? Math.round(major) : major,
  );
  const sign = minor < 0 ? '−' : opts.signed && minor > 0 ? '+' : '';
  const sym = SYMBOL[currency];
  return sym ? `${sign}${sym}${num}` : `${sign}${num} ${currency}`;
}

// ───────────────────────────────────────────── exact arithmetic

const SCALE = 10_000_000_000n; // rates carry 10 decimal places

/** "61.495" → 614950000000n */
export function parseRate(rate: string | number): bigint {
  const s = typeof rate === 'number' ? rate.toFixed(10) : rate.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid rate ${rate}`);
  const [int, frac = ''] = s.split('.');
  return BigInt(int) * SCALE + BigInt((frac + '0000000000').slice(0, 10));
}

/** round(n / d) half-to-even, for positive d */
function divRoundHalfEven(n: bigint, d: bigint): bigint {
  const neg = n < 0n;
  const a = neg ? -n : n;
  let q = a / d;
  const r = a % d;
  const twice = r * 2n;
  if (twice > d || (twice === d && q % 2n === 1n)) q += 1n;
  return neg ? -q : q;
}

/** amountMinor (in `from`) × scaled rate (1 from = rate to), with exponent adjustment */
export function applyRate(amountMinor: number, from: string, to: string, scaledRate: bigint, invert = false): number {
  const expDiff = exponent(to) - exponent(from);
  let num = BigInt(amountMinor);
  let den = 1n;
  if (invert) {
    num *= SCALE;
    den *= scaledRate;
  } else {
    num *= scaledRate;
    den *= SCALE;
  }
  if (expDiff > 0) num *= 10n ** BigInt(expDiff);
  if (expDiff < 0) den *= 10n ** BigInt(-expDiff);
  return Number(divRoundHalfEven(num, den));
}

// ───────────────────────────────────────────── rate book

export interface FxRate {
  base: string;
  quote: string;
  rate: string; // decimal string, 1 base = rate quote
  on: ISODate;
  source: string;
}

export interface Conversion {
  minor: number;
  /** the rate used, as "1 EUR = 61.495 MKD", for disclosure */
  via: string | null;
}

/**
 * A rate book answers "what was 1 X in Y on day D": the latest rate on or before D
 * (or the earliest one after D when nothing earlier exists), direct, inverse, or through a pivot.
 */
export class RateBook {
  private pairs = new Map<string, { on: ISODate; rate: bigint; raw: string }[]>();

  constructor(rates: FxRate[], private pivot = 'EUR') {
    for (const r of rates) {
      const key = `${r.base}/${r.quote}`;
      const list = this.pairs.get(key) ?? [];
      list.push({ on: r.on, rate: parseRate(r.rate), raw: r.rate });
      this.pairs.set(key, list);
    }
    for (const list of this.pairs.values()) list.sort((a, b) => (a.on < b.on ? -1 : 1));
  }

  private pick(base: string, quote: string, on: ISODate) {
    const list = this.pairs.get(`${base}/${quote}`);
    if (!list?.length) return null;
    let found = list[0];
    for (const r of list) if (r.on <= on) found = r;
    return found;
  }

  private direct(minor: number, from: string, to: string, on: ISODate): Conversion | null {
    const d = this.pick(from, to, on);
    if (d) return { minor: applyRate(minor, from, to, d.rate), via: `1 ${from} = ${trimRate(d.raw)} ${to}` };
    const inv = this.pick(to, from, on);
    if (inv) return { minor: applyRate(minor, from, to, inv.rate, true), via: `1 ${to} = ${trimRate(inv.raw)} ${from}` };
    return null;
  }

  convert(minor: number, from: string, to: string, on: ISODate): Conversion | null {
    if (from === to) return { minor, via: null };
    const d = this.direct(minor, from, to, on);
    if (d) return d;
    if (from !== this.pivot && to !== this.pivot) {
      const a = this.direct(minor, from, this.pivot, on);
      if (a) {
        const b = this.direct(a.minor, this.pivot, to, on);
        if (b) return { minor: b.minor, via: `${a.via}; ${b.via}` };
      }
    }
    return null;
  }

  /** Rates actually used for a set of currencies, for the "converted at…" footnote. */
  disclose(currencies: Iterable<string>, base: string, on: ISODate): string[] {
    const out: string[] = [];
    for (const c of new Set(currencies)) {
      if (c === base) continue;
      const conv = this.convert(10 ** exponent(c), c, base, on);
      if (conv?.via) out.push(conv.via);
      else out.push(`No ${c}→${base} rate — ${c} amounts shown separately`);
    }
    return out;
  }
}

function trimRate(raw: string): string {
  return raw.includes('.') ? raw.replace(/0+$/, '').replace(/\.$/, '') : raw;
}
