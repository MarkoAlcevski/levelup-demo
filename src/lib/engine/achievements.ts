import type { ISODate } from './dates';

/**
 * Achievements reward real behaviour, not app usage. Each has a deterministic check over a
 * stats snapshot and reports progress toward it, so locked achievements show "7 of 10", not "???".
 * Hidden ones are revealed only once earned.
 */

export interface AchievementStats {
  keptTotal: number;
  firstKeptOn: ISODate | null;
  bestRun: number;
  bestRunEnd: ISODate | null;
  bestWeekConsistency: { value: number; due: number; end: ISODate } | null;
  perfectWeeks: { end: ISODate }[];
  consecutiveQuotaWeeks: { best: number; endedOn: ISODate | null };
  comebacks: { on: ISODate }[];
  keptByArea: Record<string, { kept: number; minutes: number; hundredthHourOn: ISODate | null; hundredthOn: ISODate | null }>;
  proofs: number;
  fiftiethProofOn: ISODate | null;
  keystonesDone: number;
  fifthKeystoneOn: ISODate | null;
  level: number;
  /** the day lifetime XP first reached each level (level → date) */
  levelReachedOn: Record<number, ISODate>;
  earlyKept: number;
  recordsBroken: number;
  workouts: { count: number; firstOn: ISODate | null; tenthOn: ISODate | null; hundredthOn: ISODate | null };
  learningMinutes: number;
  learningHundredHoursOn: ISODate | null;
  perfectMonths: { end: ISODate }[];
  championships: { on: ISODate }[];
  incomeTargetMetOn: ISODate | null;
}

