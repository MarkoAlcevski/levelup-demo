'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { logBodyweightAction } from '@/lib/actions';
import { Button, Input } from '@/components/ui/primitives';

export function BodyweightForm({ today, unit }: { today: string; unit: 'kg' | 'lb' }) {
  const [w, setW] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <form
      className="flex items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(w.replace(',', '.'));
        if (!Number.isFinite(n) || n <= 0) return setError('Enter a weight.');
        start(async () => {
          const res = await logBodyweightAction(n, today);
          if (!res.ok) return setError(res.error);
          setW('');
          setError(null);
          router.refresh();
        });
      }}
    >
      <div className="flex-1">
        <Input aria-label={`Bodyweight today in ${unit}`} inputMode="decimal" value={w} onChange={(e) => setW(e.target.value.replace(/[^\d.,]/g, ''))} placeholder={`Today’s weight (${unit})`} />
        {error && <p className="mt-1 text-[13px] text-bad">{error}</p>}
      </div>
      <Button type="submit" size="lg" loading={pending} disabled={!w}>
        Log
      </Button>
    </form>
  );
}
