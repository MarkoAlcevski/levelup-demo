import type { Measure, Outcome } from './types';

/**
 * The completion model.
 *
 *   KEPT    — you met at least the minimum bar. Drives consistency and streaks.
 *   CREDIT  — how much of the full commitment you executed, 0–1. Drives execution rate.
 *
 * A minimum win keeps your streak alive but never pretends to be full execution:
 *   check mission:     full = 1, minimum = 0.5
 *   measured mission:  credit = value / target (capped at 1); a 20-min minimum of a 60-min target = 0.33
 * Partial is effort below the minimum bar: recorded, credited proportionally, never "kept".
 * Exceeded earns bonus XP, never more than 100% credit — rates can't exceed 100%.
 */

export const KEPT_OUTCOMES: ReadonlySet<Outcome> = new Set(['exceeded', 'full', 'minimum']);

export function isKept(outcome: Outcome): boolean {
  return KEPT_OUTCOMES.has(outcome);
}

export interface OutcomeInput {
  measure: Measure;
  targetValue: number | null;
  minimumValue: number | null;
  exceedRatio: number;
}

/** Derives the outcome of a measured (duration/quantity) mission from the logged value. */
export function outcomeForValue(m: OutcomeInput, value: number): Outcome {
  if (!Number.isFinite(value) || value <= 0) return 'missed';
  const target = m.targetValue ?? 0;
  if (target <= 0) return 'full';
  if (value >= target * m.exceedRatio) return 'exceeded';
  if (value >= target) return 'full';
  if (m.minimumValue != null && value >= m.minimumValue) return 'minimum';
  return 'partial';
}

/** Credit for a completion. Deterministic; stored on the row and recomputable. */
export function creditFor(m: OutcomeInput, outcome: Outcome, value: number | null): number {
  if (outcome === 'missed' || outcome === 'skipped') return 0;
  if (m.measure === 'check' || m.targetValue == null || m.targetValue <= 0) {
    switch (outcome) {
      case 'exceeded':
      case 'full':
        return 1;
      case 'minimum':
        return 0.5;
      case 'partial':
        return 0.25;
    }
  }
  const target = m.targetValue as number;
  const v = value ?? (outcome === 'minimum' ? m.minimumValue ?? 0 : outcome === 'partial' ? 0 : target);
  return round3(Math.min(1, Math.max(0, v / target)));
}

/** The value a one-tap completion assumes for a measured mission. */
export function defaultValueFor(m: OutcomeInput, outcome: Outcome): number | null {
  if (m.measure === 'check') return null;
  if (outcome === 'minimum') return m.minimumValue ?? null;
  if (outcome === 'full') return m.targetValue;
  return null;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  exceeded: 'Exceeded',
  full: 'Full',
  minimum: 'Minimum',
  partial: 'Partial',
  missed: 'Missed',
  skipped: 'Excused',
};
