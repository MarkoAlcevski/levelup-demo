'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { NotePencil, Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';

export function SessionActions({ id, day }: { id: string; day: string }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Link href={`/gym/workout?id=${id}&edit=1`} className="pressable inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-[12px] border border-line-strong text-[15px] font-medium text-ink hover:bg-sunken">
          <NotePencil size={16} /> Edit sets
        </Link>
        <Link href={`/journal/${day}`} className="pressable inline-flex h-11 flex-1 items-center justify-center rounded-[12px] bg-sunken text-[15px] font-medium text-ink hover:bg-line-strong">
          Journal for this day
        </Link>
      </div>
      {confirm ? (
        <div className="flex items-center gap-2 rounded-[12px] border border-bad/30 px-3 py-2">
          <p className="flex-1 text-[13px] text-ink-2">Delete this workout? If it was the day’s only one, the day stops counting toward your target.</p>
          <Button
            size="sm"
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await fetch(`/api/v1/workouts/${id}`, { method: 'DELETE' });
              toast.show({ title: 'Workout deleted' });
              router.push('/gym/history');
              router.refresh();
            }}
          >
            Delete
          </Button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className="inline-flex min-h-11 items-center justify-center gap-1.5 text-[13px] text-ink-3 hover:text-bad">
          <Trash size={14} /> Delete workout
        </button>
      )}
    </div>
  );
}
