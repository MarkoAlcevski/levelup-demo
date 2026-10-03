'use client';

import type { LastPerformance, SessionDetail, StartDay, WorkoutSummary } from '@/lib/server/gym';

/**
 * The workout lives on the phone first. Every change is written to localStorage immediately and
 * the whole workout is PUT to the server shortly after (idempotent full state). With no signal in
 * the gym nothing is lost: the draft stays local, retries on reconnect, and even "Finish" can be
 * queued. The server only ever sees complete, replayable snapshots.
 */

export interface DraftSet {
  id: string;
  position: number;
  weight: number | null;
  reps: number | null;
  kind: 'working' | 'warmup';
  done: boolean;
}

export interface DraftExercise {
  id: string;
  exerciseId: string | null;
  name: string;
  position: number;
  targetSets: number | null;
  repMin: number | null;
  repMax: number | null;
  restSeconds: number | null;
  defaultWeight: number | null;
  note: string | null;
  skipped: boolean;
  replacedName: string | null;
  sets: DraftSet[];
  last: LastPerformance | null;
}

export interface WorkoutDraft {
  id: string;
  name: string;
  workoutDayId: string | null;
  performedOn: string;
  startedAt: string;
  weightUnit: 'kg' | 'lb';
  note: string | null;
  exercises: DraftExercise[];
  status: 'active' | 'completed';
  editing: boolean;
  durationSeconds: number | null;
  savedAt: string | null;
  dirty: boolean;
  finishRequested: { note: string | null; durationSeconds: number | null } | null;
}

const PREFIX = 'kept_workout_';
const ACTIVE = 'kept_workout_active';

export function newId(): string {
  return crypto.randomUUID();
}

function blankSets(n: number): DraftSet[] {
  return Array.from({ length: Math.max(1, n) }, (_, i) => ({ id: newId(), position: i, weight: null, reps: null, kind: 'working' as const, done: false }));
}

export function draftFromTemplate(day: StartDay, last: Record<string, LastPerformance>, today: string, unit: 'kg' | 'lb'): WorkoutDraft {
  return {
    id: newId(),
    name: day.name,
    workoutDayId: day.id,
    performedOn: today,
    startedAt: new Date().toISOString(),
    weightUnit: unit,
    note: null,
    status: 'active',
    editing: false,
    durationSeconds: null,
    savedAt: null,
    dirty: true,
    finishRequested: null,
    exercises: day.exercises.map((e, i) => ({
      id: newId(),
      exerciseId: e.exerciseId,
      name: e.name,
      position: i,
      targetSets: e.sets,
      repMin: e.repMin,
      repMax: e.repMax,
      restSeconds: e.restSeconds,
      defaultWeight: e.weight,
      note: e.note,
      skipped: false,
      replacedName: null,
      sets: blankSets(e.sets),
      last: last[e.exerciseId] ?? null,
    })),
  };
}

export function emptyDraft(name: string, today: string, unit: 'kg' | 'lb'): WorkoutDraft {
  return {
    id: newId(), name, workoutDayId: null, performedOn: today, startedAt: new Date().toISOString(), weightUnit: unit, note: null,
    status: 'active', editing: false, durationSeconds: null, savedAt: null, dirty: true, finishRequested: null, exercises: [],
  };
}

/** A finished (or server-side active) session, turned back into an editable draft. */
export function draftFromSession(s: SessionDetail, last: Record<string, LastPerformance>, editing: boolean): WorkoutDraft {
  return {
    id: s.id,
    name: s.name,
    workoutDayId: s.workoutDayId,
    performedOn: s.performedOn,
    startedAt: s.startedAt,
    weightUnit: s.weightUnit,
    note: s.note,
    status: s.status,
    editing,
    durationSeconds: s.durationSeconds,
    savedAt: new Date().toISOString(),
    dirty: false,
    finishRequested: null,
    exercises: s.exercises.map((e) => ({
      id: e.id,
      exerciseId: e.exerciseId,
      name: e.name,
      position: e.position,
      targetSets: e.targetSets,
      repMin: e.repMin,
      repMax: e.repMax,
      restSeconds: e.restSeconds,
      defaultWeight: null,
      note: e.note,
      skipped: e.skipped,
      replacedName: e.replacedName,
      sets: e.sets.map((t) => ({ id: t.id, position: t.position, weight: t.weight, reps: t.reps, kind: t.kind, done: t.done })),
      last: e.exerciseId ? last[e.exerciseId] ?? null : null,
    })),
  };
}

