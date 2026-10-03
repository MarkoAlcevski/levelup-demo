import { addDays, diffDays, endOfMonth, isoWeekday, startOfMonth, startOfWeek, type ISODate } from './dates';

/**
 * Training maths. Everything here is arithmetic over what was logged — no advice, no programming.
 *
 *   working set   a set marked done, kind "working", with at least 1 rep (warm-ups never count)
 *   volume        Σ weight × reps over working sets, in kg (sets logged in lb are converted, never rewritten)
 *   weight PR     heaviest working-set weight for an exercise, beating every earlier session
 *   rep PR        more reps at a weight than ever done at that weight or heavier
 *   volume PR     a session's volume beating every earlier session with the same workout name
 *   e1RM          Epley estimate w × (1 + reps/30), only for sets of ≤ 12 reps, always labelled an estimate
 * The first time an exercise is logged sets the baseline silently; records start from the second.
 */

export type WeightUnit = 'kg' | 'lb';
export const KG_PER_LB = 0.45359237;

export function toKg(w: number, unit: WeightUnit): number {
  return unit === 'kg' ? w : w * KG_PER_LB;
}

export function fromKg(kg: number, unit: WeightUnit): number {
  return unit === 'kg' ? kg : kg / KG_PER_LB;
}

/** 80 → "80", 82.5 → "82.5", 82.25 → "82.25" */
export function fmtNum(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export function fmtWeight(w: number | null | undefined, unit: WeightUnit): string {
  if (w == null) return '—';
  return `${fmtNum(w)} ${unit}`;
}

/** A logged value converted into the viewer's unit, rounded sensibly for display. */
export function displayWeight(w: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return w;
  const v = fromKg(toKg(w, from), to);
  return Math.round(v * 4) / 4;
}

export interface LoggedSet {
  weight: number | null;
  reps: number | null;
  kind: 'working' | 'warmup';
  done: boolean;
}

export interface LoggedExercise {
  exerciseId: string | null;
  name: string;
  skipped?: boolean;
  sets: LoggedSet[];
}

export interface LoggedSession {
  id: string;
  name: string;
  workoutDayId: string | null;
  performedOn: ISODate;
  startedAt: string;
  durationSeconds: number | null;
  weightUnit: WeightUnit;
  exercises: LoggedExercise[];
}

export function isWorkingSet(s: LoggedSet): boolean {
  return s.done && s.kind === 'working' && (s.reps ?? 0) > 0;
}

export function exerciseKey(e: { exerciseId: string | null; name: string }): string {
  return e.exerciseId ?? `name:${e.name.trim().toLowerCase()}`;
}

export interface SessionTotals {
  sets: number;
  exercises: number;
  reps: number;
  volumeKg: number;
}

export function sessionTotals(s: LoggedSession): SessionTotals {
  let sets = 0;
  let reps = 0;
  let volume = 0;
  let exercises = 0;
  for (const e of s.exercises) {
    const work = e.sets.filter(isWorkingSet);
    if (!work.length) continue;
    exercises++;
    for (const set of work) {
      sets++;
      reps += set.reps ?? 0;
      volume += toKg(set.weight ?? 0, s.weightUnit) * (set.reps ?? 0);
    }
  }
  return { sets, exercises, reps, volumeKg: Math.round(volume * 10) / 10 };
}

export function epley(weightKg: number, reps: number): number | null {
  if (weightKg <= 0 || reps <= 0 || reps > 12) return null;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

// ───────────────────────────────────────────── personal records

export interface PersonalRecord {
  kind: 'weight' | 'reps' | 'volume';
  key: string;
  name: string;
  /** kg for weight/volume; reps for rep PRs */
  value: number;
  weightKg: number | null;
  reps: number | null;
  previous: number | null;
}

interface ExerciseHistoryIndex {
  maxWeightKg: number;
  /** every working set ever: for "best reps at this weight or heavier" */
  sets: { weightKg: number; reps: number }[];
}

function indexSessions(sessions: LoggedSession[]): { byExercise: Map<string, ExerciseHistoryIndex>; volumeByName: Map<string, number> } {
  const byExercise = new Map<string, ExerciseHistoryIndex>();
  const volumeByName = new Map<string, number>();
  for (const s of sessions) {
    for (const e of s.exercises) {
      const work = e.sets.filter(isWorkingSet);
      if (!work.length) continue;
      const k = exerciseKey(e);
      const idx = byExercise.get(k) ?? { maxWeightKg: 0, sets: [] };
      for (const set of work) {
        const w = toKg(set.weight ?? 0, s.weightUnit);
        idx.maxWeightKg = Math.max(idx.maxWeightKg, w);
        idx.sets.push({ weightKg: w, reps: set.reps ?? 0 });
      }
      byExercise.set(k, idx);
    }
    const v = sessionTotals(s).volumeKg;
    const n = s.name.trim().toLowerCase();
    volumeByName.set(n, Math.max(volumeByName.get(n) ?? 0, v));
  }
  return { byExercise, volumeByName };
}

const EPS = 0.01;

/** Records broken by `current` compared with every session in `previous` (all logged before it). */
export function detectRecords(previous: LoggedSession[], current: LoggedSession): PersonalRecord[] {
  const { byExercise, volumeByName } = indexSessions(previous);
  const out: PersonalRecord[] = [];
  for (const e of current.exercises) {
    const work = e.sets.filter(isWorkingSet);
    if (!work.length) continue;
    const k = exerciseKey(e);
    const hist = byExercise.get(k);
    if (!hist) continue; // first time: baseline, not a record
    const top = work.reduce((b, s) => (toKg(s.weight ?? 0, current.weightUnit) > toKg(b.weight ?? 0, current.weightUnit) ? s : b), work[0]);
    const topKg = toKg(top.weight ?? 0, current.weightUnit);
    if (topKg > hist.maxWeightKg + EPS && topKg > 0) {
      out.push({ kind: 'weight', key: k, name: e.name, value: topKg, weightKg: topKg, reps: top.reps, previous: hist.maxWeightKg });
      continue; // a weight PR is the headline for this exercise
    }
    // rep PR: the heaviest weight at which reps beat everything done at that weight or heavier
    let best: PersonalRecord | null = null;
    for (const s of work) {
      const w = toKg(s.weight ?? 0, current.weightUnit);
      if (w <= 0) continue;
      const comparable = hist.sets.filter((h) => h.weightKg >= w - EPS);
      if (!comparable.length) continue;
      const prev = Math.max(...comparable.map((h) => h.reps));
      if ((s.reps ?? 0) > prev && (!best || w > (best.weightKg ?? 0))) {
        best = { kind: 'reps', key: k, name: e.name, value: s.reps ?? 0, weightKg: w, reps: s.reps, previous: prev };
      }
    }
    if (best) out.push(best);
  }
  const vol = sessionTotals(current).volumeKg;
  const prevVol = volumeByName.get(current.name.trim().toLowerCase());
  if (prevVol != null && vol > prevVol + EPS && vol > 0) {
    out.push({ kind: 'volume', key: `volume:${current.name.trim().toLowerCase()}`, name: current.name, value: vol, weightKg: null, reps: null, previous: prevVol });
  }
  return out;
}

/** All records set across a history, oldest first (each session vs everything before it). */
export function recordTimeline(sessions: LoggedSession[]): { sessionId: string; on: ISODate; record: PersonalRecord }[] {
  const sorted = [...sessions].sort((a, b) => (a.performedOn === b.performedOn ? a.startedAt.localeCompare(b.startedAt) : a.performedOn < b.performedOn ? -1 : 1));
  const out: { sessionId: string; on: ISODate; record: PersonalRecord }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    for (const r of detectRecords(sorted.slice(0, i), sorted[i])) out.push({ sessionId: sorted[i].id, on: sorted[i].performedOn, record: r });
  }
  return out;
}

// ───────────────────────────────────────────── exercise history

export interface ExercisePoint {
  sessionId: string;
  on: ISODate;
  unit: WeightUnit;
  sets: { weight: number | null; reps: number | null }[];
  topWeightKg: number;
  bestReps: number;
  volumeKg: number;
  e1rmKg: number | null;
}

export function exerciseHistory(sessions: LoggedSession[], key: string): ExercisePoint[] {
  const out: ExercisePoint[] = [];
  for (const s of sessions) {
    for (const e of s.exercises) {
      if (exerciseKey(e) !== key) continue;
      const work = e.sets.filter(isWorkingSet);
      if (!work.length) continue;
      let top = 0;
      let bestReps = 0;
      let volume = 0;
      let e1rm: number | null = null;
      for (const set of work) {
        const w = toKg(set.weight ?? 0, s.weightUnit);
        top = Math.max(top, w);
        bestReps = Math.max(bestReps, set.reps ?? 0);
        volume += w * (set.reps ?? 0);
        const est = epley(w, set.reps ?? 0);
        if (est != null) e1rm = Math.max(e1rm ?? 0, est);
      }
      out.push({
        sessionId: s.id, on: s.performedOn, unit: s.weightUnit, sets: work.map((x) => ({ weight: x.weight, reps: x.reps })),
        topWeightKg: top, bestReps, volumeKg: Math.round(volume * 10) / 10, e1rmKg: e1rm == null ? null : Math.round(e1rm * 10) / 10,
      });
    }
  }
  return out.sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0));
}

