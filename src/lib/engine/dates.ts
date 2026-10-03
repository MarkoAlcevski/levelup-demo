/**
 * Civil-date helpers. A "day" in Kept is a local calendar date string (YYYY-MM-DD) in the
 * user's timezone — never a Date object, which silently carries a UTC instant and drifts
 * across midnight. All arithmetic runs on UTC-noon Dates internally so DST can't bite.
 */

export type ISODate = string;

const DAY_MS = 86_400_000;

function toUTC(d: ISODate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day, 12));
}

function fromUTC(dt: Date): ISODate {
  return dt.toISOString().slice(0, 10);
}

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return fromUTC(toUTC(s)) === s;
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromUTC(new Date(toUTC(d).getTime() + n * DAY_MS));
}

/** b − a in whole days. */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / DAY_MS);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(d: ISODate): number {
  const w = toUTC(d).getUTCDay();
  return w === 0 ? 7 : w;
}

/** JS weekday: 0 = Sunday … 6 = Saturday (matches profiles.week_starts_on). */
export function jsWeekday(d: ISODate): number {
  return toUTC(d).getUTCDay();
}

export function startOfWeek(d: ISODate, weekStartsOn: number): ISODate {
  const offset = (jsWeekday(d) - weekStartsOn + 7) % 7;
  return addDays(d, -offset);
}

export function endOfWeek(d: ISODate, weekStartsOn: number): ISODate {
  return addDays(startOfWeek(d, weekStartsOn), 6);
}

export function startOfMonth(d: ISODate): ISODate {
  return d.slice(0, 8) + '01';
}

export function endOfMonth(d: ISODate): ISODate {
  const dt = toUTC(startOfMonth(d));
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  return addDays(fromUTC(dt), -1);
}

export function addMonths(d: ISODate, n: number): ISODate {
  const [y, m, day] = d.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return fromUTC(target);
}

export function daysInMonth(d: ISODate): number {
  return Number(endOfMonth(d).slice(8, 10));
}

export function startOfQuarter(d: ISODate): ISODate {
  const m = Number(d.slice(5, 7));
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return `${d.slice(0, 4)}-${String(qm).padStart(2, '0')}-01`;
}

export function startOfYear(d: ISODate): ISODate {
  return `${d.slice(0, 4)}-01-01`;
}

/** Inclusive range of days. Empty when end < start. */
export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const n = diffDays(start, end);
  for (let i = 0; i <= n; i++) out.push(addDays(start, i));
  return out;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

/** Validates an IANA zone; falls back to UTC rather than throwing inside a render. */
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** The calendar date of an instant in a timezone. */
export function dateInZone(instant: Date, timeZone: string): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function todayIn(timeZone: string, now: Date = new Date()): ISODate {
  return dateInZone(now, timeZone);
}

/** Local hour (0–23) and minutes of an instant in a timezone. */
export function clockInZone(instant: Date, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTimeZone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return { hour: hour === 24 ? 0 : hour, minute };
}

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function monthName(d: ISODate, long = false): string {
  const m = Number(d.slice(5, 7)) - 1;
  return long ? MONTHS_LONG[m] : MONTHS[m];
}

export function weekdayName(d: ISODate, long = false): string {
  const w = jsWeekday(d);
  return long ? WEEKDAYS_LONG[w] : WEEKDAYS[w];
}

export function weekdayLabel(jsDay: number, long = false): string {
  return long ? WEEKDAYS_LONG[jsDay] : WEEKDAYS[jsDay];
}

/** "Sep 26" / "Sep 26, 2025" when the year differs from `relativeTo`. */
export function formatDay(d: ISODate, relativeTo?: ISODate): string {
  const base = `${monthName(d)} ${Number(d.slice(8, 10))}`;
  if (relativeTo && relativeTo.slice(0, 4) !== d.slice(0, 4)) return `${base}, ${d.slice(0, 4)}`;
  return base;
}

/** "Sep 21 – 27" or "Aug 30 – Sep 5". */
export function formatRange(start: ISODate, end: ISODate): string {
  if (start === end) return formatDay(start);
  if (start.slice(0, 7) === end.slice(0, 7)) return `${formatDay(start)} – ${Number(end.slice(8, 10))}`;
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${formatDay(start)} – ${formatDay(end)}${sameYear ? '' : `, ${end.slice(0, 4)}`}`;
}

/** ISO-8601 week number (weeks start Monday; week 1 contains Jan 4). */
export function isoWeekNumber(d: ISODate): number {
  const thursday = addDays(d, 4 - isoWeekday(d));
  const yearStart = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(diffDays(yearStart, thursday) / 7) + 1;
}

export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}
