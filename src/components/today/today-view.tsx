'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Barbell, BookOpenText, CaretDown, CloudSlash, Fire, Lightning, Notebook as NotebookIcon, SquaresFour, Wallet } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { levelFromXp } from '@/lib/engine/xp';
import type { MissReason, Outcome } from '@/lib/engine/types';
import type { RingSegment, TodayData, TodayMission } from '@/lib/server/today';
import type { ProofView } from '@/lib/server/proofs';
import { deleteCompletion, flushQueue, putCompletion, queuedCount } from '@/lib/client/api';
import { flushWorkouts } from '@/lib/client/workout';
import { trackAction } from '@/lib/actions';
import { useToast } from '@/components/ui/toast';
import { AreaIcon } from '@/components/icons';
import { ProfileButton } from '@/components/shell/viewer';
import { MissionRow, rowStateFrom, type RowState } from './mission-row';
import { MissionSheet } from './mission-sheet';
import type { QuestDay } from '@/lib/server/quests';
import { QuestCard } from '@/components/quests/quest-card';
import { FocusCard } from './keystone-card';
import { Celebration, type CelebrationEvent } from './celebration';
import { GymCard } from './gym-card';
import { LearningCard } from './learning-card';

const KEPT: ReadonlySet<Outcome> = new Set(['exceeded', 'full', 'minimum']);

/**
 * Today answers one question — what do I need to do today? — and nothing else competes with it.
 * Scores and momentum live in Progress; points show up as feedback when something is done.
 */
