'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';

/**
 * Bottom sheet on phones, centred dialog on larger screens. Built on <dialog>, so focus
 * trapping, Escape, and inert background come from the platform. Drag the handle down (or
 * flick it) to dismiss on touch.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  hideTitle = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  hideTitle?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    setShown(false);
    const t = setTimeout(() => {
      ref.current?.close();
      setMounted(false);
    }, 220);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!mounted || !open || !d) return;
    if (!d.open) d.showModal();
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [mounted, open]);

  // drag to dismiss (touch)
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || drag.current) return;
    drag.current = { y: e.clientY, t: Date.now(), dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (panel.current) panel.current.style.transition = 'none';
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !panel.current) return;
    const raw = e.clientY - drag.current.y;
    const dy = raw < 0 ? raw / 6 : raw; // resist upward drags
    drag.current.dy = dy;
    panel.current.style.transform = `translateY(${dy}px)`;
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !panel.current) return;
    panel.current.style.transition = '';
    panel.current.style.transform = '';
    const velocity = d.dy / Math.max(1, Date.now() - d.t);
    if (d.dy > 110 || velocity > 0.5) onClose();
  };

  if (!mounted) return null;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      data-shown={shown}
      className="sheet fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 sm:grid sm:place-items-center"
    >
      <div
        ref={panel}
        className={cn(
          'sheet-panel absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col overflow-hidden rounded-t-[20px] border border-line-strong bg-raised shadow-pop',
          'sm:relative sm:inset-auto sm:w-[calc(100%-32px)] sm:rounded-[20px]',
          size === 'sm' && 'sm:max-w-[420px]',
          size === 'md' && 'sm:max-w-[520px]',
          size === 'lg' && 'sm:max-w-[720px]',
        )}
      >
        <div
          className="flex shrink-0 touch-none flex-col sm:touch-auto"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line-strong sm:hidden" aria-hidden />
          <div className={cn('flex items-start gap-3 px-5 pt-4 pb-3', hideTitle && 'sr-only')}>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-lg font-semibold tracking-[-0.01em] text-ink">
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-0.5 text-sm text-ink-3">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="pressable -mr-2 -mt-1 grid size-10 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink"
              aria-label="Close"
            >
              <X size={18} weight="bold" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
        {footer && <div className="shrink-0 border-t border-line bg-raised px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</div>}
        {!footer && <div className="h-[env(safe-area-inset-bottom)] shrink-0" />}
      </div>
      <style>{`
        .sheet::backdrop { background: var(--scrim); opacity: 0; transition: opacity 220ms ease; }
        .sheet[data-shown='true']::backdrop { opacity: 1; }
        .sheet-panel { transform: translateY(100%); transition: transform 320ms var(--ease-drawer); }
        .sheet[data-shown='true'] .sheet-panel { transform: translateY(0); }
        @media (min-width: 640px) {
          .sheet-panel { transform: scale(0.97) translateY(6px); opacity: 0; transition: transform 220ms var(--ease-out), opacity 180ms ease; }
          .sheet[data-shown='true'] .sheet-panel { transform: none; opacity: 1; }
        }
      `}</style>
    </dialog>
  );
}
