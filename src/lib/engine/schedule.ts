import { addDays, diffDays, endOfWeek, isoWeekday, maxDate, startOfWeek, type ISODate } from './dates';
import type { CompletionRec, MissionDef, ScheduleVersion } from './types';

/**
 * WHEN is a mission due? Everything downstream (Today, rates, streaks, heatmap, reviews)
 * reduces to one question per mission per day, answered here.
 *
 * Weekly quotas ("gym 4× a week") are the interesting case. A quota mission is:
 *   - FLEXIBLE on a day where you still have slack (remaining sessions < days left),
 *     so skipping it that day costs nothing;
 *   - REQUIRED on a day with no slack left (remaining ≥ days left), so a miss counts;
 *   - EXTRA once the quota is met — logged, earns XP, never inflates rates.
 * A day's completion always counts (unless extra). Summed over a finished week, due units
 * equal exactly the quota — so daily, weekly and 30-day rates all agree with each other.
 */

export type SlotStatus = 'none' | 'required' | 'flexible' | 'extra' | 'overdue' | 'backlog';

export interface WeeklyState {
  weekStart: ISODate;
  weekEnd: ISODate;
  quota: number;
  /** kept sessions this week, including today's */
  done: number;
  /** sessions still needed as of the start of this day */
  remaining: number;
  /** days left in the week including this day */
  daysLeft: number;
}

export interface MissionDay {
  missionId: string;
  day: ISODate;
  status: SlotStatus;
  /** counts toward "due" on this day for rates */
  counts: boolean;
  completion: CompletionRec | null;
  weekly: WeeklyState | null;
  /** once-missions: the deadline, when there is one */
  dueOn: ISODate | null;
}

export interface EvalOptions {
  today: ISODate;
  weekStartsOn: number;
}

export function versionAt(schedules: ScheduleVersion[], day: ISODate): ScheduleVersion | null {
  for (const s of schedules) {
    if (s.validFrom <= day && (s.validTo == null || day < s.validTo)) return s;
  }
  return null;
}

/** Index completions of one mission by day. */
export function byDay(completions: CompletionRec[]): Map<ISODate, CompletionRec> {
  const m = new Map<ISODate, CompletionRec>();
  for (const c of completions) m.set(c.day, c);
  return m;
}

function weeklyQuota(v: ScheduleVersion, weekStart: ISODate, weekEnd: ISODate): number {
  const perWeek = v.perWeek ?? 1;
  const activeStart = maxDate(weekStart, v.validFrom);
  const activeDays = diffDays(activeStart, weekEnd) + 1;
  if (activeDays >= 7) return perWeek;
  return Math.max(1, Math.min(perWeek, Math.round((perWeek * activeDays) / 7)));
}

function countKept(done: Map<ISODate, CompletionRec>, from: ISODate, toExclusive: ISODate): number {
  let n = 0;
  for (let d = from; d < toExclusive; d = addDays(d, 1)) if (done.get(d)?.kept) n++;
  return n;
}

