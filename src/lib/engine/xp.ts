import type { Difficulty, Outcome } from './types';

/**
 * XP rules. XP measures execution inside Kept — nothing more.
 *
 * Anti-abuse, by construction:
 *   - one award per mission per day (completions are unique on mission + day)
 *   - difficulty is snapshotted on the completion; editing it later never rewrites history
 *   - flexible-day extras beyond a weekly quota earn XP but never raise rates
 *   - leaderboards (future) rank execution %, never raw XP, because difficulty is self-rated
 */

export const DIFFICULTY_XP: Record<Difficulty, number> = { easy: 10, normal: 20, hard: 40, extreme: 70 };

export const OUTCOME_MULTIPLIER: Record<Outcome, number> = {
  exceeded: 1.25,
  full: 1,
  minimum: 0.5,
  partial: 0.25,
  missed: 0,
  skipped: 0,
};

export const BONUS_XP = {
  perfectDay: 25,
  perfectWeek: 150,
  keystone: 150,
  project: 200,
  goal: 300,
} as const;

/** Momentum / weighted-execution weights. */
export const DIFFICULTY_WEIGHT: Record<Difficulty, number> = { easy: 0.75, normal: 1, hard: 1.25, extreme: 1.5 };

export function completionXp(difficulty: Difficulty, outcome: Outcome): number {
  return Math.round(DIFFICULTY_XP[difficulty] * OUTCOME_MULTIPLIER[outcome]);
}

/** Hitting a weekly quota pays one extra full award for that mission. */
export function weeklyQuotaXp(difficulty: Difficulty): number {
  return DIFFICULTY_XP[difficulty];
}

/**
 * Level curve: reaching level L requires 50·L·(L−1) lifetime XP, i.e. level L → L+1 costs 100·L.
 * L2 = 100, L5 = 1,000, L10 = 4,500, L20 = 19,000, L30 = 43,500.
 * At ~150 XP/day (a solid execution day), that is L10 in a month and ~L30 after a year.
 */
export function xpForLevel(level: number): number {
  return 50 * level * (level - 1);
}

export interface LevelInfo {
  level: number;
  xp: number;
  floor: number; // xp at which this level started
  next: number; // xp at which the next level starts
  into: number; // xp earned inside this level
  span: number; // xp this level requires
  progress: number; // 0–1
}

export function levelFromXp(xpRaw: number): LevelInfo {
  const xp = Math.max(0, Math.floor(xpRaw));
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + 0.08 * xp)) / 2));
  while (xpForLevel(level + 1) <= xp) level++;
  while (level > 1 && xpForLevel(level) > xp) level--;
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, xp, floor, next, into: xp - floor, span: next - floor, progress: (xp - floor) / (next - floor) };
}

/** Levels that unlock a cosmetic accent. Nothing else is gated by level. */
export const ACCENT_UNLOCKS: { accent: 'volt' | 'ember' | 'cobalt' | 'ivory'; level: number; name: string }[] = [
  { accent: 'volt', level: 1, name: 'Volt' },
  { accent: 'ember', level: 10, name: 'Ember' },
  { accent: 'cobalt', level: 20, name: 'Cobalt' },
  { accent: 'ivory', level: 30, name: 'Ivory' },
];
