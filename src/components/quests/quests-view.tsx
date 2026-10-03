'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { Barbell, BookOpenText, Check, ListChecks, NotePencil, Plus, Sparkle, Star, Trash } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { PAID_CUSTOM_PER_DAY, SIZE_LABEL, SIZE_REWARD, type QuestSize, type QuestView } from '@/lib/engine/quests';
import type { QuestDay } from '@/lib/server/quests';
import type { CollectablesPage } from '@/lib/server/collectables';
import { addQuestAction, deleteQuestAction, questDayAction, setQuestDoneAction } from '@/lib/actions';
import { Button, Input, Segmented } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { CollectablesView } from '@/components/collectables/collectables-view';
import { LevelCoin, formatCoins } from '@/components/collectables/level-coin';

export type QuestTab = 'quests' | 'collectables';

const KIND_ICON = { workout: Barbell, learning: BookOpenText, journal: NotePencil, plan: ListChecks, custom: Star } as const;

/** Quests pay LevelCoins; LevelCoins buy collectables. */
export function QuestsView({ day: initialDay, collect, initialTab = 'quests' }: { day: QuestDay; collect: CollectablesPage; initialTab?: QuestTab }) {
  const [day, setDay] = useState(initialDay);
  const [coins, setCoins] = useState(initialDay.coins);
  const [tab, setTab] = useState<QuestTab>(initialTab);
  const toast = useToast();
  useEffect(() => {
    setDay(initialDay);
    setCoins(initialDay.coins);
  }, [initialDay]);
  useEffect(() => setCoins(collect.coins), [collect.coins]);
  useEffect(() => setTab(initialTab), [initialTab]);

  // credit moment for LevelCoins earned since the last visit
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current || !initialDay.granted.length) return;
    announced.current = true;
    const total = initialDay.granted.reduce((s, g) => s + g.amount, 0);
    toast.show({ title: `+${total} LevelCoins`, detail: initialDay.granted.map((g) => g.title).join(' · '), tone: 'accent', leading: <LevelCoin size={20} /> });
  }, [initialDay.granted, toast]);

  const refresh = async () => {
    const next = await questDayAction();
    if (!next) return;
    setDay(next);
    setCoins(next.coins);
    const total = next.granted.reduce((s, g) => s + g.amount, 0);
    if (total > 0) toast.show({ title: `+${total} LevelCoins`, detail: next.granted.map((g) => g.title).join(' · '), tone: 'accent', leading: <LevelCoin size={20} /> });
  };

  const done = day.quests.filter((q) => q.done).length;
  const owned = collect.cards.filter((c) => c.copies > 0).length;
  return (
    <>
      <section aria-label="LevelCoins" data-tour="coins" className="flex items-end justify-between gap-4">
        <div>
          <p className="label-mono">LevelCoins</p>
          <p className="mt-1 flex items-center gap-2.5 text-[44px] font-semibold leading-none tracking-[-0.04em] text-ink tnum">
            <LevelCoin size={32} />{' '}
            <motion.span key={coins} initial={{ opacity: 0.4, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              {formatCoins(coins)}
            </motion.span>
          </p>
          <p className="mt-1.5 text-[13px] text-ink-3">
            +{day.earnedToday} today · {done} of {day.quests.length} quests done
          </p>
        </div>
        <button type="button" onClick={() => setTab('collectables')} className="pressable rounded-[12px] px-2 py-1 text-right hover:bg-sunken">
          <span className="label-mono block">Collectables</span>
          <span className="mt-1 block text-[22px] font-semibold text-ink tnum">
            {owned}
            <span className="text-[14px] font-normal text-ink-3"> / {collect.cards.length}</span>
          </span>
        </button>
      </section>

      <div data-tour="quest-tabs">
        <Segmented
          label="Sections"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'quests', label: 'Quests' },
            { value: 'collectables', label: collect.incoming.length ? `Collectables · ${collect.incoming.length}` : 'Collectables' },
          ]}
        />
      </div>

      {tab === 'quests' && <QuestList day={day} onChange={refresh} />}
      {tab === 'collectables' && <CollectablesView data={collect} coins={coins} onCoins={setCoins} />}
    </>
  );
}

// ───────────────────────────────────────────── quests

