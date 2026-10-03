'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/primitives';
import { KeystoneEditor } from '@/components/today/keystone-card';
import { KeystoneGlyph } from '@/components/viz/marks';

export function NextKeystone({ current }: { current?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {current ? (
        <p className="flex items-center gap-2 text-sm text-ink">
          <KeystoneGlyph size={14} className="text-accent-text" /> This week: {current}
        </p>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <KeystoneGlyph size={16} /> Set this week’s Weekly Focus
        </Button>
      )}
      <Link href="/today" className="pressable inline-flex h-11 items-center rounded-[12px] px-4 text-[15px] font-medium text-ink-2 hover:bg-sunken hover:text-ink">
        Back to Today
      </Link>
      <KeystoneEditor open={open} onClose={() => setOpen(false)} initial="" />
    </div>
  );
}
