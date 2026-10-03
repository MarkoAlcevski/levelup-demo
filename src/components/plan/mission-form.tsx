'use client';

import { useState, useTransition } from 'react';
import { Archive, CaretDown } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { archiveMissionAction, saveMissionAction } from '@/lib/actions';
import { DIFFICULTY_XP } from '@/lib/engine/xp';
import { addDays } from '@/lib/engine/dates';
import type { Difficulty, Measure, ProofPolicy } from '@/lib/engine/types';
import { Button, Chip, Field, Input, Segmented, Switch, Textarea } from '@/components/ui/primitives';
import { AreaIcon } from '@/components/icons';
import { useToast } from '@/components/ui/toast';

export interface MissionDraft {
  id?: string;
  title: string;
  areaId: string;
  measure: Measure;
  unit: string | null;
  target: number | null;
  minimum: number | null;
  minimumLabel: string | null;
  difficulty: Difficulty;
  proofPolicy: ProofPolicy;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | null;
  isPriority: boolean;
  notes: string | null;
  cadence: 'daily' | 'weekly' | 'days' | 'once';
  perWeek: number | null;
  weekdays: number[] | null;
  dueOn: string | null;
  projectId?: string | null;
}

export function blankDraft(areaId: string, kind: 'routine' | 'task' = 'routine'): MissionDraft {
  return {
    title: '', areaId, measure: 'check', unit: null, target: null, minimum: null, minimumLabel: null, difficulty: 'normal',
    proofPolicy: 'optional', timeOfDay: null, isPriority: false, notes: null,
    cadence: kind === 'task' ? 'once' : 'weekly', perWeek: kind === 'task' ? null : null, weekdays: null, dueOn: null, projectId: null,
  };
}

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Routines and tasks. The first screen is only: name, area, how often (or when, for a task).
 * How success is measured is optional; everything else waits under "More options".
 */