function QuestList({ day, onChange }: { day: QuestDay; onChange: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [size, setSize] = useState<QuestSize>('medium');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const auto = day.quests.filter((q) => q.kind !== 'custom');
  const mine = day.quests.filter((q) => q.kind === 'custom');
  const req = day.quests.filter((q) => q.required);
  const reqDone = req.filter((q) => q.done).length;

  const toggle = (q: QuestView) =>
    start(async () => {
      setOptimistic((o) => ({ ...o, [q.key]: !q.done }));
      const r = await setQuestDoneAction(q.id!, !q.done);
      if (!r.ok) setError(r.error);
      await onChange();
      setOptimistic((o) => {
        const { [q.key]: _, ...rest } = o;
        return rest;
      });
    });

  return (
    <div className="flex flex-col gap-6" data-tour="quest-list">
      <section aria-labelledby="auto-h">
        <h2 id="auto-h" className="label-mono mb-2">From your plan</h2>
        <ul className="flex flex-col gap-2">
          {auto.map((q) => (
            <QuestRow key={q.key} q={q} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="mine-h">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 id="mine-h" className="label-mono">Your quests today</h2>
          <span className="text-[12px] text-ink-3">{day.paidCustomLeft > 0 ? `${day.paidCustomLeft} more pay LevelCoins today` : `Your first ${PAID_CUSTOM_PER_DAY} a day pay LevelCoins`}</span>
        </div>
        {mine.length > 0 && (
          <ul className="mb-3 flex flex-col gap-2">
            {mine.map((q) => {
              const isDone = optimistic[q.key] ?? q.done;
              return (
                <QuestRow
                  key={q.key}
                  q={{ ...q, done: isDone }}
                  onToggle={() => toggle(q)}
                  onDelete={
                    isDone
                      ? undefined
                      : () =>
                          start(async () => {
                            await deleteQuestAction(q.id!);
                            await onChange();
                          })
                  }
                />
              );
            })}
          </ul>
        )}
        <form
          className="flex flex-col gap-2.5 rounded-[16px] border border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            setError(null);
            start(async () => {
              const r = await addQuestAction({ title, size });
              if (!r.ok) return setError(r.error);
              setTitle('');
              await onChange();
            });
          }}
        >
          <label htmlFor="quest-title" className="sr-only">
            New quest
          </label>
          <Input id="quest-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Add a quest for today" />
          <div className="flex items-center gap-2">
            <Segmented
              label="Quest size"
              size="sm"
              value={size}
              onChange={setSize}
              className="flex-1"
              options={(['small', 'medium', 'big'] as const).map((s) => ({ value: s, label: `${SIZE_LABEL[s]} +${SIZE_REWARD[s]}` }))}
            />
            <Button type="submit" size="sm" loading={pending} disabled={!title.trim()} aria-label="Add quest">
              <Plus size={16} weight="bold" />
            </Button>
          </div>
          {error && (
            <p className="text-[13px] text-bad" role="alert">
              {error}
            </p>
          )}
        </form>
      </section>

      <section aria-label="Clean sweep" className="rounded-[16px] bg-sunken px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Sparkle size={18} weight="fill" className="text-accent-text" /> Clean sweep
          </p>
          <span className={cn('inline-flex items-center gap-1 text-[14px] font-semibold tnum', day.sweep.done ? 'text-good' : 'text-ink-2')}>
            {day.sweep.done && <Check size={14} weight="bold" />}+{day.sweep.bonus} <LevelCoin size={14} />
          </span>
        </div>
        <p className="mt-0.5 text-[13px] text-ink-3">Finish every quest that’s due today for a bonus. {reqDone} of {req.length} done.</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${req.length ? (reqDone / req.length) * 100 : 0}%` }} />
        </div>
      </section>
    </div>
  );
}

function QuestRow({ q, onToggle, onDelete }: { q: QuestView; onToggle?: () => void; onDelete?: () => void }) {
  const Icon = KIND_ICON[q.kind];
  const body = (
    <>
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-full', q.done ? 'bg-accent text-accent-ink' : 'bg-sunken text-ink-2')}>
        {q.done ? <Check size={18} weight="bold" /> : <Icon size={18} />}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className={cn('block text-[15px] font-medium', q.done ? 'text-ink-3 line-through decoration-ink-3/60' : 'text-ink')}>{q.title}</span>
        {q.detail && <span className="block text-[13px] text-ink-3">{q.detail}</span>}
      </span>
      {q.reward > 0 && (
        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold tnum', q.done ? 'bg-accent-soft text-accent-text' : 'bg-sunken text-ink-2')}>
          +{q.reward} <LevelCoin size={13} />
        </span>
      )}
    </>
  );
  return (
    <li className="flex items-center gap-2">
      {q.kind === 'custom' ? (
        <button type="button" onClick={onToggle} aria-pressed={q.done} className="pressable flex min-h-14 flex-1 items-center gap-3 rounded-[14px] border border-line px-3 py-2 hover:border-line-strong">
          {body}
        </button>
      ) : (
        <Link href={q.href ?? '/today'} className="pressable flex min-h-14 flex-1 items-center gap-3 rounded-[14px] border border-line px-3 py-2 hover:border-line-strong">
          {body}
        </Link>
      )}
      {onDelete && (
        <button type="button" onClick={onDelete} className="pressable grid size-11 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-bad" aria-label={`Delete ${q.title}`}>
          <Trash size={17} />
        </button>
      )}
    </li>
  );
}
