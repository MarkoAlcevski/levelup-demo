'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Plus, Stop, Trash } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/engine/dates';
import { SUBJECT_EXAMPLES } from '@/lib/modules';
import type { LearningHome, SubjectView } from '@/lib/server/learning';
import { adoptRoutineAction, archiveSubjectAction, createSubjectAction, deleteLearningAction, startLearningAction, updateSubjectAction } from '@/lib/actions';
import { fmtMinutes, fmtPct } from '@/lib/format';
import { Button, Field, Input } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { Meter } from '@/components/viz/marks';
import { Bars } from '@/components/viz/bars';
import { useToast } from '@/components/ui/toast';
import { clock, useTicker } from '@/components/today/learning-card';
import { SessionSheet, fmtAmount, unitWord } from './session-sheet';

type Measure = SubjectView['measure'];
const MEASURES: { value: Measure; label: string; hint: string }[] = [
  { value: 'minutes', label: 'Minutes', hint: 'Time a week' },
  { value: 'sessions', label: 'Sessions', hint: 'How many a week' },
  { value: 'pages', label: 'Pages', hint: 'Pages a week' },
  { value: 'lessons', label: 'Lessons', hint: 'Lessons a week' },
  { value: 'custom', label: 'Your own unit', hint: 'Problems, chapters…' },
];

