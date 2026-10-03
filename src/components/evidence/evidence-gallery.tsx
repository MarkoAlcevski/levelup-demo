'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { monthName } from '@/lib/engine/dates';
import type { ProofView } from '@/lib/server/proofs';
import { deleteProofAction, evidencePageAction } from '@/lib/actions';
import type { EvidenceFacets } from '@/lib/server/proofs';
import { Chip, Select } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { ProofTile } from './proof-tile';
import { Lightbox } from './lightbox';

const KIND_LABEL: Record<string, string> = { image: 'Photos & screenshots', photo: 'Photos', screenshot: 'Screenshots', video: 'Videos', note: 'Notes', link: 'Links', file: 'Files' };
export type EvidenceFilters = { areaKind: string | null; month: string | null; kind: string | null };

/** Month-grouped evidence wall — filter by area, month and type — with infinite loading and a lightbox. */
export function EvidenceGallery({
  initial,
  nextCursor,
  facets,
  filters: initialFilters,
}: {
  initial: ProofView[];
  nextCursor: string | null;
  facets: EvidenceFacets;
  filters: EvidenceFilters;
}) {
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(nextCursor);
  const [filters, setFilters] = useState<EvidenceFilters>(initialFilters);
  const [open, setOpen] = useState<number | null>(null);
  const [loading, start] = useTransition();
  const sentinel = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    setItems(initial);
    setCursor(nextCursor);
  }, [initial, nextCursor]);

  const load = (reset: boolean, f = filters) =>
    start(async () => {
      const page = await evidencePageAction(reset ? null : cursor, f);
      setItems((cur) => (reset ? page.proofs : [...cur, ...page.proofs]));
      setCursor(page.nextCursor);
    });
  const apply = (patch: Partial<EvidenceFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    load(true, next);
    const qs = new URLSearchParams();
    if (next.areaKind) qs.set('area', next.areaKind);
    if (next.month) qs.set('month', next.month);
    if (next.kind) qs.set('type', next.kind);
    window.history.replaceState(null, '', `${window.location.pathname}${qs.size ? `?${qs}` : ''}`);
  };
  const kinds = [...new Set(facets.kinds.map((k) => (k === 'photo' || k === 'screenshot' ? 'image' : k)))];

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && !loading && load(false), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, loading]);

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: { p: ProofView; i: number }[] }[] = [];
    items.forEach((p, i) => {
      const key = p.day.slice(0, 7);
      let g = out.at(-1);
      if (!g || g.key !== key) {
        g = { key, label: `${monthName(p.day, true)} ${p.day.slice(0, 4)}`, items: [] };
        out.push(g);
      }
      g.items.push({ p, i });
    });
    return out;
  }, [items]);

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3">
        {facets.areas.length > 1 && (
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Area">
            <Chip selected={!filters.areaKind} onClick={() => apply({ areaKind: null })}>
              All areas
            </Chip>
            {facets.areas.map((a) => (
              <Chip key={a.id} selected={filters.areaKind === a.id} onClick={() => apply({ areaKind: a.id })}>
                {a.name}
              </Chip>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Select aria-label="Month" value={filters.month ?? ''} onChange={(e) => apply({ month: e.target.value || null })}>
            <option value="">Any month</option>
            {facets.months.map((m) => (
              <option key={m} value={m}>
                {monthName(`${m}-01`, true)} {m.slice(0, 4)}
              </option>
            ))}
          </Select>
          <Select aria-label="Type" value={filters.kind ?? ''} onChange={(e) => apply({ kind: e.target.value || null })}>
            <option value="">Any type</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k] ?? k}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {groups.map((g) => (
        <section key={g.key} className="mb-7" aria-label={g.label}>
          <h3 className="label-mono sticky top-0 z-10 -mx-4 mb-2 bg-bg/90 px-4 py-2 backdrop-blur">
            {g.label} · {g.items.length}
          </h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            {g.items.map(({ p, i }) => (
              <ProofTile key={p.id} proof={p} onOpen={() => setOpen(i)} />
            ))}
          </div>
        </section>
      ))}
      {!items.length && !loading && <p className="py-8 text-center text-sm text-ink-3">No proof matches these filters.</p>}
      <div ref={sentinel} className="h-8" />
      {loading && <p className="py-4 text-center text-sm text-ink-3">Loading…</p>}
      <Lightbox
        proofs={items}
        index={open}
        onIndex={setOpen}
        onClose={() => setOpen(null)}
        onDelete={async (p) => {
          if (!window.confirm('Delete this proof? The completion stays; only the evidence is removed.')) return;
          await deleteProofAction(p.id);
          setItems((cur) => cur.filter((x) => x.id !== p.id));
          setOpen(null);
          toast.show({ title: 'Proof deleted' });
          router.refresh();
        }}
      />
    </div>
  );
}
