/** Display formatting shared by server and client components. */

export function fmtNumber(n: number, maxFrac = 0): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: maxFrac }).format(n);
}

export function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function fmtHours(min: number): string {
  const h = min / 60;
  return h >= 10 ? `${Math.round(h)} h` : `${Math.round(h * 10) / 10} h`;
}

/** "45 min", "6,420 steps", "20 messages" */
export function fmtValue(value: number | null | undefined, unit: string | null | undefined): string {
  if (value == null) return '';
  if (unit === 'min') return fmtMinutes(value);
  return `${fmtNumber(value, 1)}${unit ? ` ${unit}` : ''}`;
}

/** "45", "6,420" — the bare number for "x / y unit" layouts */
export function fmtBare(value: number | null | undefined): string {
  return value == null ? '—' : fmtNumber(value, 1);
}

export function compact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmtNumber(n)} ${n === 1 ? one : many}`;
}