export function LearningView({ data }: { data: LearningHome }) {
  const [editing, setEditing] = useState<SubjectView | 'new' | null>(data.subjects.length ? null : 'new');
  const [log, setLog] = useState<{ subjectId?: string; finishing?: { id: string; startedAt: string } } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const now = useTicker(!!data.active);
  const lite = data.subjects.map((s) => ({ id: s.id, name: s.name, measure: s.measure, unit: s.unit }));

  if (!data.subjects.length) {
    return (
      <>
        <div className="flex flex-col gap-2">
          <p className="label-mono">Learning</p>
          <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.03em] text-ink">What are you learning?</h2>
          <p className="text-[15px] text-ink-2">Add a subject and decide how you want to measure it — time, sessions, pages, lessons or your own unit. You set the target.</p>
        </div>
        <SubjectForm onDone={() => router.refresh()} />
        {data.legacy.length > 0 && <Legacy items={data.legacy} />}
      </>
    );
  }

  return (
    <>
      {data.active && (
        <section aria-label="Session running" className="flex items-center gap-3 rounded-[16px] border border-accent/35 bg-accent-soft px-4 py-3.5">
          <span className="min-w-0 flex-1">
            <span className="label-mono text-accent-text">Session running</span>
            <span className="block text-[18px] font-semibold text-ink">{data.active.subject}</span>
          </span>
          <span className="text-[22px] font-semibold text-ink tnum">{clock(now - Date.parse(data.active.startedAt))}</span>
          <Button onClick={() => setLog({ subjectId: data.active!.subjectId, finishing: { id: data.active!.id, startedAt: data.active!.startedAt } })}>
            <Stop size={16} weight="fill" /> Finish
          </Button>
        </section>
      )}

      <section aria-labelledby="week-h" data-tour="learning">
        <h2 id="week-h" className="label-mono mb-2">This week</h2>
        <ul className="flex flex-col divide-y divide-line">
          {data.subjects.map((s) => {
            const pct = s.weeklyTarget ? s.week.done / s.weeklyTarget : 0;
            return (
              <li key={s.id} className="py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <button type="button" onClick={() => setEditing(s)} className="min-w-0 truncate text-left text-[18px] font-semibold tracking-[-0.015em] text-ink hover:underline">
                    {s.name}
                  </button>
                  <span className="shrink-0 text-[15px] text-ink-2 tnum">
                    <span className="font-semibold text-ink">{fmtAmount(s.week.done, s)}</span> / {fmtAmount(s.weeklyTarget, s)}
                  </span>
                </div>
                <Meter className="mt-2" value={Math.min(1, pct)} label={`${Math.round(pct * 100)}% of this week’s target`} />
                <div className="mt-2.5 flex items-center gap-2">
                  <p className="min-w-0 flex-1 text-[13px] text-ink-3">
                    {s.week.sessions} session{s.week.sessions === 1 ? '' : 's'} · {s.daysPerWeek} day{s.daysPerWeek === 1 ? '' : 's'} a week planned
                    {s.weekStreak >= 2 ? ` · ${s.weekStreak} weeks in a row` : ''}
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending || !!data.active}
                    onClick={() =>
                      start(async () => {
                        const res = await startLearningAction(s.id);
                        if (!res.ok) toast.show({ title: res.error, tone: 'error' });
                        router.refresh();
                      })
                    }
                  >
                    <Play size={14} weight="fill" /> Start
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setLog({ subjectId: s.id })}>
                    Log
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <Button variant="ghost" size="sm" className="mt-1" onClick={() => setEditing('new')}>
          <Plus size={14} weight="bold" /> Add a subject
        </Button>
      </section>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-5 border-y border-line py-4 sm:grid-cols-4">
        {[
          ['This week', fmtMinutes(data.totals.weekMinutes)],
          ['This month', fmtMinutes(data.totals.monthMinutes)],
          ['All time', fmtMinutes(data.totals.allMinutes)],
          ['Sessions', String(data.totals.sessions)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="label-mono">{k}</dt>
            <dd className="mt-1 text-[20px] font-semibold text-ink tnum">{v}</dd>
          </div>
        ))}
      </dl>
      {data.mostConsistent && (
        <p className="-mt-4 text-[13px] text-ink-3">
          Most consistent: <span className="text-ink-2">{data.mostConsistent.name}</span> — target met in {fmtPct(data.mostConsistent.rate)} of the last 11 weeks.
        </p>
      )}

      {data.subjects.map((s) =>
        s.trend.some((x) => x > 0) ? (
          <section key={`t-${s.id}`} aria-label={`${s.name} over 12 weeks`}>
            <div className="mb-1 flex items-baseline justify-between">
              <h3 className="text-[15px] font-semibold text-ink">{s.name}</h3>
              <span className="text-[12px] text-ink-3">{unitWord(s)} per week · 12 weeks</span>
            </div>
            <Bars
              label={`${s.name}: ${unitWord(s)} per week`}
              target={s.weeklyTarget}
              format={(n) => (s.measure === 'minutes' ? fmtMinutes(n) : String(Math.round(n * 10) / 10))}
              points={s.trend.map((v, i) => ({ label: i === s.trend.length - 1 ? 'now' : `-${s.trend.length - 1 - i}w`, value: v, highlight: v >= s.weeklyTarget }))}
              height={96}
            />
          </section>
        ) : null,
      )}

      <section aria-labelledby="recent-h">
        <h2 id="recent-h" className="mb-1 text-[17px] font-semibold tracking-[-0.015em] text-ink">Recent sessions</h2>
        {data.recent.length ? (
          <ul className="divide-y divide-line">
            {data.recent.map((r) => (
              <li key={r.id} className="group flex min-h-14 items-center gap-3 py-2.5">
                <span className="w-14 shrink-0 font-mono text-[11px] uppercase text-ink-3">{formatDay(r.on, data.today)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-ink">
                    {r.subject}
                    <span className="ml-2 text-[13px] font-normal text-ink-3 tnum">
                      {[r.minutes ? fmtMinutes(r.minutes) : null, r.quantity ? `${r.quantity} ${unitWord(r)}` : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {(r.topic || r.note) && <span className="block truncate text-[13px] text-ink-3">{[r.topic, r.note].filter(Boolean).join(' — ')}</span>}
                </span>
                <button
                  type="button"
                  aria-label={`Delete ${r.subject} session`}
                  onClick={() =>
                    start(async () => {
                      await deleteLearningAction(r.id);
                      toast.show({ title: 'Session deleted' });
                    })
                  }
                  className="pressable grid size-10 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-bad sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                >
                  <Trash size={15} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">Your sessions appear here. Start a timer or log one after the fact.</p>
        )}
      </section>

      {data.legacy.length > 0 && <Legacy items={data.legacy} />}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New subject' : editing ? editing.name : ''}>
        {editing && (
          <SubjectForm
            key={editing === 'new' ? 'new' : editing.id}
            subject={editing === 'new' ? null : editing}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        )}
      </Sheet>
      <SessionSheet open={!!log} onClose={() => setLog(null)} subjects={lite} today={data.today} initialSubjectId={log?.subjectId} finishing={log?.finishing ?? null} />
    </>
  );
}

function SubjectForm({ subject, onDone }: { subject?: SubjectView | null; onDone: () => void }) {
  const [name, setName] = useState(subject?.name ?? '');
  const [measure, setMeasure] = useState<Measure | null>(subject?.measure ?? null);
  const [unit, setUnit] = useState(subject?.unit ?? '');
  const [target, setTarget] = useState(subject ? String(subject.measure === 'minutes' ? Math.round(subject.weeklyTarget / 6) / 10 : subject.weeklyTarget) : '');
  const [days, setDays] = useState<number | null>(subject?.daysPerWeek ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const isHours = measure === 'minutes';
  const weekly = Number(target.replace(',', '.'));
  const weeklyValue = isHours ? Math.round(weekly * 60) : weekly;
  const needsDays = measure !== 'sessions';
  const ready = name.trim() && measure && weekly > 0 && (!needsDays || days) && (measure !== 'custom' || unit.trim());
  const perDay = measure && days && weekly > 0 ? (isHours ? `${Math.round(weeklyValue / days)} min` : `${Math.round((weekly / days) * 10) / 10} ${measure === 'custom' ? unit || 'units' : measure}`) : null;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const input = {
            name: name.trim(),
            measure: measure!,
            unit: measure === 'custom' ? unit.trim() : null,
            weeklyTarget: weeklyValue,
            daysPerWeek: needsDays ? days! : Math.min(7, Math.ceil(weekly)),
          };
          const res = subject ? await updateSubjectAction(subject.id, input) : await createSubjectAction(input);
          if (!res.ok) return setError(res.error);
          toast.show({ title: subject ? `${input.name} updated` : `${input.name} added`, detail: subject ? 'The new target applies from today.' : undefined, tone: 'accent' });
          onDone();
        });
      }}
    >
      <Field label="Subject" htmlFor="sb-name">
        <Input id="sb-name" autoFocus={!subject} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={SUBJECT_EXAMPLES.slice(0, 3).join(', ') + '…'} />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-2">Track it by</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Track it by">
          {MEASURES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={measure === m.value}
              onClick={() => setMeasure(m.value)}
              className={cn('pressable flex min-h-14 flex-col items-start justify-center rounded-[12px] border px-3 py-2 text-left', measure === m.value ? 'border-accent-text bg-accent-soft' : 'border-line-strong hover:border-ink-3')}
            >
              <span className="text-[15px] font-medium text-ink">{m.label}</span>
              <span className="text-[12px] text-ink-3">{m.hint}</span>
            </button>
          ))}
        </div>
      </div>
      {measure === 'custom' && (
        <Field label="Unit" htmlFor="sb-unit">
          <Input id="sb-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={16} placeholder="problems, chapters…" />
        </Field>
      )}
      {measure && (
        <Field label={isHours ? 'Hours a week' : measure === 'sessions' ? 'Sessions a week' : `${measure === 'custom' ? unit || 'Units' : measure[0].toUpperCase() + measure.slice(1)} a week`} htmlFor="sb-target">
          <Input id="sb-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d.,]/g, ''))} placeholder={isHours ? '4' : '3'} />
        </Field>
      )}
      {measure && needsDays && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Spread over how many days a week?</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Days a week">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={days === n}
                onClick={() => setDays(n)}
                className={cn('pressable grid size-11 place-items-center rounded-full text-[15px] font-medium tnum', days === n ? 'bg-ink text-bg' : 'border border-line-strong text-ink-2')}
              >
                {n}
              </button>
            ))}
          </div>
          {perDay && <p className="text-[13px] text-ink-3">That’s about {perDay} a session.</p>}
        </div>
      )}
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <Button type="submit" size="lg" block loading={pending} disabled={!ready}>
        {subject ? 'Save subject' : 'Add subject'}
      </Button>
      {subject && (
        <Button
          variant="ghost"
          onClick={() =>
            start(async () => {
              await archiveSubjectAction(subject.id);
              onDone();
            })
          }
        >
          Archive subject
        </Button>
      )}
    </form>
  );
}

function Legacy({ items }: { items: { id: string; title: string }[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <section aria-labelledby="legacy-h">
      <h2 id="legacy-h" className="label-mono mb-1">Routines already in Learning</h2>
      <ul className="divide-y divide-line">
        {items.map((r) => (
          <li key={r.id} className="flex min-h-12 items-center gap-3">
            <span className="flex-1 text-[15px] text-ink-2">{r.title}</span>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { await adoptRoutineAction(r.id); router.refresh(); })}>
              Make it a subject
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[12px] text-ink-3">Its history stays attached. They keep working on Today either way.</p>
    </section>
  );
}