export function saveDraft(d: WorkoutDraft): void {
  try {
    localStorage.setItem(PREFIX + d.id, JSON.stringify(d));
    if (d.status === 'active' && !d.editing) localStorage.setItem(ACTIVE, d.id);
  } catch {
    /* storage blocked — the server copy is still being synced */
  }
}

export function loadDraft(id: string): WorkoutDraft | null {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    return raw ? (JSON.parse(raw) as WorkoutDraft) : null;
  } catch {
    return null;
  }
}

export function activeDraft(): WorkoutDraft | null {
  try {
    const id = localStorage.getItem(ACTIVE);
    const d = id ? loadDraft(id) : null;
    return d && d.status === 'active' ? d : null;
  } catch {
    return null;
  }
}

export function clearDraft(id: string): void {
  try {
    localStorage.removeItem(PREFIX + id);
    if (localStorage.getItem(ACTIVE) === id) localStorage.removeItem(ACTIVE);
  } catch {
    /* ignore */
  }
}

export function toSnapshot(d: WorkoutDraft) {
  return {
    name: d.name,
    workoutDayId: d.workoutDayId,
    performedOn: d.performedOn,
    startedAt: d.startedAt,
    note: d.note,
    durationSeconds: d.editing ? d.durationSeconds : null,
    exercises: d.exercises.map((e, i) => ({
      id: e.id,
      exerciseId: e.exerciseId,
      name: e.name,
      position: i,
      targetSets: e.targetSets,
      repMin: e.repMin,
      repMax: e.repMax,
      restSeconds: e.restSeconds,
      note: e.note,
      skipped: e.skipped,
      replacedName: e.replacedName,
      sets: e.sets.map((s, j) => ({ id: s.id, position: j, weight: s.weight, reps: s.reps, kind: s.kind, done: s.done })),
    })),
  };
}

export type SyncState = 'saved' | 'saving' | 'offline' | 'error';

export async function syncDraft(d: WorkoutDraft): Promise<{ state: SyncState; error?: string }> {
  try {
    const res = await fetch(`/api/v1/workouts/${d.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toSnapshot(d)),
    });
    if (res.status === 401) return { state: 'error', error: 'You’re signed out.' };
    const body = (await res.json()) as { ok: boolean; error?: string };
    return body.ok ? { state: 'saved' } : { state: 'error', error: body.error };
  } catch {
    return { state: 'offline' };
  }
}

export async function finishDraft(d: WorkoutDraft, opts: { note: string | null; durationSeconds: number | null }): Promise<{ ok: true; summary: WorkoutSummary } | { ok: false; offline?: boolean; error: string }> {
  const sync = await syncDraft(d);
  if (sync.state === 'offline') return { ok: false, offline: true, error: 'No connection — the workout is saved on this phone and will finish when you’re back online.' };
  if (sync.state === 'error') return { ok: false, error: sync.error ?? 'Couldn’t save the workout.' };
  try {
    const res = await fetch(`/api/v1/workouts/${d.id}/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    return (await res.json()) as { ok: true; summary: WorkoutSummary } | { ok: false; error: string };
  } catch {
    return { ok: false, offline: true, error: 'No connection — the workout is saved on this phone and will finish when you’re back online.' };
  }
}

/** Replay anything left over from being offline: unsynced drafts, and finishes that were queued. */
export async function flushWorkouts(): Promise<number> {
  if (typeof window === 'undefined' || !navigator.onLine) return 0;
  let n = 0;
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
  } catch {
    return 0;
  }
  for (const k of keys) {
    const d = loadDraft(k.slice(PREFIX.length));
    if (!d) continue;
    if (d.finishRequested) {
      const r = await finishDraft(d, d.finishRequested);
      if (r.ok) {
        clearDraft(d.id);
        n++;
      }
    } else if (d.dirty) {
      const r = await syncDraft(d);
      if (r.state === 'saved') {
        saveDraft({ ...d, dirty: false, savedAt: new Date().toISOString() });
        n++;
      }
    }
  }
  return n;
}

// ───────────────────────────────────────────── rest timer preferences

const REST_KEY = 'kept_rest_timer';

export function restTimerEnabled(): boolean {
  try {
    return localStorage.getItem(REST_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setRestTimerEnabled(on: boolean): void {
  try {
    localStorage.setItem(REST_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}
