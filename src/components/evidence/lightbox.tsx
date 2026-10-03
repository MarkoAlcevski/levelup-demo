'use client';

import { useEffect } from 'react';
import { CaretLeft, CaretRight, X, LinkSimple, Trash } from '@phosphor-icons/react';
import { formatDay, weekdayName } from '@/lib/engine/dates';
import { fmtValue } from '@/lib/format';
import type { ProofView } from '@/lib/server/proofs';

/** Full-screen evidence viewer. Arrow keys / buttons step through; Escape closes. */
export function Lightbox({
  proofs,
  index,
  onIndex,
  onClose,
  onDelete,
}: {
  proofs: ProofView[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  onDelete?: (p: ProofView) => void;
}) {
  const p = index != null ? proofs[index] : null;
  useEffect(() => {
    if (index == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && index < proofs.length - 1) onIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [index, proofs.length, onClose, onIndex]);

  if (!p || index == null) return null;
  const media = (p.kind === 'photo' || p.kind === 'screenshot') && p.fullUrl;
  return (
    <div role="dialog" aria-modal="true" aria-label={`${p.missionTitle} proof`} className="fixed inset-0 z-[70] flex flex-col bg-[oklch(0.1_0.004_260/0.96)] text-white backdrop-blur-sm">
      <div className="flex items-center gap-3 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">{p.missionTitle}</p>
          <p className="truncate text-[13px] text-white/60">
            {weekdayName(p.day, true)}, {formatDay(p.day)} · {p.areaName}
            {p.value != null ? ` · ${fmtValue(p.value, p.unit)}` : ''}
          </p>
        </div>
        {onDelete && (
          <button type="button" onClick={() => onDelete(p)} className="pressable grid size-10 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white" aria-label="Delete this proof">
            <Trash size={18} />
          </button>
        )}
        <button type="button" autoFocus onClick={onClose} className="pressable grid size-10 place-items-center rounded-full hover:bg-white/10" aria-label="Close">
          <X size={20} weight="bold" />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6">
        {media ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.fullUrl!} alt={`${p.missionTitle} proof, ${formatDay(p.day)}`} className="max-h-full max-w-full rounded-[10px] object-contain" />
        ) : p.kind === 'video' && p.fullUrl ? (
          <video src={p.fullUrl} controls playsInline className="max-h-full max-w-full rounded-[10px]" />
        ) : p.kind === 'file' && p.fullUrl ? (
          <a href={p.fullUrl} target="_blank" rel="noreferrer" className="rounded-[12px] border border-white/20 px-5 py-3 text-sm">
            Open file
          </a>
        ) : p.kind === 'link' ? (
          <div className="max-w-lg text-center">
            <LinkSimple size={28} className="mx-auto text-white/60" />
            {p.body && <p className="mt-4 text-xl">{p.body}</p>}
            <a href={p.url!} target="_blank" rel="noreferrer noopener" className="mt-3 inline-block break-all font-mono text-sm text-white/70 underline underline-offset-4">
              {p.url}
            </a>
          </div>
        ) : (
          <blockquote className="max-w-xl text-center text-2xl leading-snug font-medium tracking-[-0.01em] text-balance">“{p.body}”</blockquote>
        )}
        {index > 0 && (
          <button type="button" onClick={() => onIndex(index - 1)} className="pressable absolute left-2 grid size-11 place-items-center rounded-full bg-white/10 hover:bg-white/20 sm:left-6" aria-label="Previous">
            <CaretLeft size={20} weight="bold" />
          </button>
        )}
        {index < proofs.length - 1 && (
          <button type="button" onClick={() => onIndex(index + 1)} className="pressable absolute right-2 grid size-11 place-items-center rounded-full bg-white/10 hover:bg-white/20 sm:right-6" aria-label="Next">
            <CaretRight size={20} weight="bold" />
          </button>
        )}
      </div>
    </div>
  );
}
