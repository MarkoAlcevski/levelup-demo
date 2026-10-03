'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowRight, ArrowUp, Plus, Trash } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { WORKOUT_NAME_EXAMPLES } from '@/lib/modules';
import type { GymProgram } from '@/lib/server/gym';
import { updateProgramAction } from '@/lib/actions';
import { Button, Field, Input, Segmented } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface DayDraft {
  id: string | null;
  name: string;
  weekday: number | null;
  exercises: number;
}

/** Your split, editable any time. Past workouts keep the names and sets they were logged with. */
export function ProgramEditor({ program }: { program: GymProgram }) {
  const [name, setName] = useState(program.name);
  const [mode, setMode] = useState(program.mode);
  const [perWeek, setPerWeek] = useState(program.perWeek);
  const [days, setDays] = useState<DayDraft[]>(program.days.map((d) => ({ id: d.id, name: d.name, weekday: d.weekday, exercises: d.exercises.length })));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const patch = (i: number, p: Partial<DayDraft>) => setDays((all) => all.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const move = (i: number, dir: -1 | 1) =>
    setDays((all) => {
      const j = i + dir;
      if (j < 0 || j >= all.length) return all;
      const list = [...all];
      [list[i], list[j]] = [list[j], list[i]];
      return list;
    });

  function save() {
    setError(null);
    start(async () => {
      const res = await updateProgramAction({
        name: name.trim() || 'My program',
        mode,
        perWeek,
        days: days.map((d) => ({ id: d.id, name: d.name.trim(), weekday: mode === 'scheduled' ? d.weekday : null })),
      });
      if (!res.ok) return setError(res.error);
      toast.show({ title: 'Program saved', detail: 'Applies from today. Past workouts don’t change.' });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Field label="Program name" htmlFor="pg-name">
        <Input id="pg-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </Field>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium text-ink-2">How you train</span>
        <Segmented
          label="How you train"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'flexible', label: 'Flexible days' },
            { value: 'scheduled', label: 'Fixed days' },
          ]}
        />
        {mode === 'flexible' && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Workouts per week">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={perWeek === n}
                onClick={() => setPerWeek(n)}
                className={cn('pressable grid size-11 place-items-center rounded-full text-[15px] font-medium tnum', perWeek === n ? 'bg-ink text-bg' : 'border border-line-strong text-ink-2')}
              >
                {n}
              </button>
            ))}
            <span className="ml-1 text-[13px] text-ink-3">workouts a week</span>
          </div>
        )}
      </div>

      <section aria-labelledby="days-h" className="flex flex-col gap-2">
        <h2 id="days-h" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Workout days</h2>
        <ol className="flex flex-col gap-2.5">
          {days.map((d, i) => (
            <li key={d.id ?? `new-${i}`} className="rounded-[16px] border border-line-strong bg-surface p-3">
              <div className="flex items-center gap-2">
                <span className="label-mono w-11 shrink-0">Day {i + 1}</span>
                <Input aria-label={`Day ${i + 1} name`} value={d.name} maxLength={40} placeholder={WORKOUT_NAME_EXAMPLES[i % WORKOUT_NAME_EXAMPLES.length]} onChange={(e) => patch(i, { name: e.target.value })} />
              </div>
              {mode === 'scheduled' && (
                <div className="mt-2 grid grid-cols-7 gap-1" role="radiogroup" aria-label={`${d.name || `Day ${i + 1}`} weekday`}>
                  {WEEKDAYS.map((w, k) => {
                    const iso = k + 1;
                    const taken = days.some((x, j) => j !== i && x.weekday === iso);
                    const on = d.weekday === iso;
                    return (
                      <button
                        key={w}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={taken}
                        onClick={() => patch(i, { weekday: on ? null : iso })}
                        className={cn('pressable h-10 rounded-[10px] text-[12px] font-medium', on ? 'bg-ink text-bg' : taken ? 'text-ink-3/40' : 'border border-line text-ink-2')}
                      >
                        {w}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="mt-2 flex items-center gap-1">
                {d.id ? (
                  <Link href={`/gym/program/${d.id}`} className="inline-flex min-h-10 flex-1 items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink">
                    {d.exercises ? `${d.exercises} exercise${d.exercises === 1 ? '' : 's'}` : 'Add exercises'} <ArrowRight size={13} />
                  </Link>
                ) : (
                  <span className="flex-1 text-[12px] text-ink-3">Save to add exercises</span>
                )}
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="pressable grid size-10 place-items-center rounded-full text-ink-3 hover:bg-sunken disabled:opacity-30" aria-label="Move up">
                  <ArrowUp size={16} />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === days.length - 1} className="pressable grid size-10 place-items-center rounded-full text-ink-3 hover:bg-sunken disabled:opacity-30" aria-label="Move down">
                  <ArrowDown size={16} />
                </button>
                <button type="button" onClick={() => setDays((all) => all.filter((_, j) => j !== i))} disabled={days.length <= 1} className="pressable grid size-10 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-bad disabled:opacity-30" aria-label="Remove day">
                  <Trash size={16} />
                </button>
              </div>
            </li>
          ))}
        </ol>
        {days.length < 7 && (
          <button type="button" onClick={() => setDays((all) => [...all, { id: null, name: '', weekday: null, exercises: 0 }])} className="pressable flex min-h-12 items-center gap-2 rounded-[14px] border border-dashed border-line-strong px-4 text-[15px] text-ink-2 hover:border-ink-3 hover:text-ink">
            <Plus size={16} /> Add a workout day
          </button>
        )}
      </section>

      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <Button size="lg" block loading={pending} disabled={days.some((d) => !d.name.trim())} onClick={save}>
        Save program
      </Button>
      <p className="-mt-3 text-[12px] text-ink-3">Changes apply from today. Every past workout keeps the name and sets it was logged with.</p>
    </div>
  );
}
