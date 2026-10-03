'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDown, ArrowUp, CaretLeft, Check, CloudCheck, CloudSlash, Copy, DotsThreeVertical, Minus, NotePencil, Plus, SkipForward, Swap, Timer, Trash, Trophy,
} from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/engine/dates';
import { displayWeight, fmtNum, type PersonalRecord } from '@/lib/engine/gym';
import type { LastPerformance, SessionDetail, WorkoutSummary } from '@/lib/server/gym';
import {
  clearDraft, draftFromSession, finishDraft, loadDraft, newId, restTimerEnabled, saveDraft, setRestTimerEnabled, syncDraft,
  type DraftExercise, type DraftSet, type SyncState, type WorkoutDraft,
} from '@/lib/client/workout';
import { compressImage, uploadProof } from '@/lib/client/api';
import { ensureExerciseAction, shareProofAction } from '@/lib/actions';
import { fmtMinutes } from '@/lib/format';
import { Button, Field, Input, Textarea } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { useViewerInfo } from '@/components/shell/viewer';
import { clock, useTicker } from '@/components/today/learning-card';
import { ExercisePicker, type PickedExercise } from './exercise-picker';

type Stage = 'loading' | 'missing' | 'logging' | 'summary';

/**
 * The workout screen. Every exercise, last time's numbers beside today's empty inputs, one tick
 * per set. Weight and reps are typed with the numeric keyboard; ticking a set with an empty field
 * confirms the number shown in it (last time's), which is the only "copy" that ever happens without
 * a tap on Copy. The rest timer starts itself and gets out of the way.
 */
