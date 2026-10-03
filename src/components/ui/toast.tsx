'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * One toast at a time — a new one replaces the old. Actions (Undo, Add proof) live here so
 * the one-tap completion stays one tap, and everything else is a single optional tap away.
 * The timer pauses while hovered and while the tab is hidden.
 */

export interface ToastAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export interface ToastInput {
  title: string;
  detail?: string;
  tone?: 'default' | 'accent' | 'error';
  actions?: ToastAction[];
  duration?: number;
  leading?: React.ReactNode;
}

interface ToastState extends ToastInput {
  id: number;
}

const Ctx = createContext<{ show: (t: ToastInput) => void; dismiss: () => void } | null>(null);

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast outside ToastProvider');
  return c;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [leaving, setLeaving] = useState(false);
  const seq = useRef(0);
  const remaining = useRef(0);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const dismiss = useCallback(() => {
    clear();
    setLeaving(true);
    setTimeout(() => {
      setToast(null);
      setLeaving(false);
    }, 160);
  }, []);

  const schedule = useCallback(
    (ms: number) => {
      clear();
      remaining.current = ms;
      startedAt.current = Date.now();
      timer.current = setTimeout(dismiss, ms);
    },
    [dismiss],
  );

  const show = useCallback(
    (t: ToastInput) => {
      seq.current += 1;
      setLeaving(false);
      setToast({ ...t, id: seq.current });
      schedule(t.duration ?? 6000);
    },
    [schedule],
  );

  const pause = () => {
    if (!timer.current) return;
    clear();
    remaining.current -= Date.now() - startedAt.current;
  };
  const resume = () => {
    if (toast && !timer.current && remaining.current > 0) schedule(remaining.current);
  };

  useEffect(() => {
    const onVis = () => (document.hidden ? pause() : resume());
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  });

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4 bottom-[calc(84px+env(safe-area-inset-bottom))] lg:bottom-6 lg:justify-end lg:px-6"
        role="status"
        aria-live="polite"
      >
        {toast && (
          <div
            key={toast.id}
            onMouseEnter={pause}
            onMouseLeave={resume}
            className={cn(
              'toast pointer-events-auto flex w-full max-w-[440px] items-center gap-3 rounded-[14px] border py-2.5 pl-4 pr-2 shadow-pop',
              toast.tone === 'error' ? 'border-bad/40 bg-raised' : 'border-line-strong bg-raised',
              leaving && 'toast-leave',
            )}
          >
            {toast.leading}
            <div className="min-w-0 flex-1 py-1">
              <p className="truncate text-sm font-medium text-ink">{toast.title}</p>
              {toast.detail && <p className="truncate text-xs text-ink-3">{toast.detail}</p>}
            </div>
            {toast.actions?.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => {
                  a.onClick();
                  dismiss();
                }}
                className={cn(
                  'pressable h-9 shrink-0 rounded-[10px] px-3 text-sm font-medium',
                  a.primary ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:bg-sunken hover:text-ink',
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <style>{`
        .toast { transition: transform 260ms var(--ease-out), opacity 200ms ease; transform: translateY(0); opacity: 1; }
        @starting-style { .toast { transform: translateY(12px); opacity: 0; } }
        .toast-leave { transform: translateY(8px) !important; opacity: 0 !important; transition-duration: 150ms !important; }
      `}</style>
    </Ctx.Provider>
  );
}
