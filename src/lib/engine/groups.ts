import { addDays, addMonths, diffDays, endOfMonth, maxDate, minDate, startOfMonth, startOfWeek, type ISODate } from './dates';

/**
 * Group competition: everyone keeps their OWN commitment, and the ranking is how well they kept it.
 *
 *   pledge per week      your weekly target, prorated for partial weeks (target × days ÷ 7;
 *                        counts like workouts round to whole numbers, minutes/pages don't)
 *   eligible per week    min(what you did that week, that week's pledge) — extra work is shown,
 *                        never needed to win; 40 workouts don't beat an honest 4-a-week
 *   COMMITMENT RATE      Σ eligible ÷ Σ pledge, 0–100%
 *                        (while a season runs, the current week's pledge is prorated by days elapsed)
 *   perfect week         a week where you did at least your pledge
 *
 * Ties are broken, in order, by: perfect weeks → more pledged work completed (Σ eligible) → proof
 * rate (only when the group uses proof) → otherwise it is a tie, and it is shown as one.
 * If the group requires proof, only days carrying proof shared with the group count.
 */

export type GroupUnit = 'workouts' | 'minutes' | 'sessions' | 'pages' | 'lessons' | 'units' | 'times';
const DISCRETE: ReadonlySet<GroupUnit> = new Set(['workouts', 'sessions', 'lessons', 'times']);
const EPS = 1e-9;

export interface SeasonWindow {
  start: ISODate;
  end: ISODate;
}

export interface MemberCommitment {
  userId: string;
  name: string;
  /** per week, locked for the season */
  target: number;
  unit: GroupUnit;
  /** first day the pledge applies (joining mid-season prorates) */
  startsOn: ISODate;
}

export interface DayActivity {
  userId: string;
  day: ISODate;
  amount: number;
  proofed: boolean;
}

export interface WeekResult {
  start: ISODate;
  end: ISODate;
  days: number;
  pledged: number;
  done: number;
  eligible: number;
  /** fully in the past (or the season is final) */
  complete: boolean;
}