export function MissionForm({
  initial,
  areas,
  onDone,
  autoFocus = true,
  today,
  projects = [],
}: {
  initial: MissionDraft;
  areas: { id: string; kind: string; name: string; icon?: string | null }[];
  onDone: () => void;
  autoFocus?: boolean;
  today: string;
  projects?: { id: string; title: string }[];
}) {
  const [d, setD] = useState<MissionDraft>(initial);
  const isTask = d.cadence === 'once';
  const [measureOpen, setMeasureOpen] = useState(!!initial.id && initial.measure !== 'check');
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const set = <K extends keyof MissionDraft>(k: K, v: MissionDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const measured = d.measure !== 'check';
  const noun = isTask ? 'task' : 'routine';
  const cadenceReady = isTask || d.cadence === 'daily' || (d.cadence === 'weekly' && !!d.perWeek) || (d.cadence === 'days' && !!d.weekdays?.length);

  function submit() {
    setError(null);
    start(async () => {
      const res = await saveMissionAction(d.id ?? null, {
        title: d.title,
        areaId: d.areaId,
        measure: d.measure,
        unit: d.measure === 'duration' ? 'min' : measured ? d.unit || null : null,
        targetValue: measured ? d.target : null,
        minimumValue: measured ? d.minimum || null : null,
        minimumLabel: !measured ? d.minimumLabel || null : null,
        difficulty: d.difficulty,
        proofPolicy: d.proofPolicy,
        timeOfDay: d.timeOfDay,
        isPriority: d.isPriority,
        notes: d.notes || null,
        projectId: d.projectId ?? null,
        cadence: d.cadence,
        perWeek: d.cadence === 'weekly' ? d.perWeek : null,
        weekdays: d.cadence === 'days' ? d.weekdays : null,
        dueOn: d.cadence === 'once' ? d.dueOn || null : null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.show({ title: d.id ? `${isTask ? 'Task' : 'Routine'} updated` : `${isTask ? 'Task' : 'Routine'} added`, detail: d.id && !isTask ? 'Changes apply from today; history stays as it was.' : d.title });
      onDone();
    });
  }

  return (
    <form
      className="flex flex-col gap-5 pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {!d.id && (
        <Segmented
          label="Routine or task"
          value={isTask ? 'task' : 'routine'}
          onChange={(v) => setD((x) => ({ ...x, cadence: v === 'task' ? 'once' : x.cadence === 'once' ? 'weekly' : x.cadence }))}
          options={[
            { value: 'routine', label: 'Routine · repeats' },
            { value: 'task', label: 'Task · once' },
          ]}
        />
      )}

      <Field label={isTask ? 'Task' : 'Routine'} htmlFor="m-title">
        <Input id="m-title" autoFocus={autoFocus} value={d.title} onChange={(e) => set('title', e.target.value)} maxLength={120} placeholder={isTask ? 'Finish the landing-page copy' : 'Outreach, Practice scales, Pray…'} required />
      </Field>

      {areas.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Area</span>
          <div className="flex flex-wrap gap-2">
            {areas.map((a) => (
              <Chip key={a.id} selected={d.areaId === a.id} onClick={() => set('areaId', a.id)}>
                <AreaIcon kind={a.kind} icon={a.icon} size={14} /> {a.name}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {isTask ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">When</span>
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Today', v: today },
              { label: 'Tomorrow', v: addDays(today, 1) },
              { label: 'No date', v: null },
            ].map((o) => (
              <Chip key={o.label} selected={d.dueOn === o.v} onClick={() => set('dueOn', o.v)}>
                {o.label}
              </Chip>
            ))}
            <Input type="date" aria-label="Pick a date" value={d.dueOn ?? ''} min={today} onChange={(e) => set('dueOn', e.target.value || null)} className="h-9 w-auto rounded-full px-3 text-sm" />
          </div>
          <p className="text-[13px] text-ink-3">{d.dueOn ? 'It shows on Today on that day, and stays until it’s done.' : 'Undated tasks wait in the area until you do them.'}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">How often</span>
          <Segmented
            label="How often"
            value={d.cadence === 'once' ? 'weekly' : d.cadence}
            onChange={(v) => set('cadence', v)}
            options={[
              { value: 'daily', label: 'Every day' },
              { value: 'weekly', label: 'Times a week' },
              { value: 'days', label: 'Set days' },
            ]}
          />
          {d.cadence === 'weekly' && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Times a week">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={d.perWeek === n}
                  onClick={() => set('perWeek', n)}
                  className={cn('pressable grid size-11 place-items-center rounded-full text-[15px] font-medium tnum', d.perWeek === n ? 'bg-ink text-bg' : 'border border-line-strong text-ink-2')}
                >
                  {n}×
                </button>
              ))}
              <span className="ml-1 text-[13px] text-ink-3">any days you like</span>
            </div>
          )}
          {d.cadence === 'days' && (
            <div className="mt-1 flex gap-1.5" role="group" aria-label="Days of the week">
              {DAYS.map((label, i) => {
                const iso = i + 1;
                const on = d.weekdays?.includes(iso) ?? false;
                return (
                  <button
                    key={iso}
                    type="button"
                    aria-pressed={on}
                    aria-label={DAY_NAMES[i]}
                    onClick={() => set('weekdays', on ? (d.weekdays ?? []).filter((x) => x !== iso) : [...(d.weekdays ?? []), iso])}
                    className={cn('pressable grid size-11 place-items-center rounded-full text-sm font-medium', on ? 'bg-ink text-bg' : 'border border-line-strong text-ink-2')}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => setMeasureOpen((v) => !v)} aria-expanded={measureOpen} className="flex min-h-10 items-center gap-2 self-start text-sm font-medium text-ink-2 hover:text-ink">
          How success is measured <span className="font-normal text-ink-3">· {d.measure === 'check' ? 'done / not done' : d.measure === 'duration' ? `${d.target ?? '—'} min` : `${d.target ?? '—'} ${d.unit || 'units'}`}</span>
          <CaretDown size={14} className={cn('transition-transform duration-200', measureOpen && 'rotate-180')} />
        </button>
        {measureOpen && (
          <div className="flex flex-col gap-2">
            <Segmented
              label="Measure"
              size="sm"
              value={d.measure}
              onChange={(v) => setD((x) => ({ ...x, measure: v, unit: v === 'duration' ? 'min' : v === 'quantity' ? (x.unit && x.unit !== 'min' ? x.unit : '') : null, target: v === 'check' ? null : x.target }))}
              options={[
                { value: 'check', label: 'Done / not' },
                { value: 'duration', label: 'Time' },
                { value: 'quantity', label: 'Amount' },
              ]}
            />
            {measured && (
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" inputMode="decimal" min={0} aria-label="Target" value={d.target ?? ''} onChange={(e) => set('target', e.target.value ? Number(e.target.value) : null)} placeholder="Target" />
                {d.measure === 'duration' ? (
                  <div className="grid h-12 items-center rounded-[12px] border border-line bg-sunken px-3.5 text-ink-3">minutes</div>
                ) : (
                  <Input aria-label="Unit" value={d.unit ?? ''} onChange={(e) => set('unit', e.target.value)} maxLength={16} placeholder="messages, pages…" />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="flex min-h-10 items-center gap-2 self-start text-sm font-medium text-ink-2 hover:text-ink">
        More options <CaretDown size={14} className={cn('transition-transform duration-200', more && 'rotate-180')} />
      </button>

      {more && (
        <div className="flex flex-col gap-5">
          {!isTask && (
            <Field label="Minimum version" htmlFor="m-min" hint="What still counts on a bad day. It keeps your streak — and never pretends to be the full thing.">
              {measured ? (
                <div className="flex items-center gap-2">
                  <Input id="m-min" type="number" inputMode="decimal" min={0} value={d.minimum ?? ''} onChange={(e) => set('minimum', e.target.value ? Number(e.target.value) : null)} placeholder="e.g. 20" />
                  <span className="shrink-0 text-sm text-ink-3">{d.measure === 'duration' ? 'min' : d.unit || 'units'}</span>
                </div>
              ) : (
                <Input id="m-min" value={d.minimumLabel ?? ''} onChange={(e) => set('minimumLabel', e.target.value || null)} maxLength={80} placeholder="The short version" />
              )}
            </Field>
          )}
          {projects.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-2">Project</span>
              <div className="flex flex-wrap gap-2">
                <Chip selected={!d.projectId} onClick={() => set('projectId', null)}>
                  None
                </Chip>
                {projects.map((p) => (
                  <Chip key={p.id} selected={d.projectId === p.id} onClick={() => set('projectId', p.id)}>
                    {p.title}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          <Switch checked={d.isPriority} onChange={(v) => set('isPriority', v)} label="Priority" description="Shown first in its area on Today." />
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">Proof</span>
            <Segmented
              label="Proof"
              size="sm"
              value={d.proofPolicy}
              onChange={(v) => set('proofPolicy', v)}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'optional', label: 'Optional' },
                { value: 'recommended', label: 'Nudge' },
                { value: 'required', label: 'Required' },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">Preferred time</span>
            <Segmented
              label="Preferred time"
              size="sm"
              value={d.timeOfDay ?? 'any'}
              onChange={(v) => set('timeOfDay', v === 'any' ? null : (v as MissionDraft['timeOfDay']))}
              options={[
                { value: 'any', label: 'Any' },
                { value: 'morning', label: 'Morning' },
                { value: 'afternoon', label: 'Afternoon' },
                { value: 'evening', label: 'Evening' },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">Effort</span>
            <Segmented
              label="Effort"
              size="sm"
              value={d.difficulty}
              onChange={(v) => set('difficulty', v)}
              options={(['easy', 'normal', 'hard', 'extreme'] as const).map((k) => ({ value: k, label: <span className="capitalize">{k}</span>, hint: `${DIFFICULTY_XP[k]} points` }))}
            />
            <p className="text-[13px] text-ink-3">Done earns {DIFFICULTY_XP[d.difficulty]} points. Rate it honestly — nobody else sees it.</p>
          </div>
          <Field label="Notes" htmlFor="m-notes">
            <Textarea id="m-notes" value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} maxLength={2000} placeholder="Why it matters, how to start…" />
          </Field>
        </div>
      )}

      {error && (
        <p className="text-sm text-bad" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        {d.id && (
          <Button
            variant="ghost"
            onClick={() =>
              start(async () => {
                await archiveMissionAction(d.id!);
                toast.show({ title: `${isTask ? 'Task' : 'Routine'} archived`, detail: 'Its history and proof stay in your record.' });
                onDone();
              })
            }
          >
            <Archive size={16} /> Archive
          </Button>
        )}
        <Button type="submit" size="lg" className="ml-auto min-w-40 flex-1 sm:flex-none" loading={pending} disabled={!d.title.trim() || !d.areaId || !cadenceReady}>
          {d.id ? 'Save changes' : `Add ${noun}`}
        </Button>
      </div>
    </form>
  );
}
