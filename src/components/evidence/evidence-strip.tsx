'use client';

import { useState } from 'react';
import type { ProofView } from '@/lib/server/proofs';
import { ProofTile } from './proof-tile';
import { Lightbox } from './lightbox';

export function EvidenceStrip({ proofs, total }: { proofs: ProofView[]; total: number }) {
  const [i, setI] = useState<number | null>(null);
  return (
    <>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {proofs.map((p, k) => (
          <ProofTile key={p.id} proof={p} compact onOpen={() => setI(k)} />
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-3">{total.toLocaleString('en-US')} pieces of evidence on record.</p>
      <Lightbox proofs={proofs} index={i} onIndex={setI} onClose={() => setI(null)} />
    </>
  );
}