export interface Standing {
  userId: string;
  name: string;
  unit: GroupUnit;
  target: number;
  done: number;
  eligible: number;
  pledged: number;
  pledgedToDate: number;
  rate: number;
  perfectWeeks: number;
  weeks: number;
  proofed: number;
  proofRate: number | null;
  rank: number;
  tied: boolean;
  weekly: WeekResult[];
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function pledgeFor(target: number, days: number, unit: GroupUnit): number {
  const raw = (target * days) / 7;
  return DISCRETE.has(unit) ? Math.round(raw) : round1(raw);
}

/** Week-aligned chunks of [from, to]; the first and last may be partial. */
export function weekChunks(from: ISODate, to: ISODate, weekStartsOn: number): { start: ISODate; end: ISODate; days: number }[] {
  const out: { start: ISODate; end: ISODate; days: number }[] = [];
  if (to < from) return out;
  for (let w = startOfWeek(from, weekStartsOn); w <= to; w = addDays(w, 7)) {
    const start = maxDate(w, from);
    const end = minDate(addDays(w, 6), to);
    out.push({ start, end, days: diffDays(start, end) + 1 });
  }
  return out;
}

export function computeStandings(opts: {
  window: SeasonWindow;
  today: ISODate;
  weekStartsOn: number;
  /** season closed: every week counts in full */
  final: boolean;
  proofRequired: boolean;
  /** proof policy isn't self-report: proof rate becomes a tie-breaker */
  proofMatters: boolean;
  members: MemberCommitment[];
  activity: DayActivity[];
}): Standing[] {
  const { window, today, final } = opts;
  const byMember = new Map<string, DayActivity[]>();
  for (const a of opts.activity) {
    if (a.day < window.start || a.day > window.end) continue;
    const list = byMember.get(a.userId);
    if (list) list.push(a);
    else byMember.set(a.userId, [a]);
  }
  const rows: Standing[] = opts.members.map((m) => {
    const from = maxDate(window.start, m.startsOn);
    const acts = byMember.get(m.userId) ?? [];
    const counted = (a: DayActivity) => !opts.proofRequired || a.proofed;
    const weekly: WeekResult[] = [];
    let done = 0;
    let eligible = 0;
    let pledged = 0;
    let pledgedToDate = 0;
    let perfectWeeks = 0;
    let weeks = 0;
    let proofed = 0;
    let total = 0;
    for (const c of weekChunks(from, window.end, opts.weekStartsOn)) {
      const pledge = pledgeFor(m.target, c.days, m.unit);
      const inWeek = acts.filter((a) => a.day >= c.start && a.day <= c.end && a.day <= today);
      const wDone = inWeek.filter(counted).reduce((s, a) => s + a.amount, 0);
      total += inWeek.reduce((s, a) => s + a.amount, 0);
      proofed += inWeek.filter((a) => a.proofed).reduce((s, a) => s + a.amount, 0);
      const wEligible = Math.min(wDone, pledge);
      const complete = final || c.end < today;
      const started = c.start <= today;
      pledged += pledge;
      if (complete) pledgedToDate += pledge;
      else if (started) pledgedToDate += (pledge * (diffDays(c.start, today) + 1)) / c.days;
      if (started || final) {
        done += wDone;
        eligible += wEligible;
      }
      if (complete && pledge > 0) {
        weeks++;
        if (wDone >= pledge - EPS) perfectWeeks++;
      }
      weekly.push({ start: c.start, end: c.end, days: c.days, pledged: pledge, done: round1(wDone), eligible: round1(wEligible), complete });
    }
    const denom = final ? pledged : pledgedToDate;
    return {
      userId: m.userId,
      name: m.name,
      unit: m.unit,
      target: m.target,
      done: round1(done),
      eligible: round1(eligible),
      pledged: round1(pledged),
      pledgedToDate: round1(pledgedToDate),
      rate: denom > EPS ? Math.min(1, eligible / denom) : 0,
      perfectWeeks,
      weeks,
      proofed: round1(proofed),
      proofRate: total > EPS ? proofed / total : null,
      rank: 0,
      tied: false,
      weekly,
    };
  });
  return rankStandings(rows, opts.proofMatters);
}

function compare(a: Standing, b: Standing, proofMatters: boolean): number {
  if (Math.abs(a.rate - b.rate) > EPS) return b.rate - a.rate;
  if (a.perfectWeeks !== b.perfectWeeks) return b.perfectWeeks - a.perfectWeeks;
  if (Math.abs(a.eligible - b.eligible) > EPS) return b.eligible - a.eligible;
  if (proofMatters && Math.abs((a.proofRate ?? 0) - (b.proofRate ?? 0)) > EPS) return (b.proofRate ?? 0) - (a.proofRate ?? 0);
  return 0;
}

/** Sort and assign competition ranks (1, 1, 3). Equal on every rule = a declared tie. */
export function rankStandings(rows: Standing[], proofMatters: boolean): Standing[] {
  const sorted = [...rows].sort((a, b) => compare(a, b, proofMatters) || a.name.localeCompare(b.name));
  for (let i = 0; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    sorted[i].rank = prev && compare(prev, sorted[i], proofMatters) === 0 ? prev.rank : i + 1;
  }
  for (const r of sorted) r.tied = sorted.some((o) => o !== r && o.rank === r.rank);
  return sorted;
}

/** The whole group's rate: everyone's eligible work over everyone's pledge. */
export function groupCompletion(rows: Standing[], final: boolean): number | null {
  const e = rows.reduce((s, r) => s + r.eligible, 0);
  const p = rows.reduce((s, r) => s + (final ? r.pledged : r.pledgedToDate), 0);
  return p > EPS ? Math.min(1, e / p) : null;
}

// ───────────────────────────────────────────── seasons

export type SeasonLength = 'week' | 'month' | 'custom';

/** The season that contains `day`, given where the group's seasons are anchored. */
export function seasonBounds(length: SeasonLength, anchor: ISODate, day: ISODate, weekStartsOn: number, customDays?: number | null): SeasonWindow {
  if (length === 'month') return { start: startOfMonth(day), end: endOfMonth(day) };
  if (length === 'week') {
    const start = startOfWeek(day, weekStartsOn);
    return { start, end: addDays(start, 6) };
  }
  const n = Math.max(7, customDays ?? 30);
  const k = Math.floor(diffDays(anchor, day) / n);
  const start = addDays(anchor, k * n);
  return { start, end: addDays(start, n - 1) };
}

/**
 * The season that starts on `start`. A season that would be a stub (a monthly group created on the
 * 27th, a weekly one on Sunday) runs on through the next full period instead, so no one competes over
 * three days.
 */
export function seasonFrom(length: SeasonLength, anchor: ISODate, start: ISODate, weekStartsOn: number, customDays?: number | null): SeasonWindow {
  const b = seasonBounds(length, anchor, start, weekStartsOn, customDays);
  const days = diffDays(start, b.end) + 1;
  const minimum = length === 'week' ? 3 : 7;
  if (days >= minimum) return { start, end: b.end };
  return { start, end: seasonBounds(length, anchor, addDays(b.end, 1), weekStartsOn, customDays).end };
}

export function nextSeasonStart(length: SeasonLength, end: ISODate): ISODate {
  return addDays(end, 1);
}

export function seasonLabel(length: SeasonLength, w: SeasonWindow, number: number): string {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  if (length === 'month' && w.start.slice(8) === '01' && addMonths(w.start, 1) === addDays(w.end, 1)) {
    return `${months[Number(w.start.slice(5, 7)) - 1]} ${w.start.slice(0, 4)}`;
  }
  return `Season ${number}`;
}

// ───────────────────────────────────────────── awards and the championship

export const PLACEMENT_POINTS = [5, 3, 2] as const;

/**
 * Championship points for one season — simple enough to fit in a sentence:
 *   placement   1st 5 · 2nd 3 · 3rd 2 (ties share the higher place)
 *   commitment  ≥ 90% → 3 · ≥ 75% → 2 · ≥ 50% → 1
 *   perfect     +1 for a perfect season
 * A season is worth at most 9, so one exceptional month can't decide a year, and a member who
 * keeps their word every month out-scores an occasional winner.
 */
export function championshipPoints(s: Pick<Standing, 'rank' | 'rate'>, perfect: boolean): number {
  const placement = s.rate > EPS && s.rank <= 3 ? PLACEMENT_POINTS[s.rank - 1] : 0;
  const commitment = s.rate >= 0.9 - EPS ? 3 : s.rate >= 0.75 - EPS ? 2 : s.rate >= 0.5 - EPS ? 1 : 0;
  return placement + commitment + (perfect ? 1 : 0);
}

export function isPerfectSeason(s: Pick<Standing, 'rate' | 'perfectWeeks' | 'weeks'>): boolean {
  return s.weeks > 0 && s.rate >= 1 - EPS && s.perfectWeeks === s.weeks;
}

export interface AwardDraft {
  userId: string;
  kind: 'champion' | 'perfect' | 'most_improved' | 'highest_volume';
  title: string;
  detail: string;
}

/** Awards stay meaningful: nobody gets one for showing up. */
export function seasonAwards(
  standings: Standing[],
  label: string,
  previousRates: Map<string, number>,
  sameUnit: boolean,
): AwardDraft[] {
  const out: AwardDraft[] = [];
  const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;
  const champs = standings.filter((s) => s.rank === 1 && s.rate > EPS);
  for (const c of champs) {
    out.push({
      userId: c.userId, kind: 'champion',
      title: champs.length > 1 ? `${label} co-champion` : `${label} champion`,
      detail: `${pct(c.rate)} · ${ofAmount(c.eligible, c.pledged, c.unit)}`,
    });
  }
  for (const s of standings) {
    if (isPerfectSeason(s)) out.push({ userId: s.userId, kind: 'perfect', title: `Perfect ${label}`, detail: `Every week at or above target (${s.weeks}/${s.weeks})` });
  }
  const improved = standings
    .filter((s) => previousRates.has(s.userId))
    .map((s) => ({ s, delta: s.rate - previousRates.get(s.userId)! }))
    .filter((x) => x.delta >= 0.1 - EPS)
    .sort((a, b) => b.delta - a.delta);
  if (improved.length && (improved.length === 1 || improved[0].delta - improved[1].delta > EPS)) {
    const { s, delta } = improved[0];
    out.push({ userId: s.userId, kind: 'most_improved', title: 'Most improved', detail: `+${Math.round(delta * 100)} points of commitment rate (${pct(previousRates.get(s.userId)!)} → ${pct(s.rate)})` });
  }
  if (sameUnit && standings.length > 1) {
    const byDone = [...standings].sort((a, b) => b.done - a.done);
    const top = byDone[0];
    if (top.done > top.pledged + EPS && top.done - byDone[1].done > EPS) {
      out.push({ userId: top.userId, kind: 'highest_volume', title: 'Highest volume', detail: `${fmtAmount(top.done, top.unit)} this season` });
    }
  }
  return out;
}

export interface YearRow {
  userId: string;
  name: string;
  points: number;
  wins: number;
  seasons: number;
  rank: number;
  tied: boolean;
}

export function yearTable(results: { userId: string; name: string; points: number; rank: number; rate: number }[]): YearRow[] {
  const by = new Map<string, YearRow>();
  for (const r of results) {
    const row = by.get(r.userId) ?? { userId: r.userId, name: r.name, points: 0, wins: 0, seasons: 0, rank: 0, tied: false };
    row.points += r.points;
    row.seasons++;
    if (r.rank === 1 && r.rate > EPS) row.wins++;
    row.name = r.name;
    by.set(r.userId, row);
  }
  const rows = [...by.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));
  for (let i = 0; i < rows.length; i++) {
    const p = rows[i - 1];
    rows[i].rank = p && p.points === rows[i].points && p.wins === rows[i].wins ? p.rank : i + 1;
  }
  for (const r of rows) r.tied = rows.some((o) => o !== r && o.rank === r.rank);
  return rows;
}

const UNIT_LABEL: Record<GroupUnit, [string, string]> = {
  workouts: ['workout', 'workouts'],
  minutes: ['min', 'min'],
  sessions: ['session', 'sessions'],
  pages: ['page', 'pages'],
  lessons: ['lesson', 'lessons'],
  units: ['unit', 'units'],
  times: ['time', 'times'],
};

export function fmtAmount(n: number, unit: GroupUnit): string {
  const v = Math.round(n * 10) / 10;
  if (unit === 'minutes') {
    const m = Math.round(v);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m} min`;
  }
  const [one, many] = UNIT_LABEL[unit];
  return `${v} ${v === 1 ? one : many}`;
}

/** "3 of 4 workouts", "2h of 5h" — the done part without repeating the unit. */
export function ofAmount(done: number, of: number, unit: GroupUnit): string {
  if (unit === 'minutes') return `${fmtAmount(done, unit)} of ${fmtAmount(of, unit)}`;
  return `${Math.round(done * 10) / 10} of ${fmtAmount(of, unit)}`;
}

export function unitLabel(unit: GroupUnit, n = 2): string {
  const [one, many] = UNIT_LABEL[unit];
  return n === 1 ? one : many;
}