export function TodayView({ data, quests }: { data: TodayData; quests?: QuestDay | null }) {
  const router = useRouter();
  const toast = useToast();
  const rows = useMemo(() => [...data.groups.flatMap((g) => g.missions), ...data.anyDay, ...data.done], [data]);

  // server truth + optimistic overrides (cleared once the server agrees)
  const [overrides, setOverrides] = useState<Record<string, RowState>>({});
  const pendingIds = useRef(new Set<string>());
  useEffect(() => {
    setOverrides((prev) => {
      const next: Record<string, RowState> = {};
      for (const [id, st] of Object.entries(prev)) if (pendingIds.current.has(id)) next[id] = st;
      return next;
    });
  }, [data]);
  const state = useCallback((m: TodayMission): RowState => overrides[m.id] ?? rowStateFrom(m), [overrides]);

  const [xpTotal, setXpTotal] = useState(data.level.xp);
  useEffect(() => setXpTotal(data.level.xp), [data.level.xp]);
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [celebrate, setCelebrate] = useState<CelebrationEvent | null>(null);
  const [sheet, setSheet] = useState<{ id: string; focus?: 'outcomes' | 'proof' } | null>(null);
  const [showDone, setShowDone] = useState(false);
  const hasOtherItems = data.groups.length > 0 || !!data.gym || data.learning.length > 0;
  const [showAnyDay, setShowAnyDay] = useState(!hasOtherItems);
  const [queued, setQueued] = useState(0);

  // offline: count queued taps + workouts, replay on reconnect
  useEffect(() => {
    setQueued(queuedCount());
    const onQueue = (e: Event) => setQueued((e as CustomEvent<number>).detail);
    const onOnline = async () => {
      const n = (await flushQueue()) + (await flushWorkouts());
      if (n) {
        toast.show({ title: `Synced ${n} offline ${n === 1 ? 'entry' : 'entries'}` });
        void trackAction('offline_replayed', { count: n });
        router.refresh();
      }
    };
    window.addEventListener('kept:queue', onQueue);
    window.addEventListener('online', onOnline);
    void onOnline();
    void trackAction('app_opened', { surface: 'today' });
    return () => {
      window.removeEventListener('kept:queue', onQueue);
      window.removeEventListener('online', onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the day's progress: routines/tasks due today or done today (live, optimistic) + Gym and Learning
  const { done, total, segments } = useMemo(() => {
    let d = data.moduleProgress.done;
    let t = data.moduleProgress.total;
    const segs: RingSegment[] = [];
    for (const m of rows) {
      const s = state(m);
      const doneToday = s.outcome != null && s.outcome !== 'missed';
      if (!(m.inRing || doneToday)) continue;
      if (s.outcome === 'skipped') {
        segs.push('excused');
        continue;
      }
      t++;
      if (s.kept) d++;
      segs.push(s.outcome ?? 'open');
    }
    return { done: d, total: t, segments: [...segs, ...data.moduleProgress.segments] };
  }, [data.moduleProgress, rows, state]);

  const apply = useCallback(
    async (m: TodayMission, outcome: Outcome | null, value?: number | null, reason?: MissReason | null) => {
      const before = state(m);
      const optimistic: RowState = outcome
        ? {
            ...before,
            outcome,
            kept: KEPT.has(outcome),
            value: value ?? (m.measure !== 'check' ? (outcome === 'minimum' ? m.minimum : outcome === 'exceeded' ? Math.ceil((m.target ?? 0) * m.exceedRatio) : m.target) : null),
            pending: true,
          }
        : { ...before, outcome: null, kept: false, value: null, pending: true, completionId: null, proofs: 0 };
      pendingIds.current.add(m.id);
      setOverrides((o) => ({ ...o, [m.id]: optimistic }));
      if (outcome && KEPT.has(outcome)) navigator.vibrate?.(8);

      if (!outcome) {
        const res = await deleteCompletion(m.id, data.today);
        pendingIds.current.delete(m.id);
        if (!res.ok) {
          setOverrides((o) => ({ ...o, [m.id]: before }));
          toast.show({ title: res.error ?? 'Couldn’t undo.', tone: 'error' });
          return;
        }
        if (res.xpTotal != null && !res.queued) setXpTotal(res.xpTotal);
        setOverrides((o) => ({ ...o, [m.id]: { ...optimistic, pending: false } }));
        router.refresh();
        return;
      }

      const res = await putCompletion({ missionId: m.id, day: data.today, outcome, value: value ?? undefined, reason: reason ?? undefined });
      pendingIds.current.delete(m.id);
      if (!res.ok) {
        setOverrides((o) => ({ ...o, [m.id]: before }));
        toast.show({ title: 'error' in res ? res.error : 'Couldn’t save.', tone: 'error' });
        return;
      }
      if ('queued' in res) {
        setOverrides((o) => ({ ...o, [m.id]: { ...optimistic, pending: false } }));
        toast.show({ title: 'Saved offline', detail: 'It syncs when you’re back online.' });
        return;
      }
      setOverrides((o) => ({ ...o, [m.id]: { ...optimistic, outcome: res.outcome, kept: res.kept, value: res.value, pending: false, completionId: res.completionId } }));
      if (res.xpGained > 0) setFlash((f) => ({ ...f, [m.id]: res.xpGained }));
      setXpTotal(res.xpTotal);
      if (res.levelAfter > res.levelBefore) setCelebrate({ kind: 'level', from: res.levelBefore, to: res.levelAfter, xp: res.xpTotal });

      if (res.kept) {
        toast.show({
          title: `${m.title}${res.outcome === 'minimum' ? ' · minimum' : res.outcome === 'exceeded' ? ' · exceeded' : ''} — done`,
          detail: [res.xpGained > 0 ? `+${res.xpGained} points` : null, res.quotaMet && m.weekly ? `Week target hit (${m.weekly.quota}×)` : null].filter(Boolean).join(' · ') || undefined,
          actions: [
            { label: 'Undo', onClick: () => void apply(m, null) },
            ...(m.proofPolicy !== 'off' ? [{ label: 'Add proof', primary: m.proofPolicy === 'recommended' && before.proofs === 0, onClick: () => setSheet({ id: m.id, focus: 'proof' as const }) }] : []),
          ],
        });
      } else if (res.outcome === 'skipped') {
        toast.show({ title: `${m.title} excused`, detail: 'Doesn’t count against you.', actions: [{ label: 'Undo', onClick: () => void apply(m, null) }] });
      } else if (res.outcome === 'missed') {
        toast.show({ title: `${m.title} marked missed`, detail: 'Noted for your weekly report.' });
      } else if (res.outcome === 'partial') {
        toast.show({ title: `${m.title} · partial`, detail: 'Logged. Below the minimum, so it doesn’t keep the streak.' });
      }
      router.refresh();
    },
    [state, data.today, toast, router],
  );

  const onToggle = (m: TodayMission) => {
    const s = state(m);
    if (s.pending) return;
    if (m.proofPolicy === 'required' && !s.outcome) {
      setSheet({ id: m.id, focus: 'proof' });
      return;
    }
    void apply(m, s.outcome ? null : 'full');
  };

  const onProof = (m: TodayMission, _p: ProofView) => {
    setOverrides((o) => {
      const cur = o[m.id] ?? rowStateFrom(m);
      return { ...o, [m.id]: { ...cur, outcome: cur.outcome ?? 'full', kept: cur.outcome ? cur.kept : true, proofs: cur.proofs + 1, pending: false } };
    });
    router.refresh();
  };

  const level = levelFromXp(xpTotal);
  const sheetMission = sheet ? rows.find((m) => m.id === sheet.id) ?? null : null;
  const firstOpen = data.firstDay ? data.groups.flatMap((g) => g.missions).find((m) => !state(m).outcome) : undefined;
  const left = Math.max(0, total - done);
  const setupCards = [
    data.setup.gym && { href: '/gym', Icon: Barbell, title: 'Build your training plan', body: 'Your days, your exercises. Nothing is prescribed.' },
    data.setup.learning && { href: '/learning', Icon: BookOpenText, title: 'What are you learning?', body: 'Add a subject and the weekly target you want.' },
    data.setup.money && { href: '/money/accounts', Icon: Wallet, title: 'Add your first account', body: 'Cash, a bank, Wise, Revolut — any currency.' },
    data.setup.areas && !data.modules.length && { href: '/areas', Icon: SquaresFour, title: 'Create an area', body: 'Business, Faith, Coding — whatever you want to keep doing.' },
  ].filter(Boolean) as { href: string; Icon: typeof Barbell; title: string; body: string }[];
  const nothingPlanned = !data.gym && !data.learning.length && !data.groups.length && !data.anyDay.length && !data.done.length;

  return (
    <div className="mx-auto w-full max-w-[680px] px-4 pt-[max(20px,env(safe-area-inset-top))] pb-40 lg:max-w-[720px] lg:px-10 lg:pt-10 lg:pb-16">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="label-mono">{data.dateLabel}</p>
          <h1 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink">
            {data.greeting}
            {data.name ? `, ${data.name}` : ''}
          </h1>
        </div>
        <ProfileButton size={44} className="shrink-0 lg:hidden" />
      </header>

      {/* the day, in one line */}
      <section aria-label="Today’s progress" data-tour="today" className="mt-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="label-mono">Today</p>
            <p className="mt-1 text-[40px] font-semibold leading-none tracking-[-0.04em] text-ink tnum">
              {done}
              <span className="text-ink-3"> / {total}</span>
              <span className="ml-2 text-[15px] font-medium tracking-normal text-ink-3">done</span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 pb-1">
            {data.streak > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-xs font-medium text-ink-2">
                <Fire size={13} weight="fill" className="text-accent-text" /> {data.streak}-day streak
              </span>
            )}
            {queued > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-xs text-ink-2">
                <CloudSlash size={13} /> {queued} waiting to sync
              </span>
            )}
          </div>
        </div>
        <DayBar segments={segments} />
        <p className="mt-2 text-sm text-ink-3">
          {total === 0
            ? nothingPlanned ? 'Nothing planned for today yet.' : 'Nothing required today — anything below still counts.'
            : left === 0
              ? 'Everything planned for today is done.'
              : `${left} left today`}
        </p>
      </section>

      <div className="mt-6 flex flex-col gap-3">
        <FocusCard focus={data.focus} weekNumber={data.weekNumber} daysLeft={data.daysLeftInWeek} onDone={(title, xp) => {
          setCelebrate({ kind: 'keystone', title, xp });
          setXpTotal((x) => x + xp);
        }} />
        {data.journal.plan && (
          <Link href={`/journal/${data.today}`} className="pressable block rounded-[14px] border border-line px-4 py-3 hover:border-line-strong">
            <span className="label-mono">What you wanted to do today</span>
            <span className="mt-1 line-clamp-3 block whitespace-pre-line text-[15px] leading-6 text-ink-2">{data.journal.plan}</span>
          </Link>
        )}
        {quests && <QuestCard day={quests} />}
        {data.reviewReady && (
          <Link href={`/review/${data.reviewReady.id}`} className="pressable flex min-h-12 items-center gap-3 rounded-[14px] border border-line px-4 py-3 hover:border-line-strong">
            <Lightning size={18} weight="fill" className="shrink-0 text-accent-text" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-ink">Your report is ready</span>
              <span className="block text-[13px] text-ink-3">{data.reviewReady.label}</span>
            </span>
            <ArrowRight size={16} className="text-ink-3" />
          </Link>
        )}
      </div>

      {setupCards.length > 0 && (
        <section aria-label="Set up" className="mt-8">
          <ul className="flex flex-col divide-y divide-line rounded-[16px] border border-line">
            {setupCards.map(({ href, Icon, title, body }) => (
              <li key={href}>
                <Link href={href} className="flex min-h-16 items-center gap-3.5 px-4 py-3 hover:bg-sunken/50">
                  <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-accent-soft text-accent-text">
                    <Icon size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-ink">{title}</span>
                    <span className="block text-[13px] text-ink-3">{body}</span>
                  </span>
                  <ArrowRight size={16} className="shrink-0 text-ink-3" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 flex flex-col gap-8">
        {data.gym && <GymCard gym={data.gym} today={data.today} missionId={data.gymMissionId} />}
        {data.learning.length > 0 && <LearningCard subjects={data.learning} today={data.today} />}

        {data.groups.map((g) => (
          <section key={g.id} aria-labelledby={`g-${g.id}`}>
            <h2 id={`g-${g.id}`} className="label-mono mb-1 flex items-center gap-2">
              <AreaIcon kind={g.kind} icon={g.icon} size={13} />
              {g.name}
            </h2>
            <ul className="flex flex-col divide-y divide-line">
              {g.missions.map((m) => (
                <MissionRow
                  key={m.id}
                  m={m}
                  s={state(m)}
                  onToggle={onToggle}
                  onOpen={(mm, focus) => setSheet({ id: mm.id, focus })}
                  xpFlash={flash[m.id] ?? null}
                  showCoach={firstOpen?.id === m.id}
                />
              ))}
            </ul>
          </section>
        ))}

        {data.anyDay.length > 0 && (
          <section aria-labelledby="g-any">
            <button
              id="g-any"
              type="button"
              aria-expanded={showAnyDay}
              onClick={() => setShowAnyDay((v) => !v)}
              className="label-mono flex min-h-11 w-full items-center gap-2 text-left hover:text-ink-2"
            >
              Any day this week · {data.anyDay.length}
              <span className="ml-auto normal-case tracking-normal">{data.daysLeftInWeek} {data.daysLeftInWeek === 1 ? 'day' : 'days'} left</span>
              <CaretDown size={12} className={cn('transition-transform duration-200', showAnyDay && 'rotate-180')} />
            </button>
            {showAnyDay && (
              <ul className="flex flex-col divide-y divide-line">
                {data.anyDay.map((m) => (
                  <MissionRow key={m.id} m={m} s={state(m)} onToggle={onToggle} onOpen={(mm, focus) => setSheet({ id: mm.id, focus })} xpFlash={flash[m.id] ?? null} />
                ))}
              </ul>
            )}
          </section>
        )}

        {data.done.length > 0 && (
          <section aria-labelledby="g-done">
            <button
              id="g-done"
              type="button"
              aria-expanded={showDone}
              onClick={() => setShowDone((v) => !v)}
              className="label-mono flex min-h-11 w-full items-center gap-2 text-left hover:text-ink-2"
            >
              Done · {data.done.length}
              <CaretDown size={12} className={cn('ml-auto transition-transform duration-200', showDone && 'rotate-180')} />
            </button>
            {showDone && (
              <ul className="flex flex-col divide-y divide-line">
                {data.done.map((m) => (
                  <MissionRow key={m.id} m={m} s={state(m)} onToggle={onToggle} onOpen={(mm, focus) => setSheet({ id: mm.id, focus })} xpFlash={flash[m.id] ?? null} />
                ))}
              </ul>
            )}
          </section>
        )}

        {nothingPlanned && !setupCards.length && (
          <div className="rounded-[16px] border border-dashed border-line-strong px-6 py-8 text-center">
            <p className="font-semibold text-ink">A clear day</p>
            <p className="mt-1 text-sm text-ink-3">Add a task or a routine to one of your areas and it shows up here.</p>
            <Link href="/areas" className="pressable mt-4 inline-flex h-11 items-center rounded-[12px] bg-accent px-5 font-medium text-accent-ink">
              Go to Areas
            </Link>
          </div>
        )}

        <Link href={`/journal/${data.today}`} className="group flex min-h-14 items-center gap-3 border-t border-line pt-5">
          <NotebookIcon size={20} className="shrink-0 text-ink-3 group-hover:text-ink" />
          <span className="min-w-0 flex-1">
            <span className="label-mono block">Journal</span>
            <span className="block text-[15px] text-ink-2 group-hover:text-ink">{data.journal.written ? 'Today’s page — keep writing' : 'Write about today'}</span>
          </span>
          <ArrowRight size={16} className="text-ink-3" />
        </Link>
      </div>

      <MissionSheet
        mission={sheetMission}
        state={sheetMission ? state(sheetMission) : null}
        day={data.today}
        open={!!sheetMission}
        focus={sheet?.focus}
        onClose={() => setSheet(null)}
        onSubmit={(m, outcome, value, reason) => {
          setSheet(null);
          void apply(m, outcome, value, reason);
        }}
        onUndo={(m) => {
          setSheet(null);
          void apply(m, null);
        }}
        onProof={onProof}
      />
      <Celebration event={celebrate} onDone={() => setCelebrate(null)} />
      <span className="sr-only" aria-live="polite">
        Level {level.level}
      </span>
    </div>
  );
}

/** One thin segment per thing planned today; state is carried by fill and opacity, not colour alone. */
function DayBar({ segments }: { segments: RingSegment[] }) {
  if (!segments.length) return <div className="mt-4 h-2 rounded-full bg-sunken" aria-hidden />;
  return (
    <div className="mt-4 flex gap-[3px]" role="img" aria-label={`${segments.filter((s) => s === 'full' || s === 'exceeded' || s === 'minimum').length} of ${segments.filter((s) => s !== 'excused').length} done`}>
      {segments.map((s, i) => (
        <span
          key={i}
          className={cn(
            'h-2 flex-1 rounded-full transition-colors duration-300',
            s === 'full' || s === 'exceeded' ? 'bg-accent' : s === 'minimum' ? 'bg-accent/55' : s === 'partial' ? 'bg-accent/25' : s === 'missed' ? 'bg-bad/50' : s === 'excused' ? 'border border-dashed border-ink-3' : 'bg-sunken',
          )}
        />
      ))}
    </div>
  );
}
