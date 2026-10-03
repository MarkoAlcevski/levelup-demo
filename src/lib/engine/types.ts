import type { ISODate } from './dates';

export type { ISODate };

/** gym · learning · custom for new areas; the rest are V1 kinds, still valid for existing data. */
export type AreaKind = 'gym' | 'learning' | 'custom' | 'money' | 'body' | 'work' | 'health' | 'relationships' | 'personal';
export type Measure = 'check' | 'duration' | 'quantity';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'extreme';
export type Outcome = 'exceeded' | 'full' | 'minimum' | 'partial' | 'missed' | 'skipped';
export type Cadence = 'daily' | 'weekly' | 'days' | 'once';
export type ProofPolicy = 'off' | 'optional' | 'recommended' | 'required';
export type MissReason =
  | 'no_time' | 'forgot' | 'low_energy' | 'unexpected' | 'procrastinated'
  | 'too_hard' | 'not_important' | 'rest' | 'sick' | 'travel' | 'other';

export interface ScheduleVersion {
  cadence: Cadence;
  perWeek: number | null;
  /** ISO weekdays, 1 = Monday … 7 = Sunday */
  weekdays: number[] | null;
  dueOn: ISODate | null;
  validFrom: ISODate;
  /** exclusive; null = still current */
  validTo: ISODate | null;
}

export interface MissionDef {
  id: string;
  areaId: string;
  title: string;
  measure: Measure;
  unit: string | null;
  targetValue: number | null;
  minimumValue: number | null;
  minimumLabel: string | null;
  exceedRatio: number;
  difficulty: Difficulty;
  isPriority: boolean;
  schedules: ScheduleVersion[];
}

export interface CompletionRec {
  id?: string;
  missionId: string;
  day: ISODate;
  outcome: Outcome;
  kept: boolean;
  credit: number;
  value: number | null;
  targetValue: number | null;
  difficulty: Difficulty;
  /** local hour the completion was logged, 0–23 (null for imported/seeded without time) */
  loggedHour: number | null;
  reason: MissReason | null;
}

export interface AreaDef {
  id: string;
  kind: AreaKind;
  name: string;
}
