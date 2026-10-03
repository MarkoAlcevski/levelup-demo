import type { Metadata } from 'next';
import { getViewer } from '@/lib/server/context';
import { evidenceFacets, listEvidence, loadRecordTotals } from '@/lib/server/proofs';
import { fmtNumber } from '@/lib/format';
import { Page, Section } from '@/components/page';
import { ProgressSubnav } from '@/components/progress/subnav';
import { EvidenceGallery } from '@/components/evidence/evidence-gallery';
import { AreaIconServer } from '@/components/icons-server';

export const metadata: Metadata = { title: 'Evidence' };

const KINDS = ['image', 'photo', 'screenshot', 'video', 'note', 'link', 'file'];

export default async function EvidencePage({ searchParams }: { searchParams: Promise<{ area?: string; month?: string; type?: string }> }) {
  const viewer = await getViewer();
  const sp = await searchParams;
  const filters = {
    areaKind: sp.area && /^[0-9a-f-]{36}$/i.test(sp.area) ? sp.area : null,
    month: sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : null,
    kind: sp.type && KINDS.includes(sp.type) ? sp.type : null,
  };
  const year = Number(viewer.today.slice(0, 4));
  const [first, record, facets] = await Promise.all([listEvidence(viewer, { limit: 48, ...filters }), loadRecordTotals(viewer, year), evidenceFacets(viewer)]);
  const filtered = !!(filters.areaKind || filters.month || filters.kind);
  const hours = Math.round(record.minutes / 60);

  return (
    <Page title="Evidence" subnav={<ProgressSubnav />}>
      <section aria-labelledby="record-h" className="card overflow-hidden">
        <div className="px-5 pt-5 pb-4">
          <p className="label-mono">The record · {year}</p>
          <h2 id="record-h" className="mt-2 text-[22px] font-semibold leading-snug tracking-[-0.02em] text-ink text-balance">
            {record.kept ? (
              <>
                {fmtNumber(record.kept)} routine{record.kept === 1 ? '' : 's'} done across {fmtNumber(record.activeDays)} day{record.activeDays === 1 ? '' : 's'}
                {hours > 0 ? <>, {fmtNumber(hours)} hours of focused work</> : null}.
              </>
            ) : (
              'Your record for this year starts with the first routine you finish.'
            )}
          </h2>
          {record.proofs > 0 && (
            <p className="mt-1.5 text-sm text-ink-3">
              {fmtNumber(record.proofs)} pieces of proof · {fmtNumber(record.photos)} photos and screenshots
            </p>
          )}
        </div>
        {record.perMission.length > 0 && (
          <ul className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-3">
            {record.perMission.slice(0, 9).map((m) => (
              <li key={m.id} className="flex flex-col gap-0.5 bg-surface px-5 py-3.5">
                <span className="flex items-center gap-1.5 text-[13px] text-ink-3">
                  <AreaIconServer kind={m.areaKind} size={13} /> <span className="truncate">{m.title}</span>
                </span>
                <span className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
                  {m.measure === 'duration' ? `${fmtNumber(Math.round(m.total / 60))} h` : m.measure === 'quantity' ? fmtNumber(m.total) : fmtNumber(m.sessions)}
                </span>
                <span className="text-xs text-ink-3">
                  {m.measure === 'check' ? (m.sessions === 1 ? 'time' : 'times') : m.measure === 'quantity' ? m.unit : `${fmtNumber(m.sessions)} sessions`}
                  {m.measure === 'quantity' ? ` · ${fmtNumber(m.sessions)} days` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Section title="Proof">
        {first.proofs.length || filtered ? (
          <EvidenceGallery initial={first.proofs} nextCursor={first.nextCursor} facets={facets} filters={filters} />
        ) : (
          <div className="rounded-[16px] border border-dashed border-line-strong px-6 py-10 text-center">
            <p className="text-lg font-semibold text-ink">No proof yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-3">
              Your evidence starts the first time you attach a photo, screenshot, note or link to something you finished.
            </p>
            <a href="/today" className="pressable mt-5 inline-flex h-11 items-center rounded-[12px] bg-accent px-5 font-medium text-accent-ink">
              Go to Today
            </a>
          </div>
        )}
      </Section>
    </Page>
  );
}