export function WorkoutLogger({ id, edit }: { id: string; edit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const v = useViewerInfo();
  const [draft, setDraft] = useState<WorkoutDraft | null>(null);
  const [stage, setStage] = useState<Stage>('loading');
  const [sync, setSync] = useState<SyncState>('saved');
  const [menu, setMenu] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ mode: 'add' } | { mode: 'replace'; exId: string } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [summary, setSummary] = useState<WorkoutSummary | null>(null);
  const [rest, setRest] = useState<{ endsAt: number; total: number; name: string } | null>(null);
  const [timerOn, setTimerOn] = useState(true);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<WorkoutDraft | null>(null);

  // load: the phone's copy first; the server's if this is another device or an edit
  useEffect(() => {
    let alive = true;
    setTimerOn(restTimerEnabled());
    (async () => {
      const local = loadDraft(id);
      if (local && !edit) {
        if (alive) {
          setDraft(local);
          latest.current = local;
          setStage('logging');
        }
        return;
      }
      try {
        const res = await fetch(`/api/v1/workouts/${id}`);
        if (res.ok) {
          const body = (await res.json()) as { ok: true; session: SessionDetail; last: Record<string, LastPerformance> };
          const d = draftFromSession(body.session, body.last, edit || body.session.status === 'completed');
          if (!alive) return;
          if (d.status === 'completed' && !edit) {
            router.replace(`/gym/session/${id}`);
            return;
          }
          setDraft(d);
          latest.current = d;
          if (!edit) saveDraft(d);
          setStage('logging');
          return;
        }
      } catch {
        /* offline and nothing local */
      }
      if (alive) setStage('missing');
    })();
    return () => {
      alive = false;
    };
  }, [id, edit, router]);

  const pushSync = useCallback(async () => {
    const d = latest.current;
    if (!d) return;
    setSync('saving');
    const r = await syncDraft(d);
    setSync(r.state);
    if (r.state === 'saved') {
      const clean = { ...d, dirty: false, savedAt: new Date().toISOString() };
      if (!d.editing) saveDraft(clean);
    } else if (r.state === 'error' && r.error) {
      toast.show({ title: r.error, tone: 'error' });
    }
  }, [toast]);

  const update = useCallback(
    (fn: (d: WorkoutDraft) => WorkoutDraft) => {
      setDraft((cur) => {
        if (!cur) return cur;
        const next = { ...fn(cur), dirty: true };
        latest.current = next;
        if (!next.editing) saveDraft(next);
        return next;
      });
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => void pushSync(), edit ? 99_999_999 : 1200);
    },
    [pushSync, edit],
  );

  useEffect(() => {
    const onOnline = () => latest.current?.dirty && !edit && void pushSync();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [pushSync, edit]);

  // rest timer
  const now = useTicker(stage === 'logging');
  useEffect(() => {
    if (rest && now >= rest.endsAt) {
      navigator.vibrate?.([30, 60, 30]);
      setRest(null);
    }
  }, [now, rest]);

  const setEx = (exId: string, fn: (e: DraftExercise) => DraftExercise) =>
    update((d) => ({ ...d, exercises: d.exercises.map((e) => (e.id === exId ? fn(e) : e)) }));

  const unit = draft?.weightUnit ?? v.weightUnit;
  const totals = useMemo(() => {
    if (!draft) return { done: 0, sets: 0, exercises: 0, pendingValues: 0 };
    let sets = 0;
    let exercises = 0;
    let pendingValues = 0;
    for (const e of draft.exercises) {
      const n = e.sets.filter((s) => s.done && (s.reps ?? 0) > 0).length;
      sets += n;
      if (n) exercises++;
      pendingValues += e.sets.filter((s) => !s.done && (s.reps ?? 0) > 0).length;
    }
    const done = draft.exercises.filter((e) => e.skipped || (e.sets.length > 0 && e.sets.every((s) => s.done))).length;
    return { done, sets, exercises, pendingValues };
  }, [draft]);

  if (stage === 'loading') return <div className="mx-auto mt-10 h-64 w-full max-w-[680px] animate-pulse rounded-[16px] bg-sunken" aria-label="Loading workout" />;
  if (stage === 'missing' || !draft) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="text-lg font-semibold text-ink">This workout isn’t on this phone</p>
        <p className="mt-1 text-sm text-ink-3">It may have been finished or discarded on another device.</p>
        <Link href="/gym" className="pressable mt-5 inline-flex h-11 items-center rounded-[12px] bg-accent px-5 font-medium text-accent-ink">
          Back to Gym
        </Link>
      </div>
    );
  }

  if (stage === 'summary' && summary) return <Summary s={summary} unit={unit} onDone={() => router.push('/gym')} />;

  const elapsed = now - Date.parse(draft.startedAt);

  function tick(e: DraftExercise, idx: number) {
    const s = e.sets[idx];
    if (s.done) {
      setEx(e.id, (x) => ({ ...x, sets: x.sets.map((y, j) => (j === idx ? { ...y, done: false } : y)) }));
      return;
    }
    const last = e.last?.sets[idx];
    const prevWeight = idx > 0 ? e.sets[idx - 1].weight : null;
    const weight = s.weight ?? (last?.weight != null ? displayWeight(last.weight, e.last!.unit, unit) : e.defaultWeight ?? prevWeight);
    const reps = s.reps ?? last?.reps ?? null;
    if (reps == null || reps <= 0) {
      document.getElementById(`reps-${s.id}`)?.focus();
      toast.show({ title: 'Enter the reps first' });
      return;
    }
    setEx(e.id, (x) => ({ ...x, sets: x.sets.map((y, j) => (j === idx ? { ...y, weight, reps, done: true } : y)) }));
    navigator.vibrate?.(8);
    if (timerOn && e.restSeconds && e.restSeconds > 0 && !draft!.editing) setRest({ endsAt: Date.now() + e.restSeconds * 1000, total: e.restSeconds, name: e.name });
  }

  async function addPicked(p: PickedExercise) {
    let exerciseId = p.exerciseId;
    if (!exerciseId && p.catalogKey) {
      const res = await ensureExerciseAction(p.catalogKey).catch(() => null);
      exerciseId = res && res.ok ? res.id : null;
    }
    if (picker?.mode === 'replace') {
      const target = picker.exId;
      setEx(target, (x) => ({ ...x, exerciseId, name: p.name, replacedName: x.replacedName ?? x.name, last: null }));
    } else {
      update((d) => ({
        ...d,
        exercises: [
          ...d.exercises,
          {
            id: newId(), exerciseId, name: p.name, position: d.exercises.length, targetSets: 3, repMin: null, repMax: null, restSeconds: null,
            defaultWeight: null, note: null, skipped: false, replacedName: null, last: null,
            sets: Array.from({ length: 3 }, (_, i) => ({ id: newId(), position: i, weight: null, reps: null, kind: 'working' as const, done: false })),
          },
        ],
      }));
    }
  }

  return (
    <div className="mx-auto w-full max-w-[680px] pb-44">
      {/* sticky header */}
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 px-4 pt-[max(10px,env(safe-area-inset-top))] pb-2.5 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Link href={draft.editing ? `/gym/session/${draft.id}` : '/gym'} className="pressable -ml-2 grid size-11 place-items-center rounded-full text-ink-2 hover:bg-sunken" aria-label={draft.editing ? 'Cancel editing' : 'Back to Gym (workout keeps running)'}>
            <CaretLeft size={20} />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold tracking-[-0.015em] text-ink">{draft.name}</p>
            <p className="flex items-center gap-2 text-[12px] text-ink-3 tnum">
              {draft.editing ? `Editing · ${formatDay(draft.performedOn)}` : <span>{clock(elapsed)}</span>}
              <span aria-hidden>·</span>
              {totals.done}/{draft.exercises.length} exercises
              <span className="ml-1 inline-flex items-center gap-1" aria-live="polite">
                {sync === 'offline' ? (
                  <><CloudSlash size={13} className="text-warn" /> on this phone</>
                ) : sync === 'saving' ? (
                  'saving…'
                ) : sync === 'error' ? (
                  <span className="text-bad">not saved</span>
                ) : (
                  <><CloudCheck size={13} /> saved</>
                )}
              </span>
            </p>
          </div>
          {draft.editing ? (
            <Button
              size="sm"
              onClick={async () => {
                const r = await syncDraft(draft);
                if (r.state === 'saved') {
                  toast.show({ title: 'Workout updated', detail: 'Stats recalculated from the corrected sets.' });
                  router.push(`/gym/session/${draft.id}`);
                  router.refresh();
                } else toast.show({ title: r.state === 'offline' ? 'You’re offline — try again when connected.' : r.error ?? 'Couldn’t save.', tone: 'error' });
              }}
            >
              Save
            </Button>
          ) : (
            <Button size="sm" onClick={() => setFinishing(true)}>
              Finish
            </Button>
          )}
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
          <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${draft.exercises.length ? (totals.done / draft.exercises.length) * 100 : 0}%` }} />
        </div>
      </header>

      <div className="flex flex-col gap-4 px-4 pt-4">
        {draft.exercises.length === 0 && (
          <p className="rounded-[16px] border border-dashed border-line-strong px-5 py-8 text-center text-sm text-ink-3">Add your first exercise below.</p>
        )}
        {draft.exercises.map((e, i) =>
          e.skipped ? (
            <div key={e.id} className="flex min-h-12 items-center justify-between rounded-[14px] border border-line px-4 text-[15px] text-ink-3">
              <span className="line-through">{e.name}</span>
              <button type="button" onClick={() => setEx(e.id, (x) => ({ ...x, skipped: false }))} className="min-h-11 px-2 text-[13px] font-medium text-ink-2 hover:text-ink">
                Undo skip
              </button>
            </div>
          ) : (
            <ExerciseCard
              key={e.id}
              e={e}
              unit={unit}
              onTick={(idx) => tick(e, idx)}
              onChange={(fn) => setEx(e.id, fn)}
              onMenu={() => setMenu(e.id)}
              first={i === 0}
            />
          ),
        )}
        <Button variant="outline" size="lg" block onClick={() => setPicker({ mode: 'add' })}>
          <Plus size={18} /> Add exercise
        </Button>
      </div>

      {/* rest timer */}
      {rest && (
        <div className="fixed inset-x-0 z-40 px-4 bottom-[calc(76px+env(safe-area-inset-bottom))] lg:bottom-6">
          <div className="mx-auto flex max-w-[640px] items-center gap-3 rounded-[16px] border border-line-strong bg-raised px-4 py-3 shadow-pop">
            <Timer size={20} className="shrink-0 text-accent-text" />
            <div className="min-w-0 flex-1">
              <p className="text-[20px] font-semibold leading-none text-ink tnum">{clock(Math.max(0, rest.endsAt - now))}</p>
              <p className="mt-1 truncate text-[12px] text-ink-3">Rest · {rest.name}</p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sunken">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, ((rest.endsAt - now) / (rest.total * 1000)) * 100))}%` }} />
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setRest((r) => (r ? { ...r, endsAt: r.endsAt + 30_000, total: r.total + 30 } : r))}>
              +30s
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRest(null)}>
              Skip
            </Button>
          </div>
        </div>
      )}

      {/* exercise menu */}
      <ExerciseMenu
        e={draft.exercises.find((x) => x.id === menu) ?? null}
        index={draft.exercises.findIndex((x) => x.id === menu)}
        count={draft.exercises.length}
        timerOn={timerOn}
        onClose={() => setMenu(null)}
        onTimer={(on) => {
          setTimerOn(on);
          setRestTimerEnabled(on);
          if (!on) setRest(null);
        }}
        onChange={(fn) => menu && setEx(menu, fn)}
        onMove={(dir) =>
          update((d) => {
            const i = d.exercises.findIndex((x) => x.id === menu);
            const j = i + dir;
            if (i < 0 || j < 0 || j >= d.exercises.length) return d;
            const list = [...d.exercises];
            [list[i], list[j]] = [list[j], list[i]];
            return { ...d, exercises: list };
          })
        }
        onRemove={() => {
          update((d) => ({ ...d, exercises: d.exercises.filter((x) => x.id !== menu) }));
          setMenu(null);
        }}
        onReplace={() => {
          const exId = menu!;
          setMenu(null);
          setPicker({ mode: 'replace', exId });
        }}
      />

      <ExercisePicker open={!!picker} onClose={() => setPicker(null)} onPick={(p) => void addPicked(p)} title={picker?.mode === 'replace' ? 'Replace for this workout' : 'Add exercise'} />

      <FinishSheet
        open={finishing}
        draft={draft}
        totals={totals}
        elapsedMinutes={Math.max(1, Math.round(elapsed / 60000))}
        onClose={() => setFinishing(false)}
        onTickPending={() =>
          update((d) => ({ ...d, exercises: d.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ((s.reps ?? 0) > 0 && !s.done ? { ...s, done: true } : s)) })) }))
        }
        onDiscard={async () => {
          await fetch(`/api/v1/workouts/${draft.id}`, { method: 'DELETE' }).catch(() => null);
          clearDraft(draft.id);
          toast.show({ title: 'Workout discarded' });
          router.push('/gym');
          router.refresh();
        }}
        onSave={async (note, minutes) => {
          const d = { ...(latest.current ?? draft), note: note || null };
          latest.current = d;
          const res = await finishDraft(d, { note: note || null, durationSeconds: minutes * 60 });
          if (res.ok) {
            clearDraft(d.id);
            setSummary(res.summary);
            setFinishing(false);
            setStage('summary');
            router.refresh();
            return null;
          }
          if (res.offline) {
            saveDraft({ ...d, finishRequested: { note: note || null, durationSeconds: minutes * 60 } });
            toast.show({ title: 'Saved on this phone', detail: 'It finishes automatically when you’re back online.' });
            setFinishing(false);
            router.push('/gym');
            return null;
          }
          return res.error;
        }}
      />
    </div>
  );
}