// ───────────────────────────────────────────── what to do next

export interface ProgramDayRef {
  id: string;
  name: string;
  position: number;
  weekday: number | null;
}

/**
 * The next workout in the user's own program.
 *   scheduled: today's assigned day (if not trained yet today), else the next assigned weekday
 *   flexible:  the day after the last one trained, cycling through the split in order
 */
export function nextWorkout<T extends ProgramDayRef>(
  mode: 'flexible' | 'scheduled',
  days: T[],
  lastTrainedDayId: string | null,
  today: ISODate,
  trainedToday: boolean,
): { day: T; on: ISODate } | null {
  const ordered = [...days].sort((a, b) => a.position - b.position);
  if (!ordered.length) return null;
  if (mode === 'scheduled') {
    for (let i = trainedToday ? 1 : 0; i <= 7; i++) {
      const d = addDays(today, i);
      const hit = ordered.find((x) => x.weekday === isoWeekday(d));
      if (hit) return { day: hit, on: d };
    }
    return null;
  }
  const idx = lastTrainedDayId ? ordered.findIndex((x) => x.id === lastTrainedDayId) : -1;
  return { day: ordered[(idx + 1) % ordered.length], on: today };
}

// ───────────────────────────────────────────── the monthly calendar

export type GymDayState = 'done' | 'planned' | 'missed' | 'rest';

