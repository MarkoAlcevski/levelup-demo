'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, CaretDown, CaretRight, CheckCircle, Circle, PencilSimple, Plus } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/engine/dates';
import { fmtPct, fmtValue } from '@/lib/format';
import type { AreaDetail, RoutineView } from '@/lib/server/areas';
import type { GoalView } from '@/lib/server/goals';
import {
  archiveAreaAction, createGoalAction, createProjectAction, goalCheckinAction, restoreAreaAction, setProjectStatusAction,
} from '@/lib/actions';
import { putCompletion, deleteCompletion } from '@/lib/client/api';
import { Button, Field, Input } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { Meter, Pips } from '@/components/viz/marks';
import { useToast } from '@/components/ui/toast';
import { MissionForm, blankDraft, type MissionDraft } from '@/components/plan/mission-form';
import { AreaForm } from './area-form';

const HEALTH: Record<GoalView['health'], { label: string; cls: string }> = {
  ahead: { label: 'Ahead', cls: 'bg-accent-soft text-accent-text' },
  on_track: { label: 'On track', cls: 'bg-accent-soft text-accent-text' },
  behind: { label: 'Behind', cls: 'bg-warn/12 text-warn' },
  at_risk: { label: 'Well behind', cls: 'bg-bad/12 text-bad' },
  no_data: { label: 'No data yet', cls: 'bg-sunken text-ink-3' },
  achieved: { label: 'Reached', cls: 'bg-accent text-accent-ink' },
};

function toDraft(m: RoutineView): MissionDraft {
  return {
    id: m.id, title: m.title, areaId: m.areaId, measure: m.measure, unit: m.unit, target: m.target, minimum: m.minimum, minimumLabel: m.minimumLabel,
    difficulty: m.difficulty, proofPolicy: m.proofPolicy, timeOfDay: m.timeOfDay, isPriority: m.isPriority, notes: m.notes, cadence: m.cadence,
    perWeek: m.perWeek, weekdays: m.weekdays, dueOn: m.dueOn, projectId: m.projectId,
  };
}

