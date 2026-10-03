'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react';
import { EQUIPMENT_LABEL, MUSCLE_LABEL, type Equipment, type Muscle } from '@/lib/catalog/exercises';
import type { ProgramDay } from '@/lib/server/gym';
import { saveWorkoutDayAction } from '@/lib/actions';
import { Button, Field, Input, Select } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { ExercisePicker } from './exercise-picker';

interface Row {
  key: string;
  exerciseId: string | null;
  catalogKey: string | null;
  name: string;
  muscle: Muscle | null;
  equipment: Equipment | null;
  sets: number;
  repMin: string;
  repMax: string;
  weight: string;
  rest: string;
  note: string;
}

const REST_OPTIONS = [
  ['', 'No timer'], ['45', '45 s'], ['60', '1 min'], ['90', '1.5 min'], ['120', '2 min'], ['150', '2.5 min'], ['180', '3 min'], ['240', '4 min'], ['300', '5 min'],
] as const;

/** One workout day's exercises: sets, your rep range, an optional starting weight and rest timer. */
export function DayEditor({ day, unit }: { day: ProgramDay; unit: 'kg' | 'lb' }) {
  const [name, setName] = useState(day.name);
  const [rows, setRows] = useState<Row[]>(
    day.exercises.map((e) => ({
      key: e.id, exerciseId: e.exerciseId, catalogKey: null, name: e.name, muscle: e.muscle, equipment: e.equipment, sets: e.sets,
      repMin: e.repMin?.toString() ?? '', repMax: e.repMax?.toString() ?? '', weight: e.weight?.toString() ?? '', rest: e.restSeconds?.toString() ?? '', note: e.note ?? '',
    })),
  );
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const patch = (i: number, p: Partial<Row>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const num = (s: string) => (s.trim() ? Number(s.replace(',', '.')) : null);

  function save() {
    setError(null);
    start(async () => {
      const res = await saveWorkoutDayAction(day.id, {
        name: name.trim(),
        exercises: rows.map((r) => ({
          exerciseId: r.exerciseId,
          catalogKey: r.exerciseId ? null : r.catalogKey,
          sets: r.sets,
          repMin: num(r.repMin),
          repMax: num(r.repMax),
          weight: num(r.weight),
          restSeconds: num(r.rest),
          note: r.note.trim() || null,
        })),
      });
      if (!res.ok) return setError(res.error);
      toast.show({ title: `${name.trim()} saved`, detail: `${rows.length} exercise${rows.length === 1 ? '' : 's'}` });
      router.push('/gym/program');
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Field label="Workout name" htmlFor="day-name">
        <Input id="day-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
      </Field>

      <ol className="flex flex-col gap-3">
        {rows.map((r, i) => (
          <li key={r.key} className="rounded-[16px] border border-line-strong bg-surface p-3.5">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 font-mono text-[12px] text-ink-3 tnum">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-semibold text-ink">{r.name}</p>
                {(r.muscle || r.equipment) && (
                  <p className="text-[12px] text-ink-3">{[r.muscle && MUSCLE_LABEL[r.muscle], r.equipment && EQUIPMENT_LABEL[r.equipment]].filter(Boolean).join(' · ')}</p>
                )}
              </div>
              <button type="button" disabled={i === 0} onClick={() => setRows((all) => { const l = [...all]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; return l; })} className="pressable grid size-10 place-items-center rounded-full text-ink-3 hover:bg-sunken disabled:opacity-30" aria-label={`Move ${r.name} up`}>
                <ArrowUp size={16} />
              </button>
              <button type="button" disabled={i === rows.length - 1} onClick={() => setRows((all) => { const l = [...all]; [l[i + 1], l[i]] = [l[i], l[i + 1]]; return l; })} className="pressable grid size-10 place-items-center rounded-full text-ink-3 hover:bg-sunken disabled:opacity-30" aria-label={`Move ${r.name} down`}>
                <ArrowDown size={16} />
              </button>
              <button type="button" onClick={() => setRows((all) => all.filter((_, j) => j !== i))} className="pressable grid size-10 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-bad" aria-label={`Remove ${r.name}`}>
                <Trash size={16} />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-[88px_1fr] items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-ink-2">Sets</span>
                <div className="flex h-12 items-center rounded-[12px] border border-line-strong">
                  <button type="button" onClick={() => patch(i, { sets: Math.max(1, r.sets - 1) })} className="grid h-full w-8 place-items-center text-lg text-ink-2" aria-label="Fewer sets">
                    −
                  </button>
                  <span className="flex-1 text-center text-[17px] font-semibold text-ink tnum" aria-live="polite">{r.sets}</span>
                  <button type="button" onClick={() => patch(i, { sets: Math.min(20, r.sets + 1) })} className="grid h-full w-8 place-items-center text-lg text-ink-2" aria-label="More sets">
                    +
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-ink-2">Rep range (your target)</span>
                <div className="flex items-center gap-2">
                  <Input aria-label={`${r.name} reps from`} inputMode="numeric" value={r.repMin} onChange={(e) => patch(i, { repMin: e.target.value.replace(/[^\d]/g, '') })} placeholder="6" className="text-center" />
                  <span className="text-ink-3">–</span>
                  <Input aria-label={`${r.name} reps to`} inputMode="numeric" value={r.repMax} onChange={(e) => patch(i, { repMax: e.target.value.replace(/[^\d]/g, '') })} placeholder="8" className="text-center" />
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label={`Starting weight (${unit})`} htmlFor={`w-${r.key}`}>
                <Input id={`w-${r.key}`} inputMode="decimal" value={r.weight} onChange={(e) => patch(i, { weight: e.target.value.replace(/[^\d.,]/g, '') })} placeholder="Optional" />
              </Field>
              <Field label="Rest timer" htmlFor={`r-${r.key}`}>
                <Select id={`r-${r.key}`} value={r.rest} onChange={(e) => patch(i, { rest: e.target.value })}>
                  {REST_OPTIONS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Note" htmlFor={`n-${r.key}`} className="mt-3">
              <Input id={`n-${r.key}`} value={r.note} onChange={(e) => patch(i, { note: e.target.value })} maxLength={300} placeholder="Seat height, grip… (optional)" />
            </Field>
          </li>
        ))}
      </ol>

      <Button variant="outline" size="lg" block onClick={() => setPicking(true)}>
        <Plus size={18} /> Add exercise
      </Button>
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <Button size="lg" block loading={pending} disabled={!name.trim()} onClick={save}>
        Save {name.trim() || 'workout'}
      </Button>

      <ExercisePicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(p) =>
          setRows((all) => [
            ...all,
            { key: `${Date.now()}-${all.length}`, exerciseId: p.exerciseId, catalogKey: p.catalogKey, name: p.name, muscle: p.muscle, equipment: p.equipment, sets: 3, repMin: '', repMax: '', weight: '', rest: '', note: '' },
          ])
        }
      />
    </div>
  );
}