export function evaluateMissionDay(
  mission: MissionDef,
  done: Map<ISODate, CompletionRec>,
  day: ISODate,
  opts: EvalOptions,
): MissionDay {
  const completion = done.get(day) ?? null;
  const base: MissionDay = {
    missionId: mission.id,
    day,
    status: 'none',
    counts: false,
    completion,
    weekly: null,
    dueOn: null,
  };
  const v = versionAt(mission.schedules, day);

  if (!v) {
    // Logged on a day the mission wasn't scheduled (before it existed or after it ended).
    return completion ? { ...base, status: 'extra' } : base;
  }

  switch (v.cadence) {
    case 'daily':
      return withCompletionRules({ ...base, status: 'required' });

    case 'days': {
      const on = (v.weekdays ?? []).includes(isoWeekday(day));
      if (on) return withCompletionRules({ ...base, status: 'required' });
      return completion && completion.outcome !== 'skipped' ? { ...base, status: 'extra' } : base;
    }

    case 'once': {
      // A one-time mission is done the first day it was kept. A late finish settles it:
      // the deadline day stops counting as a miss once the work actually happened.
      const dueOn = v.dueOn;
      let completedOn: ISODate | null = null;
      for (const [d, c] of done) if (c.kept && (!completedOn || d < completedOn)) completedOn = d;
      const out = { ...base, dueOn };
      if (completion && completion.outcome !== 'skipped') {
        return completedOn === day || !completion.kept
          ? withCompletionRules({ ...out, status: 'required' })
          : { ...out, status: 'extra' };
      }
      if (completedOn) return out; // done on another day
      if (!dueOn) return { ...out, status: 'backlog' };
      if (day === dueOn) return withCompletionRules({ ...out, status: 'required' });
      if (day > dueOn && day <= opts.today) return { ...out, status: 'overdue' };
      return out;
    }

    case 'weekly': {
      const weekStart = startOfWeek(day, opts.weekStartsOn);
      const weekEnd = endOfWeek(day, opts.weekStartsOn);
      const quota = weeklyQuota(v, weekStart, weekEnd);
      const from = maxDate(weekStart, v.validFrom);
      const doneBefore = countKept(done, from, day);
      const remaining = Math.max(0, quota - doneBefore);
      const daysLeft = diffDays(day, weekEnd) + 1;
      const doneThroughToday = doneBefore + (completion?.kept ? 1 : 0);
      const weekly: WeeklyState = { weekStart, weekEnd, quota, done: doneThroughToday, remaining, daysLeft };
      const noSlack = remaining > 0 && remaining >= daysLeft;

      if (completion) {
        if (completion.outcome === 'skipped') {
          return { ...base, status: noSlack ? 'required' : remaining > 0 ? 'flexible' : 'none', counts: false, weekly };
        }
        if (completion.kept) {
          if (remaining === 0) return { ...base, status: 'extra', weekly };
          return { ...base, status: noSlack ? 'required' : 'flexible', counts: true, weekly };
        }
        // partial or explicit miss: only counts when the day was required
        return { ...base, status: noSlack ? 'required' : 'flexible', counts: noSlack, weekly };
      }
      if (remaining === 0) return { ...base, status: 'none', weekly };
      return { ...base, status: noSlack ? 'required' : 'flexible', counts: noSlack, weekly };
    }
  }
}

/** Required slots count unless the completion is an excused skip. */
function withCompletionRules(md: MissionDay): MissionDay {
  if (md.completion?.outcome === 'skipped') return { ...md, counts: false };
  return { ...md, counts: true };
}

/** Evaluate a mission over an inclusive day range. `done` should include the week before `start`. */
export function evaluateMission(
  mission: MissionDef,
  done: Map<ISODate, CompletionRec>,
  start: ISODate,
  end: ISODate,
  opts: EvalOptions,
): MissionDay[] {
  const out: MissionDay[] = [];
  const n = diffDays(start, end);
  for (let i = 0; i <= n; i++) out.push(evaluateMissionDay(mission, done, addDays(start, i), opts));
  return out;
}

/** Human cadence: "Daily", "4× a week", "Mon · Wed · Fri", "Once · due Sep 30". */
export function describeCadence(v: ScheduleVersion | null): string {
  if (!v) return 'Paused';
  switch (v.cadence) {
    case 'daily':
      return 'Daily';
    case 'weekly':
      return v.perWeek === 7 ? 'Every day' : `${v.perWeek}× a week`;
    case 'days': {
      const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const days = [...(v.weekdays ?? [])].sort((a, b) => a - b);
      if (days.join() === '1,2,3,4,5') return 'Weekdays';
      if (days.join() === '6,7') return 'Weekends';
      return days.map((d) => names[d - 1]).join(' · ');
    }
    case 'once':
      return v.dueOn ? 'One-time · due' : 'One-time';
  }
}