/** One area: its routines, tasks, projects and goals — nothing else. */
export function AreaDetailView({ data }: { data: AreaDetail }) {
  const [editing, setEditing] = useState<MissionDraft | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [checkin, setCheckin] = useState<GoalView | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [pending, start] = useTransition();
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const router = useRouter();
  const toast = useToast();
  const a = data.area;
  const areas = [{ id: a.id, kind: a.kind, name: a.name, icon: a.icon }, ...data.areas.filter((x) => x.id !== a.id)];
  const projects = data.projects.filter((p) => p.status === 'active').map((p) => ({ id: p.id, title: p.title }));

  const completeTask = (t: RoutineView) =>
    start(async () => {
      const was = doneIds.has(t.id);
      setDoneIds((s) => {
        const n = new Set(s);
        if (was) n.delete(t.id);
        else n.add(t.id);
        return n;
      });
      const res = was ? await deleteCompletion(t.id, data.today) : await putCompletion({ missionId: t.id, day: data.today, outcome: 'full' });
      if (!res.ok) toast.show({ title: 'error' in res && res.error ? res.error : 'Couldn’t save.', tone: 'error' });
      else if (!was) toast.show({ title: `${t.title} — done`, detail: 'xpGained' in res && res.xpGained ? `+${res.xpGained} points` : undefined, actions: [{ label: 'Undo', onClick: () => completeTask(t) }] });
      router.refresh();
    });

  const taskRow = (t: RoutineView) => {
    const done = doneIds.has(t.id) || !!t.doneOn;
    return (
      <li key={t.id} className="flex items-center gap-1">
        <button type="button" onClick={() => completeTask(t)} disabled={!!t.doneOn || pending} aria-pressed={done} aria-label={done ? `${t.title} done` : `Mark ${t.title} done`} className="pressable -ml-2 grid size-12 shrink-0 place-items-center rounded-full">
          {done ? <CheckCircle size={26} weight="fill" className="text-accent" /> : <Circle size={26} className="text-ink-3" />}
        </button>
        <button type="button" onClick={() => setEditing(toDraft(t))} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 py-2 text-left">
          <span className="min-w-0 flex-1">
            <span className={cn('block truncate text-[15px] font-medium', done ? 'text-ink-3 line-through' : 'text-ink')}>{t.title}</span>
            <span className={cn('block text-[13px]', t.dueOn && t.dueOn < data.today && !done ? 'text-warn' : 'text-ink-3')}>
              {t.doneOn ? `Done ${formatDay(t.doneOn, data.today)}` : t.dueOn ? (t.dueOn < data.today ? `Overdue · ${formatDay(t.dueOn, data.today)}` : t.dueOn === data.today ? 'Due today' : `Due ${formatDay(t.dueOn, data.today)}`) : 'No date'}
            </span>
          </span>
          <CaretRight size={14} className="shrink-0 text-ink-3" />
        </button>
      </li>
    );
  };

  return (
    <>
      {a.archived && (
        <div className="flex items-center gap-3 rounded-[14px] border border-warn/30 bg-warn/8 px-4 py-3">
          <p className="flex-1 text-[14px] text-ink-2">This area is archived. Its history is kept; its routines aren’t due.</p>
          <Button size="sm" onClick={() => start(async () => void (await restoreAreaAction(a.id)))}>
            Restore
          </Button>
        </div>
      )}

      <dl className="grid grid-cols-3 gap-4">
        <div>
          <dt className="label-mono">This week</dt>
          <dd className="mt-1 text-[22px] font-semibold text-ink tnum">{data.stats.week.due ? `${data.stats.week.kept} / ${data.stats.week.due}` : data.stats.week.kept || '—'}</dd>
        </div>
        <div>
          <dt className="label-mono">30 days</dt>
          <dd className="mt-1 text-[22px] font-semibold text-ink tnum">{fmtPct(data.stats.execution30)}</dd>
        </div>
        <div>
          <dt className="label-mono">Before that</dt>
          <dd className="mt-1 text-[22px] font-semibold text-ink-3 tnum">{fmtPct(data.stats.prev30)}</dd>
        </div>
      </dl>

      <section aria-labelledby="routines-h">
        <div className="mb-1 flex items-center justify-between">
          <h2 id="routines-h" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Routines</h2>
          <Button size="sm" variant="ghost" onClick={() => setEditing(blankDraft(a.id, 'routine'))}>
            <Plus size={14} weight="bold" /> Routine
          </Button>
        </div>
        {data.routines.length ? (
          <ul className="divide-y divide-line">
            {data.routines.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setEditing(toDraft(r))} className="flex min-h-14 w-full items-center gap-3 py-2.5 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-ink">{r.title}</span>
                    <span className="block truncate text-[13px] text-ink-3">
                      {[r.cadenceLabel, r.target != null ? fmtValue(r.target, r.unit) : null, r.minimumLabel ? `min: ${r.minimumLabel}` : null, r.streak.current >= 2 ? `${r.streak.current}-${r.streak.unit} streak` : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {r.weekly ? <Pips done={Math.min(r.weekly.done, r.weekly.quota)} total={r.weekly.quota} /> : null}
                  <span className="w-12 shrink-0 text-right text-[13px] font-medium text-ink-2 tnum">{fmtPct(r.execution30)}</span>
                  <CaretRight size={14} className="shrink-0 text-ink-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">Routines repeat — daily, a few times a week, or on set days. You choose.</p>
        )}
      </section>

      <section aria-labelledby="tasks-h">
        <div className="mb-1 flex items-center justify-between">
          <h2 id="tasks-h" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Tasks</h2>
          <Button size="sm" variant="ghost" onClick={() => setEditing(blankDraft(a.id, 'task'))}>
            <Plus size={14} weight="bold" /> Task
          </Button>
        </div>
        {data.tasks.length ? <ul className="divide-y divide-line">{data.tasks.map(taskRow)}</ul> : <p className="text-sm text-ink-3">One-off things to finish. Dated tasks show up on Today.</p>}
        {data.doneTasks.length > 0 && (
          <div className="mt-2">
            <button type="button" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)} className="label-mono flex min-h-11 items-center gap-2 hover:text-ink-2">
              Done · {data.doneTasks.length}
              <CaretDown size={12} className={cn('transition-transform duration-200', showDone && 'rotate-180')} />
            </button>
            {showDone && <ul className="divide-y divide-line">{data.doneTasks.map(taskRow)}</ul>}
          </div>
        )}
      </section>

      <section aria-labelledby="projects-h">
        <div className="mb-1 flex items-center justify-between">
          <h2 id="projects-h" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Projects</h2>
          <Button size="sm" variant="ghost" onClick={() => setProjectOpen(true)}>
            <Plus size={14} weight="bold" /> Project
          </Button>
        </div>
        {data.projects.length ? (
          <ul className="flex flex-col gap-3">
            {data.projects.map((p) => (
              <li key={p.id} className="rounded-[16px] border border-line px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-[15px] font-semibold', p.status === 'done' ? 'text-ink-3 line-through' : 'text-ink')}>{p.title}</p>
                    <p className="text-[13px] text-ink-3">
                      {p.tasks.length ? `${p.done} of ${p.tasks.length} steps done` : 'No steps yet'}
                      {p.targetOn ? ` · by ${formatDay(p.targetOn, data.today)}` : ''}
                    </p>
                  </div>
                  <Button size="sm" variant={p.status === 'done' ? 'ghost' : 'outline'} onClick={() => start(async () => void (await setProjectStatusAction(p.id, p.status === 'done' ? 'active' : 'done')))}>
                    {p.status === 'done' ? 'Reopen' : 'Finish'}
                  </Button>
                </div>
                {p.tasks.length > 0 && <Meter className="mt-2" value={p.done / p.tasks.length} label={`${p.done} of ${p.tasks.length} steps`} />}
                {p.tasks.length > 0 && <ul className="mt-1 divide-y divide-line">{p.tasks.map(taskRow)}</ul>}
                {p.status === 'active' && (
                  <button type="button" onClick={() => setEditing({ ...blankDraft(a.id, 'task'), projectId: p.id })} className="mt-1 inline-flex min-h-10 items-center gap-1.5 text-[13px] font-medium text-ink-3 hover:text-ink">
                    <Plus size={13} /> Add a step
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">Optional: group tasks into something bigger, like “Launch the website”.</p>
        )}
      </section>

      <section aria-labelledby="goals-h">
        <div className="mb-1 flex items-center justify-between">
          <h2 id="goals-h" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Goals</h2>
          <Button size="sm" variant="ghost" onClick={() => setGoalOpen(true)}>
            <Plus size={14} weight="bold" /> Goal
          </Button>
        </div>
        {data.goals.length ? (
          <ul className="flex flex-col gap-3">
            {data.goals.map((g) => (
              <li key={g.id} className="rounded-[16px] border border-line px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-ink">{g.title}</p>
                    <p className="text-[13px] text-ink-3">
                      {g.current != null ? `${Math.round(g.current * 10) / 10}` : '—'} of {g.target}
                      {g.unit ? ` ${g.unit}` : ''}
                      {g.targetOn ? ` · by ${formatDay(g.targetOn, data.today)}` : ''}
                    </p>
                  </div>
                  <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', HEALTH[g.health].cls)}>{HEALTH[g.health].label}</span>
                </div>
                <div className="relative mt-3">
                  <Meter value={g.progress} tone={g.health === 'at_risk' ? 'bad' : g.health === 'behind' ? 'warn' : 'accent'} label={`${fmtPct(g.progress)} of the way`} />
                  {g.expected > 0 && g.expected < 1 && <span className="absolute -top-1 -bottom-1 w-[2px] rounded-full bg-ink-2" style={{ left: `calc(${g.expected * 100}% - 1px)` }} title="A straight line to the deadline" />}
                </div>
                <p className="mt-2 text-[13px] leading-5 text-ink-2">{g.explanation}</p>
                {g.metric === 'manual' && g.health !== 'achieved' && (
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => setCheckin(g)}>
                    Update progress
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">Optional: a number you’re working toward, like “€5k monthly revenue”.</p>
        )}
      </section>

      <section aria-label="Area settings" className="flex flex-wrap gap-2 border-t border-line pt-5">
        <Button variant="outline" onClick={() => setRenaming(true)}>
          <PencilSimple size={16} /> Rename or change icon
        </Button>
        {!a.archived &&
          (confirmArchive ? (
            <div className="flex w-full items-center gap-2 rounded-[12px] border border-line px-3 py-2">
              <p className="flex-1 text-[13px] text-ink-2">Archive {a.name}? Its routines stop being due from today. Everything stays in your history and you can restore it.</p>
              <Button
                size="sm"
                variant="danger"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    await archiveAreaAction(a.id);
                    router.push('/areas');
                  })
                }
              >
                Archive
              </Button>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmArchive(true)}>
              <Archive size={16} /> Archive area
            </Button>
          ))}
      </section>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${editing.cadence === 'once' ? 'task' : 'routine'}` : editing?.cadence === 'once' ? 'New task' : 'New routine'}>
        {editing && (
          <MissionForm
            key={editing.id ?? `new-${editing.cadence}-${editing.projectId ?? ''}`}
            initial={editing}
            areas={areas}
            projects={projects}
            today={data.today}
            autoFocus={!editing.id}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        )}
      </Sheet>
      <AreaForm open={renaming} onClose={() => setRenaming(false)} area={{ id: a.id, name: a.name, icon: a.icon }} />
      <ProjectSheet open={projectOpen} onClose={() => setProjectOpen(false)} areaId={a.id} today={data.today} />
      <GoalSheet open={goalOpen} onClose={() => setGoalOpen(false)} areaId={a.id} today={data.today} routines={data.routines} />
      <CheckinSheet goal={checkin} onClose={() => setCheckin(null)} />
    </>
  );
}

function ProjectSheet({ open, onClose, areaId, today }: { open: boolean; onClose: () => void; areaId: string; today: string }) {
  const [title, setTitle] = useState('');
  const [targetOn, setTargetOn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Sheet open={open} onClose={onClose} title="New project" size="sm" description="A bigger outcome made of tasks.">
      <form
        className="flex flex-col gap-4 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await createProjectAction({ areaId, title, targetOn: targetOn || null });
            if (!res.ok) return setError(res.error);
            setTitle('');
            setTargetOn('');
            onClose();
            router.refresh();
          });
        }}
      >
        <Field label="Project" htmlFor="pj-title" error={error}>
          <Input id="pj-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Launch the website" />
        </Field>
        <Field label="Target date (optional)" htmlFor="pj-date">
          <Input id="pj-date" type="date" min={today} value={targetOn} onChange={(e) => setTargetOn(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" block loading={pending} disabled={!title.trim()}>
          Create project
        </Button>
      </form>
    </Sheet>
  );
}

function GoalSheet({ open, onClose, areaId, today, routines }: { open: boolean; onClose: () => void; areaId: string; today: string; routines: RoutineView[] }) {
  const [title, setTitle] = useState('');
  const [unit, setUnit] = useState('');
  const [start, setStart] = useState('0');
  const [target, setTarget] = useState('');
  const [targetOn, setTargetOn] = useState('');
  const [links, setLinks] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, begin] = useTransition();
  const router = useRouter();
  return (
    <Sheet open={open} onClose={onClose} title="New goal" description="A number you’re working toward. LevelUp tracks it; you define it.">
      <form
        className="flex flex-col gap-4 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          begin(async () => {
            const res = await createGoalAction({
              title, areaId, unit: unit || null, startValue: Number(start.replace(',', '.')) || 0, targetValue: Number(target.replace(',', '.')),
              targetOn: targetOn || null, missionIds: links,
            });
            if (!res.ok) return setError(res.error);
            setTitle('');
            setTarget('');
            onClose();
            router.refresh();
          });
        }}
      >
        <Field label="Goal" htmlFor="gl-title">
          <Input id="gl-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Reach €5k monthly revenue" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Now" htmlFor="gl-start">
            <Input id="gl-start" inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Target" htmlFor="gl-target">
            <Input id="gl-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="5000" />
          </Field>
          <Field label="Unit" htmlFor="gl-unit">
            <Input id="gl-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={16} placeholder="€, clients…" />
          </Field>
        </div>
        <Field label="Deadline (optional)" htmlFor="gl-date">
          <Input id="gl-date" type="date" min={today} value={targetOn} onChange={(e) => setTargetOn(e.target.value)} />
        </Field>
        {routines.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">Routines that feed it (optional)</span>
            <div className="flex flex-wrap gap-2">
              {routines.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={links.includes(r.id)}
                  onClick={() => setLinks((l) => (l.includes(r.id) ? l.filter((x) => x !== r.id) : [...l, r.id]))}
                  className={cn('pressable h-9 rounded-full border px-3.5 text-sm font-medium', links.includes(r.id) ? 'border-transparent bg-ink text-bg' : 'border-line-strong text-ink-2')}
                >
                  {r.title}
                </button>
              ))}
            </div>
          </div>
        )}
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        <Button type="submit" size="lg" block loading={pending} disabled={!title.trim() || !target.trim()}>
          Create goal
        </Button>
      </form>
    </Sheet>
  );
}

function CheckinSheet({ goal, onClose }: { goal: GoalView | null; onClose: () => void }) {
  const [value, setValue] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Sheet open={!!goal} onClose={onClose} size="sm" title="Update progress" description={goal?.title}>
      {goal && (
        <form
          className="flex flex-col gap-4 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(value.replace(',', '.'));
            if (!Number.isFinite(n)) return;
            start(async () => {
              await goalCheckinAction(goal.id, n);
              setValue('');
              onClose();
              router.refresh();
            });
          }}
        >
          <Input autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={goal.current != null ? String(goal.current) : '0'} aria-label={`Where ${goal.title} stands now`} />
          <Button type="submit" size="lg" block loading={pending} disabled={!value}>
            Save
          </Button>
        </form>
      )}
    </Sheet>
  );
}