function fmtLast(last: LastPerformance, unit: 'kg' | 'lb'): string {
  return last.sets.map((s) => `${s.weight != null ? fmtNum(displayWeight(s.weight, last.unit, unit)) : 'BW'}×${s.reps ?? '—'}`).join('  ');
}

function ExerciseCard({
  e,
  unit,
  onTick,
  onChange,
  onMenu,
  first,
}: {
  e: DraftExercise;
  unit: 'kg' | 'lb';
  onTick: (idx: number) => void;
  onChange: (fn: (e: DraftExercise) => DraftExercise) => void;
  onMenu: () => void;
  first: boolean;
}) {
  const range = e.repMin && e.repMax ? (e.repMin === e.repMax ? `${e.repMin}` : `${e.repMin}–${e.repMax}`) : e.repMin ? `${e.repMin}+` : e.repMax ? `≤${e.repMax}` : null;
  const lastW = (i: number) => {
    const s = e.last?.sets[i];
    return s?.weight != null ? displayWeight(s.weight, e.last!.unit, unit) : null;
  };
  const setField = (idx: number, field: 'weight' | 'reps', raw: string) => {
    const clean = raw.replace(',', '.');
    const val = clean === '' ? null : Number(clean);
    if (val != null && (!Number.isFinite(val) || val < 0)) return;
    onChange((x) => {
      const sets = x.sets.map((s, j) => (j === idx ? { ...s, [field]: field === 'reps' && val != null ? Math.round(val) : val } : s));
      // a weight typed into one set carries down to the empty sets below it (still unticked)
      if (field === 'weight' && val != null) for (let j = idx + 1; j < sets.length; j++) if (sets[j].weight == null && !sets[j].done) sets[j] = { ...sets[j], weight: val };
      return { ...x, sets };
    });
  };
  const copyLast = () =>
    onChange((x) => ({
      ...x,
      sets: (() => {
        const n = Math.max(x.sets.length, e.last?.sets.length ?? 0);
        return Array.from({ length: n }, (_, j) => {
          const cur: DraftSet = x.sets[j] ?? { id: newId(), position: j, weight: null, reps: null, kind: 'working', done: false };
          const l = e.last?.sets[j];
          if (cur.done || !l) return cur;
          return { ...cur, weight: cur.weight ?? (l.weight != null ? displayWeight(l.weight, e.last!.unit, unit) : null), reps: cur.reps ?? l.reps };
        });
      })(),
    }));

  return (
    <article aria-labelledby={`ex-${e.id}`} className="rounded-[16px] border border-line-strong bg-surface">
      <div className="flex items-start gap-2 px-4 pt-3.5">
        <div className="min-w-0 flex-1">
          <h2 id={`ex-${e.id}`} className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
            {e.name}
          </h2>
          <p className="text-[12px] text-ink-3">
            {[e.targetSets ? `${e.targetSets} sets` : null, range ? `${range} reps` : null, e.restSeconds ? `${Math.round(e.restSeconds / 6) / 10} min rest` : null, e.replacedName ? `instead of ${e.replacedName}` : null].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button type="button" onClick={onMenu} className="pressable -mr-2 -mt-1 grid size-11 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink" aria-label={`${e.name} options`}>
          <DotsThreeVertical size={20} weight="bold" />
        </button>
      </div>
      {e.note && <p className="mx-4 mt-2 rounded-[10px] bg-sunken px-3 py-2 text-[13px] text-ink-2">{e.note}</p>}
      {e.last ? (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-[10px] border border-line px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="label-mono">Last time · {formatDay(e.last.on)}</p>
            <p className="mt-0.5 truncate font-mono text-[13px] text-ink-2 tnum">{fmtLast(e.last, unit)}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={copyLast} aria-label={`Copy last time into ${e.name}`}>
            <Copy size={14} /> Copy
          </Button>
        </div>
      ) : (
        first && <p className="mx-4 mt-2 text-[12px] text-ink-3">First time logging this — today sets the baseline.</p>
      )}

      <div className="mt-3 grid grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)_52px] items-center gap-x-2 px-4 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3" aria-hidden>
        <span>Set</span>
        <span>{unit}</span>
        <span>Reps</span>
        <span className="text-center">Done</span>
      </div>
      <ol className="mt-1 flex flex-col px-4 pb-2">
        {e.sets.map((s, idx) => {
          const l = e.last?.sets[idx];
          const lw = lastW(idx);
          const phW = lw ?? e.defaultWeight ?? (idx > 0 ? e.sets[idx - 1].weight : null);
          const better = s.done && l && s.reps != null && ((s.weight ?? 0) > (lw ?? 0) || ((s.weight ?? 0) === (lw ?? 0) && s.reps > (l.reps ?? 0)));
          const worse = s.done && l && s.reps != null && !better && ((s.weight ?? 0) < (lw ?? 0) || ((s.weight ?? 0) === (lw ?? 0) && s.reps < (l.reps ?? 0)));
          return (
            <li key={s.id} className={cn('grid grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)_52px] items-center gap-x-2 py-1', s.done && 'opacity-95')}>
              <button
                type="button"
                onClick={() => onChange((x) => ({ ...x, sets: x.sets.map((y, j) => (j === idx ? { ...y, kind: y.kind === 'working' ? 'warmup' : 'working' } : y)) }))}
                className={cn('grid h-11 place-items-center rounded-[10px] font-mono text-[13px] tnum', s.kind === 'warmup' ? 'bg-warn/15 text-warn' : 'text-ink-2 hover:bg-sunken')}
                aria-label={`Set ${idx + 1}${s.kind === 'warmup' ? ', warm-up' : ''}. Tap to mark as ${s.kind === 'warmup' ? 'working set' : 'warm-up'}.`}
              >
                {s.kind === 'warmup' ? 'W' : idx + 1}
              </button>
              <input
                aria-label={`Set ${idx + 1} weight in ${unit}`}
                inputMode="decimal"
                enterKeyHint="next"
                value={s.weight ?? ''}
                placeholder={phW != null ? fmtNum(phW) : '—'}
                onChange={(ev) => setField(idx, 'weight', ev.target.value)}
                className={cn('h-11 w-full min-w-0 rounded-[10px] border bg-bg px-2.5 text-center text-[17px] font-medium text-ink tnum outline-none placeholder:text-ink-3/70 focus:border-accent-text', s.done ? 'border-transparent bg-accent-soft' : 'border-line-strong')}
              />
              <div className="relative">
                <input
                  id={`reps-${s.id}`}
                  aria-label={`Set ${idx + 1} reps`}
                  inputMode="numeric"
                  enterKeyHint="done"
                  value={s.reps ?? ''}
                  placeholder={l?.reps != null ? String(l.reps) : range ?? '—'}
                  onChange={(ev) => setField(idx, 'reps', ev.target.value.replace(/[^\d]/g, ''))}
                  className={cn('h-11 w-full min-w-0 rounded-[10px] border bg-bg px-2.5 text-center text-[17px] font-medium text-ink tnum outline-none placeholder:text-ink-3/70 focus:border-accent-text', s.done ? 'border-transparent bg-accent-soft' : 'border-line-strong')}
                />
                {(better || worse) && (
                  <span className={cn('pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[12px] font-semibold', better ? 'text-good' : 'text-ink-3')} aria-label={better ? 'better than last time' : 'below last time'}>
                    {better ? '↑' : '↓'}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onTick(idx)}
                aria-pressed={s.done}
                aria-label={s.done ? `Set ${idx + 1} done — tap to undo` : `Mark set ${idx + 1} done`}
                className={cn('pressable grid h-11 w-[52px] place-items-center rounded-[12px] border', s.done ? 'border-transparent bg-accent text-accent-ink' : 'border-line-strong text-ink-3 hover:border-ink-3')}
              >
                <Check size={20} weight="bold" />
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex gap-2 border-t border-line px-2 py-1">
        <button
          type="button"
          onClick={() =>
            onChange((x) => {
              const lastSet = x.sets.at(-1);
              return { ...x, sets: [...x.sets, { id: newId(), position: x.sets.length, weight: lastSet?.weight ?? null, reps: null, kind: 'working', done: false }] };
            })
          }
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink"
        >
          <Plus size={14} /> Add set
        </button>
        <button
          type="button"
          disabled={!e.sets.length}
          onClick={() => onChange((x) => ({ ...x, sets: x.sets.slice(0, -1) }))}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 text-[13px] font-medium text-ink-3 hover:text-ink disabled:opacity-40"
        >
          <Minus size={14} /> Remove set
        </button>
      </div>
    </article>
  );
}

function ExerciseMenu({
  e,
  index,
  count,
  timerOn,
  onClose,
  onTimer,
  onChange,
  onMove,
  onRemove,
  onReplace,
}: {
  e: DraftExercise | null;
  index: number;
  count: number;
  timerOn: boolean;
  onClose: () => void;
  onTimer: (on: boolean) => void;
  onChange: (fn: (e: DraftExercise) => DraftExercise) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onReplace: () => void;
}) {
  const [note, setNote] = useState('');
  useEffect(() => setNote(e?.note ?? ''), [e?.id, e?.note]);
  if (!e) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const item = 'flex min-h-12 w-full items-center gap-3 rounded-[12px] px-3 text-left text-[15px] text-ink hover:bg-sunken disabled:opacity-40';
  return (
    <Sheet open onClose={onClose} title={e.name} size="sm">
      <div className="flex flex-col gap-1 pt-1">
        <Field label="Note for this exercise" htmlFor="ex-note">
          <Textarea id="ex-note" value={note} onChange={(ev) => setNote(ev.target.value)} onBlur={() => onChange((x) => ({ ...x, note: note.trim() || null }))} maxLength={500} placeholder="Seat 4, grip, cues…" className="min-h-16" />
        </Field>
        <div className="mt-2 flex flex-col">
          <button type="button" className={item} onClick={onReplace}>
            <Swap size={18} className="text-ink-3" /> Replace for this workout
          </button>
          <button type="button" className={item} onClick={() => { onChange((x) => ({ ...x, skipped: true })); onClose(); }}>
            <SkipForward size={18} className="text-ink-3" /> Skip today
          </button>
          <button type="button" className={item} disabled={index <= 0} onClick={() => onMove(-1)}>
            <ArrowUp size={18} className="text-ink-3" /> Move up
          </button>
          <button type="button" className={item} disabled={index >= count - 1} onClick={() => onMove(1)}>
            <ArrowDown size={18} className="text-ink-3" /> Move down
          </button>
          <button type="button" className={item} onClick={() => onTimer(!timerOn)}>
            <Timer size={18} className="text-ink-3" /> Rest timer: {timerOn ? 'on' : 'off'}
          </button>
          <button type="button" className={cn(item, 'text-bad')} onClick={onRemove}>
            <Trash size={18} /> Remove from this workout
          </button>
        </div>
        <p className="mt-2 px-3 text-[12px] text-ink-3">Changes here affect this workout only. Edit the program to change future ones.</p>
      </div>
    </Sheet>
  );
}

function FinishSheet({
  open,
  draft,
  totals,
  elapsedMinutes,
  onClose,
  onTickPending,
  onSave,
  onDiscard,
}: {
  open: boolean;
  draft: WorkoutDraft;
  totals: { sets: number; exercises: number; pendingValues: number };
  elapsedMinutes: number;
  onClose: () => void;
  onTickPending: () => void;
  onSave: (note: string, minutes: number) => Promise<string | null>;
  onDiscard: () => void;
}) {
  const [note, setNote] = useState(draft.note ?? '');
  const [minutes, setMinutes] = useState(String(elapsedMinutes));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => {
    if (open) {
      setMinutes(String(Math.min(360, elapsedMinutes)));
      setError(null);
      setConfirmDiscard(false);
    }
  }, [open, elapsedMinutes]);
  return (
    <Sheet open={open} onClose={onClose} title={`Finish ${draft.name}`}>
      <div className="flex flex-col gap-4 pt-1">
        <dl className="grid grid-cols-3 gap-3">
          {[
            ['Exercises', totals.exercises],
            ['Sets', totals.sets],
            ['Minutes', minutes || '—'],
          ].map(([k, val]) => (
            <div key={k as string} className="rounded-[12px] bg-sunken px-3 py-2.5">
              <dt className="label-mono">{k}</dt>
              <dd className="mt-0.5 text-[22px] font-semibold text-ink tnum">{val}</dd>
            </div>
          ))}
        </dl>
        {totals.pendingValues > 0 && (
          <div className="flex items-center gap-3 rounded-[12px] border border-warn/30 bg-warn/8 px-3.5 py-2.5">
            <p className="flex-1 text-[13px] text-ink-2">
              {totals.pendingValues} set{totals.pendingValues === 1 ? ' has' : 's have'} numbers but no tick — unticked sets aren’t saved.
            </p>
            <Button size="sm" variant="secondary" onClick={onTickPending}>
              Tick them
            </Button>
          </div>
        )}
        <Field label="Duration (minutes)" htmlFor="fin-min">
          <Input id="fin-min" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, ''))} />
        </Field>
        <Field label="Note" htmlFor="fin-note">
          <Textarea id="fin-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="How it went. Optional." className="min-h-20" />
        </Field>
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        <Button
          size="lg"
          block
          loading={busy}
          disabled={totals.sets === 0 && totals.pendingValues === 0}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const m = Math.max(1, Math.min(1440, Number(minutes) || elapsedMinutes));
            const err = await onSave(note, m);
            setBusy(false);
            if (err) setError(err);
          }}
        >
          Save workout
        </Button>
        {totals.sets === 0 && <p className="-mt-2 text-center text-[13px] text-ink-3">Tick at least one set to save the workout.</p>}
        {confirmDiscard ? (
          <div className="flex items-center gap-2">
            <p className="flex-1 text-[13px] text-ink-2">Discard this workout? The sets you logged are deleted.</p>
            <Button size="sm" variant="danger" onClick={onDiscard}>
              Discard
            </Button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDiscard(true)} className="self-center text-[13px] text-ink-3 hover:text-bad">
            Discard workout
          </button>
        )}
      </div>
    </Sheet>
  );
}