export interface GymCalendarDay {
  day: ISODate;
  inMonth: boolean;
  isToday: boolean;
  future: boolean;
  state: GymDayState;
  sessions: { id: string; name: string }[];
  /** the routine was kept without a logged workout (e.g. "gym done" from the command bar) */
  loggedOnly: boolean;
  plannedName: string | null;
}

export interface GymCalendarWeek {
  weekStart: ISODate;
  days: GymCalendarDay[];
  done: number;
  target: number | null;
}

export interface CalendarInput {
  month: ISODate;
  today: ISODate;
  weekStartsOn: number;
  mode: 'flexible' | 'scheduled' | null;
  /** days the routine was kept (from completions) */
  keptDays: Set<ISODate>;
  /** scheduled programs: was this day a planned training day under the schedule valid then? */
  isScheduled: (day: ISODate) => boolean;
  /** the name to show for a planned day (current mapping) */
  plannedName: (day: ISODate) => string | null;
  sessionsByDay: Map<ISODate, { id: string; name: string }[]>;
  /** flexible programs: the weekly target valid that week */
  weeklyTarget: (weekStart: ISODate) => number | null;
}

export function gymCalendar(input: CalendarInput): GymCalendarWeek[] {
  const first = startOfMonth(input.month);
  const last = endOfMonth(input.month);
  const gridStart = startOfWeek(first, input.weekStartsOn);
  const weeks: GymCalendarWeek[] = [];
  for (let w = gridStart; w <= last; w = addDays(w, 7)) {
    const days: GymCalendarDay[] = [];
    let done = 0;
    let planned = 0;
    for (let i = 0; i < 7; i++) {
      const day = addDays(w, i);
      const sessions = input.sessionsByDay.get(day) ?? [];
      const kept = input.keptDays.has(day) || sessions.length > 0;
      const scheduled = input.mode === 'scheduled' && input.isScheduled(day);
      const future = day > input.today;
      let state: GymDayState = 'rest';
      if (kept && !future) state = 'done';
      else if (scheduled && (future || day === input.today)) state = 'planned';
      else if (scheduled && day < input.today) state = 'missed';
      if (kept && !future) done += Math.max(1, sessions.length);
      if (scheduled) planned++;
      days.push({
        day,
        inMonth: day >= first && day <= last,
        isToday: day === input.today,
        future,
        state,
        sessions,
        loggedOnly: kept && !sessions.length,
        plannedName: scheduled ? input.plannedName(day) : null,
      });
    }
    const target = input.mode === 'flexible' ? input.weeklyTarget(w) : input.mode === 'scheduled' ? planned : null;
    weeks.push({ weekStart: w, days, done, target });
  }
  return weeks;
}

export interface MonthSummary {
  workouts: number;
  target: number | null;
  completion: number | null;
  minutes: number;
  sets: number;
  volumeKg: number;
  records: number;
}

/** "September: 15 workouts of 16 · 93.8% · 14h 18m · 268 sets". */
export function monthSummary(opts: {
  month: ISODate;
  mode: 'flexible' | 'scheduled' | null;
  perWeek: number | null;
  scheduledDays: number;
  sessions: LoggedSession[];
  loggedOnlyDays: number;
  records: number;
}): MonthSummary {
  const first = startOfMonth(opts.month);
  const last = endOfMonth(opts.month);
  const inMonth = opts.sessions.filter((s) => s.performedOn >= first && s.performedOn <= last);
  const workouts = inMonth.length + opts.loggedOnlyDays;
  const days = diffDays(first, last) + 1;
  const target = opts.mode === 'flexible' && opts.perWeek ? Math.round((opts.perWeek * days) / 7) : opts.mode === 'scheduled' ? opts.scheduledDays : null;
  let sets = 0;
  let volume = 0;
  let seconds = 0;
  for (const s of inMonth) {
    const t = sessionTotals(s);
    sets += t.sets;
    volume += t.volumeKg;
    seconds += s.durationSeconds ?? 0;
  }
  return {
    workouts,
    target,
    completion: target ? Math.min(1, workouts / target) : null,
    minutes: Math.round(seconds / 60),
    sets,
    volumeKg: Math.round(volume),
    records: opts.records,
  };
}
