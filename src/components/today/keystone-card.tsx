'use client';

import { useState, useTransition } from 'react';
import { ArrowCounterClockwise, PencilSimple, Target } from '@phosphor-icons/react';
import type { Keystone } from '@/lib/server/keystone';
import { keystoneStatusAction, setKeystoneAction } from '@/lib/actions';
import { cn } from '@/lib/cn';
import { Button, Field, Input } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';

/**
 * Weekly Focus: the one thing that makes this week a win. (Stored as a "keystone" — the name
 * changed, the data didn't.) Compact on purpose: one line until it's done.
 */
export function FocusCard({
  focus,
  weekNumber,
  daysLeft,
  onDone,
}: {
  focus: Keystone | null;
  weekNumber: number;
  daysLeft: number;
  onDone?: (title: string, xp: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const done = focus?.status === 'done';

  if (!focus) {
    return (
      <>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="pressable flex min-h-12 w-full items-center gap-3 rounded-[14px] border border-dashed border-line-strong px-4 py-3 text-left hover:border-ink-3"
        >
          <Target size={18} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium text-ink">Set a weekly focus</span>
            <span className="block text-[13px] text-ink-3">One thing that would make week {weekNumber} a win.</span>
          </span>
        </button>
        <FocusEditor open={editing} onClose={() => setEditing(false)} initial="" />
      </>
    );
  }

  return (
    <>
      <section
        aria-label="Weekly focus"
        className={cn('flex items-center gap-3 rounded-[14px] border px-4 py-3', done ? 'border-accent/35 bg-accent-soft' : 'border-line-strong bg-surface')}
      >
        <Target size={18} weight={done ? 'fill' : 'regular'} className={cn('shrink-0', done ? 'text-accent-text' : 'text-ink-2')} />
        <div className="min-w-0 flex-1">
          <p className="label-mono">
            Weekly focus · {done ? 'done' : daysLeft <= 1 ? 'last day' : `${daysLeft} days left`}
          </p>
          <p className={cn('mt-0.5 text-[16px] font-semibold tracking-[-0.01em]', done ? 'text-ink-2 line-through decoration-ink-3/60' : 'text-ink')}>{focus.title}</p>
        </div>
        {done ? (
          <Button size="sm" variant="ghost" loading={pending} aria-label="Reopen weekly focus" onClick={() => start(async () => void (await keystoneStatusAction(focus.id, false)))}>
            <ArrowCounterClockwise size={14} />
          </Button>
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="Edit weekly focus" onClick={() => setEditing(true)}>
              <PencilSimple size={14} />
            </Button>
            <Button
              size="sm"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const res = await keystoneStatusAction(focus.id, true);
                  if (res.ok) onDone?.(focus.title, res.xp ?? 150);
                  else toast.show({ title: res.error, tone: 'error' });
                })
              }
            >
              Done
            </Button>
          </div>
        )}
      </section>
      <FocusEditor open={editing} onClose={() => setEditing(false)} initial={focus.title} />
    </>
  );
}

export function FocusEditor({ open, onClose, initial, week = 'current' }: { open: boolean; onClose: () => void; initial: string; week?: 'current' | 'next' }) {
  const [title, setTitle] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="sm"
      title={week === 'next' ? 'Next week’s focus' : 'This week’s focus'}
      description="One outcome that would make the week a win. Something you can finish."
    >
      <form
        className="flex flex-col gap-4 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await setKeystoneAction({ title, week });
            if (res.ok) onClose();
            else setError(res.error);
          });
        }}
      >
        <Field label="The one thing" htmlFor="focus-title" error={error}>
          <Input id="focus-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="Publish the landing page" />
        </Field>
        <Button type="submit" size="lg" block loading={pending} disabled={!title.trim()}>
          Set focus
        </Button>
      </form>
    </Sheet>
  );
}

/** V1 name, kept for the review page. */
export const KeystoneEditor = FocusEditor;