function recordLine(r: PersonalRecord, unit: 'kg' | 'lb'): string {
  const w = (kg: number | null) => (kg == null ? '' : `${fmtNum(unit === 'kg' ? Math.round(kg * 10) / 10 : Math.round((kg / 0.45359237) * 4) / 4)} ${unit}`);
  if (r.kind === 'weight') return `Heaviest ${r.name}: ${w(r.weightKg)} × ${r.reps}`;
  if (r.kind === 'reps') return `Most reps on ${r.name} at ${w(r.weightKg)}: ${r.reps} (was ${r.previous})`;
  return `Most volume in ${r.name}: ${w(r.value)}`;
}

function Summary({ s, unit, onDone }: { s: WorkoutSummary; unit: 'kg' | 'lb'; onDone: () => void }) {
  const toast = useToast();
  const [uploading, setUploading] = useState<number | null>(null);
  const [proofs, setProofs] = useState(0);
  const [shareGroups, setShareGroups] = useState<{ groupId: string; name: string }[]>([]);
  const [proofId, setProofId] = useState<string | null>(null);
  const cam = useRef<HTMLInputElement>(null);
  const vol = unit === 'kg' ? s.volumeKg : s.volumeKg / 0.45359237;

  async function send(file: File) {
    if (!s.completionId) {
      toast.show({ title: 'This workout is more than 14 days old — proof can’t be attached.', tone: 'error' });
      return;
    }
    setUploading(0);
    const blob = await compressImage(file);
    const form = new FormData();
    form.set('kind', 'file');
    form.set('completionId', s.completionId);
    form.set('file', blob, file.name || 'proof');
    const res = (await uploadProof(form, setUploading)) as Awaited<ReturnType<typeof uploadProof>> & { shareGroups?: { groupId: string; name: string }[] };
    setUploading(null);
    if (!res.ok) return toast.show({ title: res.error, tone: 'error' });
    setProofs((n) => n + 1);
    setProofId(res.proof.id);
    setShareGroups(res.shareGroups ?? []);
    toast.show({ title: 'Photo added', tone: 'accent' });
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col px-5 pt-[max(28px,env(safe-area-inset-top))] pb-40">
      <p className="label-mono text-accent-text">Workout complete</p>
      <h1 className="mt-2 text-[34px] font-semibold leading-tight tracking-[-0.035em] text-ink">{s.name}</h1>
      <dl className="mt-6 grid grid-cols-2 gap-3">
        {[
          ['Time', fmtMinutes(s.durationSeconds / 60)],
          ['Sets', String(s.sets)],
          ['Exercises', String(s.exercises)],
          ['Volume', vol ? `${fmtNum(Math.round(vol))} ${unit}` : '—'],
        ].map(([k, val]) => (
          <div key={k} className="rounded-[14px] border border-line bg-surface px-4 py-3">
            <dt className="label-mono">{k}</dt>
            <dd className="mt-1 text-[26px] font-semibold tracking-[-0.03em] text-ink tnum">{val}</dd>
          </div>
        ))}
      </dl>
      {s.records.length > 0 && (
        <section aria-label="Personal records" className="mt-5 rounded-[14px] border border-accent/30 bg-accent-soft px-4 py-3.5">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Trophy size={18} weight="fill" className="text-accent-text" /> {s.records.length} personal record{s.records.length === 1 ? '' : 's'}
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-[14px] text-ink-2">
            {s.records.map((r) => (
              <li key={r.key + r.kind}>{recordLine(r, unit)}</li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-5 text-[15px] text-ink-2">
        {s.week.target != null ? `${s.week.done} of ${s.week.target} workouts this week.` : `${s.week.done} workouts this week.`}
        {s.points > 0 ? ` +${s.points} points.` : ''}
      </p>

      <div className="mt-6 flex flex-col gap-2">
        <input ref={cam} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={(e) => e.target.files?.[0] && void send(e.target.files[0])} />
        <Button variant="outline" block onClick={() => cam.current?.click()} loading={uploading != null}>
          {proofs ? `Add another photo (${proofs} added)` : 'Add a photo'}
        </Button>
        {shareGroups.map((g) => (
          <Button
            key={g.groupId}
            variant="secondary"
            block
            onClick={async () => {
              if (!proofId) return;
              const r = await shareProofAction(g.groupId, proofId, true);
              toast.show(r.ok ? { title: `Shared with ${g.name}` } : { title: r.error, tone: 'error' });
              setShareGroups((x) => x.filter((y) => y.groupId !== g.groupId));
            }}
          >
            Share photo with {g.name}
          </Button>
        ))}
        <p className="text-[12px] text-ink-3">Photos are private unless you share them with a group.</p>
      </div>
      <Button size="lg" block className="mt-auto" onClick={onDone}>
        Done
      </Button>
      <Link href={`/journal/${s.performedOn}`} className="mt-3 inline-flex min-h-11 items-center justify-center gap-1.5 text-[13px] font-medium text-ink-3 hover:text-ink">
        <NotePencil size={14} /> Write about it in your journal
      </Link>
    </div>
  );
}
