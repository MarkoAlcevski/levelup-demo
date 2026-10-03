'use client';

import { FilePdf, LinkSimple, Play, Quotes } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/engine/dates';
import type { ProofView } from '@/lib/server/proofs';
import { AreaIcon } from '@/components/icons';

function host(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** One piece of evidence. Photos show themselves; notes and links become typographic cards. */
export function ProofTile({ proof: p, onOpen, compact }: { proof: ProofView; onOpen?: (p: ProofView) => void; compact?: boolean }) {
  const isImage = (p.kind === 'photo' || p.kind === 'screenshot') && p.thumbUrl;
  const label = `${p.missionTitle}, ${formatDay(p.day)} — ${p.kind}`;
  const Inner = (
    <>
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.thumbUrl!} alt={label} loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
      ) : p.kind === 'note' ? (
        <div className={cn('absolute inset-0 flex flex-col p-3', !compact && 'pb-9')}>
          <Quotes size={compact ? 14 : 18} weight="fill" className="shrink-0 text-accent-text" />
          <p className={cn('mt-1.5 overflow-hidden text-ink', compact ? 'line-clamp-3 text-[12px] leading-4' : 'line-clamp-4 text-[14px] leading-5')}>{p.body}</p>
        </div>
      ) : p.kind === 'link' ? (
        <div className={cn('absolute inset-0 flex flex-col justify-between p-3', !compact && 'pb-9')}>
          <LinkSimple size={compact ? 14 : 18} className="text-ink-2" />
          <div className="min-w-0">
            {p.body && <p className={cn('truncate text-ink', compact ? 'text-[12px]' : 'text-[14px]')}>{p.body}</p>}
            <p className="truncate font-mono text-[11px] text-ink-3">{host(p.url)}</p>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 grid place-items-center text-ink-2">
          {p.kind === 'video' ? <Play size={28} weight="fill" /> : <FilePdf size={28} />}
        </div>
      )}
      {!compact && (
        <div className={cn('absolute inset-x-0 bottom-0 flex items-center gap-1.5 px-2.5 pt-6 pb-2', isImage ? 'bg-linear-to-t from-black/70 to-transparent text-white' : 'text-ink-3')}>
          <AreaIcon kind={p.areaKind} size={12} className="shrink-0 opacity-80" />
          <span className="truncate text-[11px] font-medium">{p.missionTitle}</span>
          <span className="ml-auto shrink-0 font-mono text-[10px] opacity-80">{formatDay(p.day)}</span>
        </div>
      )}
    </>
  );
  const cls = cn(
    'group relative block aspect-[4/5] w-full overflow-hidden rounded-[10px] border border-line bg-surface text-left',
    onOpen && 'pressable hover:border-line-strong',
  );
  return onOpen ? (
    <button type="button" onClick={() => onOpen(p)} className={cls} aria-label={`Open ${label}`}>
      {Inner}
    </button>
  ) : (
    <div className={cls}>{Inner}</div>
  );
}
