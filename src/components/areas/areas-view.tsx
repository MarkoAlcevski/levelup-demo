'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowRight, ArrowUp, Barbell, BookOpenText, CaretDown, Plus } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import type { AreasPage } from '@/lib/server/areas';
import { reorderAreasAction, restoreAreaAction, setModuleAction } from '@/lib/actions';
import { fmtPct } from '@/lib/format';
import { Button } from '@/components/ui/primitives';
import { Pips } from '@/components/viz/marks';
import { AreaIcon } from '@/components/icons';
import { useToast } from '@/components/ui/toast';
import { fmtAmount } from '@/components/learning/session-sheet';
import { AreaForm } from './area-form';

/** "What am I tracking?" — Gym, Learning and the areas you made. */
export function AreasView({ data }: { data: AreasPage }) {
  const [creating, setCreating] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [order, setOrder] = useState(data.areas.map((a) => a.id));
  const [showArchived, setShowArchived] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const byId = new Map(data.areas.map((a) => [a.id, a]));
  const showGym = data.modules.includes('gym') || !!data.gym;
  const showLearning = data.modules.includes('learning') || data.learning.length > 0;
  const unused = (['gym', 'learning'] as const).filter((m) => (m === 'gym' ? !showGym : !showLearning));

  const enable = (m: 'gym' | 'learning') =>
    start(async () => {
      await setModuleAction(m, true);
      router.push(m === 'gym' ? '/gym' : '/learning');
    });

  return (
    <>
      {(showGym || showLearning) && (
        <section aria-label="Tools" data-tour="areas-tools" className="grid gap-3 sm:grid-cols-2">
          {showGym && (
            <Link href="/gym" className="pressable group rounded-[16px] border border-line-strong bg-surface p-4 hover:border-ink-3">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-[12px] bg-accent-soft text-accent-text">
                  <Barbell size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-semibold text-ink">Gym</span>
                  <span className="block text-[13px] text-ink-3">
                    {data.gym ? (data.gym.next ? `Next: ${data.gym.next.name}` : 'Your program') : 'Build your training plan'}
                  </span>
                </span>
                <ArrowRight size={16} className="text-ink-3 group-hover:text-ink" />
              </div>
              {data.gym?.week.target != null && (
                <div className="mt-3 flex items-center justify-between text-[13px] text-ink-2 tnum">
                  <span>
                    {Math.min(data.gym.week.done, data.gym.week.target)} / {data.gym.week.target} workouts this week
                  </span>
                  <Pips done={Math.min(data.gym.week.done, data.gym.week.target)} total={data.gym.week.target} />
                </div>
              )}
            </Link>
          )}
          {showLearning && (
            <Link href="/learning" className="pressable group rounded-[16px] border border-line-strong bg-surface p-4 hover:border-ink-3">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-[12px] bg-accent-soft text-accent-text">
                  <BookOpenText size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-semibold text-ink">Learning</span>
                  <span className="block text-[13px] text-ink-3">{data.learning.length ? `${data.learning.length} subject${data.learning.length === 1 ? '' : 's'}` : 'Add what you’re learning'}</span>
                </span>
                <ArrowRight size={16} className="text-ink-3 group-hover:text-ink" />
              </div>
              {data.learning.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {data.learning.slice(0, 3).map((s) => {
                    const lite = { measure: s.measure, unit: s.measure === 'custom' ? s.unit : null };
                    return (
                      <li key={s.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                        <span className="truncate text-ink-2">{s.name}</span>
                        <span className="shrink-0 text-ink-3 tnum">
                          {fmtAmount(s.week.done, lite)} / {fmtAmount(s.week.target, lite)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Link>
          )}
        </section>
      )}

      <section aria-labelledby="yours-h" data-tour="areas">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 id="yours-h" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Your areas</h2>
          <div className="flex items-center gap-1">
            {data.areas.length > 1 && (
              <Button size="sm" variant="ghost" onClick={() => {
                if (ordering) {
                  start(async () => {
                    await reorderAreasAction(order);
                    setOrdering(false);
                    toast.show({ title: 'Order saved' });
                  });
                } else setOrdering(true);
              }} loading={pending && ordering}>
                {ordering ? 'Done' : 'Reorder'}
              </Button>
            )}
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} weight="bold" /> Area
            </Button>
          </div>
        </div>
        {data.areas.length ? (
          <ul className="divide-y divide-line rounded-[16px] border border-line">
            {order.map((id, i) => {
              const a = byId.get(id);
              if (!a) return null;
              return (
                <li key={a.id} className="flex items-center">
                  <Link href={`/areas/${a.id}`} className={cn('flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-sunken/40', ordering && 'pointer-events-none')}>
                    <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-sunken text-ink-2">
                      <AreaIcon kind={a.kind} icon={a.icon} size={19} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px] font-semibold text-ink">{a.name}</span>
                      <span className="block truncate text-[13px] text-ink-3">
                        {[
                          a.routines ? `${a.routines} routine${a.routines === 1 ? '' : 's'}` : null,
                          a.tasksOpen ? `${a.tasksOpen} open task${a.tasksOpen === 1 ? '' : 's'}` : null,
                        ].filter(Boolean).join(' · ') || 'Empty — add a routine or task'}
                      </span>
                    </span>
                    {!ordering && (
                      <span className="shrink-0 text-right">
                        <span className="block text-[15px] font-semibold text-ink tnum">{a.week.due ? `${a.week.kept}/${a.week.due}` : a.week.kept ? `${a.week.kept}` : '—'}</span>
                        <span className="block text-[11px] text-ink-3">{a.execution30 != null ? `${fmtPct(a.execution30)} · 30d` : 'this week'}</span>
                      </span>
                    )}
                  </Link>
                  {ordering && (
                    <span className="flex shrink-0 pr-2">
                      <button type="button" disabled={i === 0} onClick={() => setOrder((o) => { const l = [...o]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; return l; })} className="pressable grid size-11 place-items-center rounded-full text-ink-2 hover:bg-sunken disabled:opacity-30" aria-label={`Move ${a.name} up`}>
                        <ArrowUp size={16} />
                      </button>
                      <button type="button" disabled={i === order.length - 1} onClick={() => setOrder((o) => { const l = [...o]; [l[i + 1], l[i]] = [l[i], l[i + 1]]; return l; })} className="pressable grid size-11 place-items-center rounded-full text-ink-2 hover:bg-sunken disabled:opacity-30" aria-label={`Move ${a.name} down`}>
                        <ArrowDown size={16} />
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="pressable flex w-full flex-col items-start gap-1 rounded-[16px] border border-dashed border-line-strong px-5 py-6 text-left hover:border-ink-3">
            <span className="text-[16px] font-semibold text-ink">Create your first area</span>
            <span className="text-[13px] text-ink-3">Business, Faith, Coding, University — a place for the routines and tasks you choose.</span>
          </button>
        )}
      </section>

      {unused.length > 0 && (
        <section aria-label="More tools" className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-ink-3">Not using:</span>
          {unused.map((m) => (
            <Button key={m} size="sm" variant="outline" onClick={() => enable(m)} disabled={pending}>
              {m === 'gym' ? <Barbell size={14} /> : <BookOpenText size={14} />} {m === 'gym' ? 'Gym' : 'Learning'}
            </Button>
          ))}
        </section>
      )}

      {data.archived.length > 0 && (
        <section aria-labelledby="arch-h">
          <button id="arch-h" type="button" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)} className="label-mono flex min-h-11 items-center gap-2 hover:text-ink-2">
            Archived · {data.archived.length}
            <CaretDown size={12} className={cn('transition-transform duration-200', showArchived && 'rotate-180')} />
          </button>
          {showArchived && (
            <ul className="divide-y divide-line">
              {data.archived.map((a) => (
                <li key={a.id} className="flex min-h-14 items-center gap-3">
                  <AreaIcon kind={a.kind} icon={a.icon} size={18} className="text-ink-3" />
                  <Link href={`/areas/${a.id}`} className="min-w-0 flex-1 truncate text-[15px] text-ink-2 hover:text-ink">
                    {a.name}
                  </Link>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      start(async () => {
                        const r = await restoreAreaAction(a.id);
                        toast.show(r.ok ? { title: `${a.name} restored`, detail: 'Its routines are scheduled again from today.' } : { title: r.error, tone: 'error' });
                      })
                    }
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-[12px] text-ink-3">Archived areas keep all their history. Their routines just stop being due.</p>
        </section>
      )}

      <AreaForm open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
