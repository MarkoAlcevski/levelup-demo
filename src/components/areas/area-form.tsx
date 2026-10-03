'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { AREA_EXAMPLES, AREA_ICONS } from '@/lib/modules';
import { createAreaAction, updateAreaAction } from '@/lib/actions';
import { Button, Field, Input } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { ICONS } from '@/components/icons';

type IconKey = (typeof AREA_ICONS)[number];

/** Create or rename an area and choose its icon. A first routine is optional. */
export function AreaForm({
  open,
  onClose,
  area,
}: {
  open: boolean;
  onClose: () => void;
  area?: { id: string; name: string; icon: string | null } | null;
}) {
  const [name, setName] = useState(area?.name ?? '');
  const [icon, setIcon] = useState<IconKey>((area?.icon as IconKey) ?? 'hexagon');
  const [routine, setRoutine] = useState('');
  const [perWeek, setPerWeek] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function save() {
    setError(null);
    start(async () => {
      if (area) {
        const res = await updateAreaAction(area.id, { name, icon });
        if (!res.ok) return setError(res.error);
        toast.show({ title: 'Area saved' });
        onClose();
        router.refresh();
        return;
      }
      const res = await createAreaAction({
        name,
        icon,
        firstRoutine: routine.trim() ? { title: routine.trim(), cadence: perWeek === 7 ? 'daily' : 'weekly', perWeek: perWeek === 7 ? null : perWeek ?? 1 } : null,
      });
      if (!res.ok) return setError(res.error);
      toast.show({ title: `${name.trim()} created`, tone: 'accent' });
      onClose();
      router.push(`/areas/${res.id}`);
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title={area ? 'Edit area' : 'New area'} description={area ? undefined : 'Anything you want to keep doing — you decide what goes in it.'}>
      <form
        className="flex flex-col gap-5 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Name" htmlFor="area-name">
          <Input id="area-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={AREA_EXAMPLES.slice(0, 3).join(', ') + '…'} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Icon</span>
          <div className="grid grid-cols-8 gap-1.5" role="radiogroup" aria-label="Icon">
            {AREA_ICONS.map((k) => {
              const I = ICONS[k];
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={icon === k}
                  aria-label={k}
                  onClick={() => setIcon(k)}
                  className={cn('pressable grid aspect-square min-h-10 place-items-center rounded-[10px]', icon === k ? 'bg-ink text-bg' : 'text-ink-3 hover:bg-sunken hover:text-ink')}
                >
                  <I size={19} />
                </button>
              );
            })}
          </div>
        </div>
        {!area && (
          <div className="flex flex-col gap-2 rounded-[14px] border border-line p-3">
            <Field label="First routine (optional)" htmlFor="area-routine">
              <Input id="area-routine" value={routine} onChange={(e) => setRoutine(e.target.value)} maxLength={120} placeholder="e.g. Outreach" />
            </Field>
            {routine.trim() && (
              <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="How often">
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={perWeek === n}
                    onClick={() => setPerWeek(n)}
                    className={cn('pressable h-10 min-w-10 rounded-full px-2.5 text-sm font-medium', perWeek === n ? 'bg-ink text-bg' : 'border border-line-strong text-ink-2')}
                  >
                    {n === 7 ? 'Daily' : `${n}×`}
                  </button>
                ))}
                <span className="text-[13px] text-ink-3">a week</span>
              </div>
            )}
          </div>
        )}
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        <Button type="submit" size="lg" block loading={pending} disabled={!name.trim() || (!!routine.trim() && !perWeek && !area)}>
          {area ? 'Save' : 'Create area'}
        </Button>
      </form>
    </Sheet>
  );
}
