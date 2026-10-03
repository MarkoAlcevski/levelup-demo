'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { EQUIPMENT_LABEL, MUSCLE_LABEL, searchCatalog, type Equipment, type Muscle } from '@/lib/catalog/exercises';
import { createExerciseAction, listExercisesAction } from '@/lib/actions';
import type { MyExercise } from '@/lib/server/gym';
import { Button, Field, Input, Select } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';

export interface PickedExercise {
  exerciseId: string | null;
  catalogKey: string | null;
  name: string;
  muscle: Muscle | null;
  equipment: Equipment | null;
}

/**
 * Search your own exercises and the library, or create one. Library entries are descriptive only
 * (muscle, equipment) — nothing here suggests what to train.
 */
export function ExercisePicker({ open, onClose, onPick, title = 'Add exercise' }: { open: boolean; onClose: () => void; onPick: (e: PickedExercise) => void; title?: string }) {
  const [q, setQ] = useState('');
  const [mine, setMine] = useState<MyExercise[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [muscle, setMuscle] = useState<Muscle | ''>('');
  const [equipment, setEquipment] = useState<Equipment | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setQ('');
    setCreating(false);
    setError(null);
    void listExercisesAction().then(setMine).catch(() => setMine([]));
  }, [open]);

  const term = q.trim().toLowerCase();
  const own = useMemo(() => (mine ?? []).filter((e) => !e.catalogKey && (!term || e.name.toLowerCase().includes(term))).slice(0, 8), [mine, term]);
  const used = new Set((mine ?? []).map((e) => e.catalogKey).filter(Boolean));
  const library = useMemo(() => searchCatalog(q, 14), [q]);
  const exact = [...own.map((e) => e.name), ...library.map((e) => e.name)].some((n) => n.toLowerCase() === term);

  return (
    <Sheet open={open} onClose={onClose} title={title} description="Search the library or create your own.">
      {creating ? (
        <form
          className="flex flex-col gap-4 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              const res = await createExerciseAction({ name: q.trim(), muscle: muscle || null, equipment: equipment || null });
              if (!res.ok) return setError(res.error);
              onPick({ exerciseId: res.id, catalogKey: null, name: res.name, muscle: muscle || null, equipment: equipment || null });
              onClose();
            });
          }}
        >
          <Field label="Name" htmlFor="ex-name">
            <Input id="ex-name" autoFocus value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Main muscle" htmlFor="ex-muscle">
              <Select id="ex-muscle" value={muscle} onChange={(e) => setMuscle(e.target.value as Muscle | '')}>
                <option value="">—</option>
                {Object.entries(MUSCLE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Equipment" htmlFor="ex-eq">
              <Select id="ex-eq" value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment | '')}>
                <option value="">—</option>
                {Object.entries(EQUIPMENT_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {error && <p className="text-sm text-bad" role="alert">{error}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Back
            </Button>
            <Button type="submit" size="lg" className="flex-1" loading={pending} disabled={!q.trim()}>
              Create exercise
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3 pt-1">
          <label className="relative block">
            <span className="sr-only">Search exercises</span>
            <MagnifyingGlass size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bench press, squat, curl…" className="pl-10" />
          </label>
          {term && !exact && (
            <button type="button" onClick={() => setCreating(true)} className="pressable flex min-h-12 items-center gap-2 rounded-[12px] border border-dashed border-line-strong px-3.5 text-left text-[15px] text-ink-2 hover:border-ink-3 hover:text-ink">
              <Plus size={16} /> Create “{q.trim()}”
            </button>
          )}
          {own.length > 0 && (
            <div>
              <p className="label-mono mb-1">Your exercises</p>
              <ul className="divide-y divide-line">
                {own.map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => { onPick({ exerciseId: e.id, catalogKey: null, name: e.name, muscle: e.muscle, equipment: e.equipment }); onClose(); }} className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left hover:text-ink">
                      <span className="text-[15px] text-ink">{e.name}</span>
                      <span className="text-[12px] text-ink-3">{[e.muscle && MUSCLE_LABEL[e.muscle], e.equipment && EQUIPMENT_LABEL[e.equipment]].filter(Boolean).join(' · ') || 'Custom'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="label-mono mb-1">Library</p>
            <ul className="divide-y divide-line">
              {library.map((e) => (
                <li key={e.key}>
                  <button type="button" onClick={() => { onPick({ exerciseId: null, catalogKey: e.key, name: e.name, muscle: e.muscle, equipment: e.equipment }); onClose(); }} className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left">
                    <span className="text-[15px] text-ink">
                      {e.name}
                      {used.has(e.key) && <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">used</span>}
                    </span>
                    <span className="shrink-0 text-[12px] text-ink-3">
                      {MUSCLE_LABEL[e.muscle]} · {EQUIPMENT_LABEL[e.equipment]}
                    </span>
                  </button>
                </li>
              ))}
              {!library.length && <li className="py-4 text-sm text-ink-3">Nothing in the library matches — create it above.</li>}
            </ul>
          </div>
        </div>
      )}
    </Sheet>
  );
}