export interface AchievementDef {
  key: string;
  title: string;
  description: string;
  tier: 'bronze' | 'silver' | 'gold';
  hidden?: boolean;
  /** V1 achievement: shown only to people who already earned it */
  legacy?: boolean;
  xp: number;
  /** progress 0–1 and, when complete, the day it was earned */
  check: (s: AchievementStats) => { progress: number; label: string; on: ISODate | null };
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    key: 'first_blood', title: 'First step', description: 'Keep your first routine or task.', tier: 'bronze', xp: 25,
    check: (s) => ({ progress: clamp(s.keptTotal), label: `${Math.min(1, s.keptTotal)} of 1`, on: s.firstKeptOn }),
  },
  {
    key: 'first_workout', title: 'First workout', description: 'Log your first workout.', tier: 'bronze', xp: 25,
    check: (s) => ({ progress: clamp(s.workouts.count), label: `${Math.min(1, s.workouts.count)} of 1`, on: s.workouts.firstOn }),
  },
  {
    key: 'workouts_10', title: '10 workouts', description: 'Log ten workouts.', tier: 'bronze', xp: 75,
    check: (s) => ({ progress: clamp(s.workouts.count / 10), label: `${Math.min(10, s.workouts.count)} of 10`, on: s.workouts.tenthOn }),
  },
  {
    key: 'workouts_100', title: '100 workouts', description: 'Log a hundred workouts.', tier: 'gold', xp: 300,
    check: (s) => ({ progress: clamp(s.workouts.count / 100), label: `${Math.min(100, s.workouts.count)} of 100`, on: s.workouts.hundredthOn }),
  },
  {
    key: 'consistent', title: 'Consistent', description: 'Keep 90%+ of what was due across a full week.', tier: 'bronze', xp: 75,
    check: (s) => {
      const v = s.bestWeekConsistency;
      return { progress: clamp((v?.value ?? 0) / 0.9), label: v ? `best week ${Math.round(v.value * 100)}%` : 'no full week yet', on: v && v.value >= 0.9 && v.due >= 10 ? v.end : null };
    },
  },
  {
    key: 'perfect_week', title: 'Perfect week', description: 'Keep everything that was due for a whole week.', tier: 'silver', xp: 200,
    check: (s) => ({ progress: s.perfectWeeks.length ? 1 : clamp((s.bestWeekConsistency?.value ?? 0)), label: `${s.perfectWeeks.length} so far`, on: s.perfectWeeks[0]?.end ?? null }),
  },
  {
    key: 'perfect_month', title: 'Perfect month', description: 'Keep everything that was due for a whole calendar month.', tier: 'gold', xp: 400,
    check: (s) => ({ progress: s.perfectMonths.length ? 1 : 0, label: s.perfectMonths.length ? `${s.perfectMonths.length} so far` : 'not yet', on: s.perfectMonths[0]?.end ?? null }),
  },
  {
    key: 'iron_month', title: 'Four weeks straight', description: 'Hit a weekly target four weeks in a row.', tier: 'silver', xp: 150,
    check: (s) => ({ progress: clamp(s.consecutiveQuotaWeeks.best / 4), label: `${Math.min(4, s.consecutiveQuotaWeeks.best)} of 4 weeks`, on: s.consecutiveQuotaWeeks.best >= 4 ? s.consecutiveQuotaWeeks.endedOn : null }),
  },
  {
    key: 'streak_30', title: '30-day consistency', description: 'A 30-day run.', tier: 'silver', xp: 150,
    check: (s) => ({ progress: clamp(s.bestRun / 30), label: `best ${s.bestRun} days`, on: s.bestRun >= 30 ? s.bestRunEnd : null }),
  },
  {
    key: 'comeback', title: 'Comeback', description: 'Return after three or more days off.', tier: 'bronze', xp: 75,
    check: (s) => ({ progress: s.comebacks.length ? 1 : 0, label: s.comebacks.length ? `${s.comebacks.length} comebacks` : 'not needed yet', on: s.comebacks[0]?.on ?? null }),
  },
  {
    key: 'learning_100h', title: '100 learning hours', description: 'Log a hundred hours of learning.', tier: 'gold', xp: 300,
    check: (s) => ({ progress: clamp(s.learningMinutes / 6000), label: `${Math.floor(s.learningMinutes / 60)} of 100 h`, on: s.learningHundredHoursOn }),
  },
  {
    key: 'hundred_hours', title: '100 hours', description: 'Log 100 hours of timed routines in one area.', tier: 'gold', xp: 300,
    check: (s) => {
      const best = Object.values(s.keptByArea).reduce((b, a) => (a.minutes > b.minutes ? a : b), { kept: 0, minutes: 0, hundredthHourOn: null, hundredthOn: null });
      return { progress: clamp(best.minutes / 6000), label: `${Math.floor(best.minutes / 60)} of 100 h`, on: best.hundredthHourOn };
    },
  },
  {
    key: 'group_champion', title: 'Champion', description: 'Win a group season.', tier: 'gold', xp: 250,
    check: (s) => ({ progress: s.championships.length ? 1 : 0, label: s.championships.length ? `${s.championships.length} won` : 'not yet', on: s.championships[0]?.on ?? null }),
  },
  {
    key: 'income_target', title: 'Income target reached', description: 'Reach a monthly income target you set.', tier: 'silver', xp: 150,
    check: (s) => ({ progress: s.incomeTargetMetOn ? 1 : 0, label: s.incomeTargetMetOn ? 'reached' : 'not yet', on: s.incomeTargetMetOn }),
  },
  {
    key: 'evidence_50', title: 'On record', description: 'Attach 50 pieces of proof.', tier: 'silver', xp: 150,
    check: (s) => ({ progress: clamp(s.proofs / 50), label: `${Math.min(50, s.proofs)} of 50`, on: s.fiftiethProofOn }),
  },
  {
    key: 'keystone_5', title: 'Five focuses', description: 'Finish five Weekly Focuses.', tier: 'silver', xp: 150,
    check: (s) => ({ progress: clamp(s.keystonesDone / 5), label: `${Math.min(5, s.keystonesDone)} of 5`, on: s.fifthKeystoneOn }),
  },
  {
    key: 'level_10', title: 'Double digits', description: 'Reach level 10.', tier: 'bronze', xp: 0,
    check: (s) => ({ progress: clamp(s.level / 10), label: `level ${s.level}`, on: s.levelReachedOn[10] ?? null }),
  },
  {
    key: 'early_bird', title: 'Before the world wakes', description: 'Keep 20 routines before 08:00.', tier: 'silver', xp: 100, hidden: true,
    check: (s) => ({ progress: clamp(s.earlyKept / 20), label: `${Math.min(20, s.earlyKept)} of 20`, on: null }),
  },
  {
    key: 'builder', title: 'Builder', description: 'Keep 100 work missions.', tier: 'silver', xp: 150, legacy: true,
    check: (s) => {
      const w = s.keptByArea.work;
      return { progress: clamp((w?.kept ?? 0) / 100), label: `${Math.min(100, w?.kept ?? 0)} of 100`, on: w?.hundredthOn ?? null };
    },
  },
];
