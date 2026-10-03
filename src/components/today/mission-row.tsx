'use client';

import { useRef } from 'react';
import { Camera, Images } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { fmtBare, fmtValue } from '@/lib/format';
import type { Outcome } from '@/lib/engine/types';
import type { TodayMission } from '@/lib/server/today';
import { Pips } from '@/components/viz/marks';
import { MissionCheck, type CheckState } from './mission-check';

export interface RowState {
  outcome: Outcome | null;
  value: number | null;
  kept: boolean;
  proofs: number;
  pending: boolean;
  completionId: string | null;
}

export function rowStateFrom(m: TodayMission): RowState {
  return {
    outcome: m.completion?.outcome ?? null,
    value: m.completion?.value ?? null,
    kept: !!m.completion?.kept,
    proofs: m.completion?.proofs ?? 0,
    pending: false,
    completionId: m.completion?.id ?? null,
  };
}

const OUTCOME_TAG: Partial<Record<Outcome, string>> = {
  exceeded: 'Exceeded',
  minimum: 'Minimum',
  partial: 'Partial',
  missed: 'Missed',
  skipped: 'Excused',
};

export function MissionRow({
  m,
  s,
  onToggle,
  onOpen,
  xpFlash,
  showCoach,
}: {
  m: TodayMission;
  s: RowState;
  onToggle: (m: TodayMission) => void;
  onOpen: (m: TodayMission, focus?: 'outcomes' | 'proof') => void;
  xpFlash: number | null;
  showCoach?: boolean;
}) {
  const press = useRef<{ t: ReturnType<typeof setTimeout> | null; long: boolean }>({ t: null, long: false });
  const checkState: CheckState = s.outcome ?? (m.status === 'overdue' ? 'overdue' : 'open');
  const progress = m.target && s.value != null ? s.value / m.target : 0;
  const done = s.outcome != null && s.outcome !== 'missed';

  const startPress = () => {
    press.current.long = false;
    press.current.t = setTimeout(() => {
      press.current.long = true;
      navigator.vibrate?.(12);
      onOpen(m, 'outcomes');
    }, 480);
  };
  const endPress = () => {
    if (press.current.t) clearTimeout(press.current.t);
    press.current.t = null;
  };

  const meta: string[] = [];
  if (m.status === 'overdue' && m.dueOn) meta.push(`Overdue · was due ${m.dueOn.slice(5).replace('-', '/')}`);
  else if (m.weekly) meta.push(`${Math.min(m.weekly.done, m.weekly.quota)} of ${m.weekly.quota} this week`);
  else if (m.isTask) meta.push(m.dueOn ? 'Task · due today' : 'Task');
  else meta.push(m.cadence);
  if (m.measure !== 'check' && m.minimum && !done) meta.push(`min ${fmtValue(m.minimum, m.unit)}`);
  if (m.minimumLabel && m.measure === 'check' && !done) meta.push(`min: ${m.minimumLabel}`);
  if (m.streak.current >= 3) meta.push(`${m.streak.current}-${m.streak.unit} streak`);

  return (
    <li className="relative">
      <div
        className={cn(
          'group flex min-h-[64px] items-center gap-1 rounded-[14px] transition-colors duration-200',
          s.pending && 'opacity-80',
        )}
      >
        <button
          type="button"
          onClick={() => {
            if (press.current.long) return;
            onToggle(m);
          }}
          onPointerDown={startPress}
          onPointerUp={endPress}
          onPointerLeave={endPress}
          onContextMenu={(e) => {
            e.preventDefault();
            onOpen(m, 'outcomes');
          }}
          aria-label={done ? `${m.title}: ${s.outcome}. Tap to undo.` : `Mark ${m.title} done`}
          aria-pressed={done}
          className="pressable relative -ml-2 grid size-12 shrink-0 place-items-center rounded-full"
        >
          <MissionCheck state={checkState} progress={progress} />
          {xpFlash != null && (
            <span key={xpFlash} className="xp-flash pointer-events-none absolute -top-2 left-1/2 text-xs font-semibold text-accent-text tnum">
              +{xpFlash}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => onOpen(m)}
          className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-1 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className={cn('truncate text-[16px] font-medium transition-colors duration-200', done ? 'text-ink-2' : 'text-ink')}>{m.title}</span>
              {s.outcome && OUTCOME_TAG[s.outcome] && (
                <span className={cn('shrink-0 rounded-[5px] px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.06em]', s.outcome === 'exceeded' ? 'bg-accent-soft text-accent-text' : 'bg-sunken text-ink-3')}>
                  {OUTCOME_TAG[s.outcome]}
                </span>
              )}
            </span>
            <span className={cn('mt-0.5 block truncate text-[13px]', m.status === 'overdue' && !done ? 'text-warn' : 'text-ink-3')}>{meta.join(' · ')}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2.5">
            {s.proofs > 0 ? (
              <span className="flex items-center gap-1 text-xs text-ink-3" aria-label={`${s.proofs} proof`}>
                <Images size={15} weight="fill" className="text-ink-2" /> {s.proofs > 1 ? s.proofs : ''}
              </span>
            ) : m.proofPolicy === 'required' || m.proofPolicy === 'recommended' ? (
              <Camera size={16} className={cn(m.proofPolicy === 'required' ? 'text-warn' : 'text-ink-3')} aria-label={m.proofPolicy === 'required' ? 'Proof required' : 'Proof recommended'} />
            ) : null}
            {m.measure !== 'check' && m.target != null ? (
              <span className="text-right text-[13px] tnum leading-tight">
                <span className={cn('font-medium', done ? 'text-ink' : 'text-ink-2')}>{fmtBare(s.value ?? 0)}</span>
                <span className="text-ink-3"> / {fmtBare(m.target)}</span>
                <span className="block text-[11px] text-ink-3">{m.unit}</span>
              </span>
            ) : m.weekly && m.weekly.quota > 1 ? (
              <Pips done={Math.min(m.weekly.done + (s.kept && !m.completion?.kept ? 1 : 0) - (!s.kept && m.completion?.kept ? 1 : 0), m.weekly.quota)} total={m.weekly.quota} />
            ) : null}
          </span>
        </button>
      </div>
      {showCoach && (
        <p className="coach pointer-events-none absolute -top-8 left-0 flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink shadow-pop">
          Tap the circle when it’s done
        </p>
      )}
      <style>{`
        .xp-flash { animation: xp-rise 900ms var(--ease-out) forwards; transform: translate(-50%, 0); }
        @keyframes xp-rise { 0% { opacity: 0; transform: translate(-50%, 6px); } 20% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -16px); } }
        .coach { animation: coach-bob 1.6s ease-in-out infinite; }
        @keyframes coach-bob { 50% { transform: translateY(-3px); } }
      `}</style>
    </li>
  );
}
