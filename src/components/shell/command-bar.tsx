'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Barbell, BookOpenText, CalendarPlus, CheckCircle, Coins, MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { GYM_WORDS, matchMission, parseCommand, resolveDue, type ParsedCommand } from '@/lib/nl';
import { formatDay, weekdayName } from '@/lib/engine/dates';
import { commandContextAction, createTransactionAction, logLearningAction, quickWorkoutAction, saveMissionAction, trackAction, type CommandContext } from '@/lib/actions';
import { putCompletion } from '@/lib/client/api';
import { useToast } from '@/components/ui/toast';
import { useQuickAdd } from './quick-add';

/**
 * ⌘K. Opens instantly (no animation — it's a keyboard tool used many times a day), parses as
 * you type, and shows exactly what Enter will do before you press it.
 */

const Ctx = createContext<{ open: () => void } | null>(null);
export function useCommandBar() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCommandBar outside provider');
  return c;
}

const DESTINATIONS: { href: string; label: string; module?: string }[] = [
  { href: '/today', label: 'Today' },
  { href: '/areas', label: 'Areas' },
  { href: '/gym', label: 'Gym', module: 'gym' },
  { href: '/learning', label: 'Learning', module: 'learning' },
  { href: '/groups', label: 'Groups' },
  { href: '/money', label: 'Money', module: 'money' },
  { href: '/progress', label: 'Progress' },
  { href: '/journal', label: 'Journal' },
  { href: '/progress/evidence', label: 'Evidence' },
  { href: '/profile', label: 'Profile · settings' },
];

interface Action {
  id: string;
  icon: React.ReactNode;
  title: string;
  detail?: string;
  run: () => Promise<void> | void;
}

export function CommandBarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [ctx, setCtx] = useState<CommandContext | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const toast = useToast();
  const quick = useQuickAdd();

  const show = useCallback(() => {
    setQ('');
    setActive(0);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setQ('');
        setActive(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      input.current?.focus();
      void commandContextAction().then(setCtx);
    }
    if (!open && d.open) d.close();
  }, [open]);

  const parsed: ParsedCommand | null = useMemo(() => parseCommand(q), [q]);

  const actions: Action[] = useMemo(() => {
    const out: Action[] = [];
    if (parsed?.kind === 'money' && ctx) {
      const opts = ctx.money;
      const account = opts.accounts.find((a) => (parsed.currency ? a.currency === parsed.currency : a.id === opts.lastAccountId)) ?? opts.accounts[0];
      const cat = parsed.categorySlug ? opts.categories.find((c) => c.slug === parsed.categorySlug && c.kind === parsed.direction) : null;
      if (!account) {
        out.push({
          id: 'money-setup',
          icon: <Coins size={18} />,
          title: `Add an account to log ${parsed.direction === 'expense' ? '−' : '+'}${parsed.amount}`,
          detail: 'Money needs one account first — cash, a bank, anything',
          run: () => router.push('/money'),
        });
      }
      if (account) {
        const sign = parsed.direction === 'expense' ? '−' : '+';
        out.push({
          id: 'money',
          icon: <Coins size={18} />,
          title: `${parsed.direction === 'expense' ? 'Log expense' : 'Log income'} ${sign}${parsed.amount} ${account.currency}`,
          detail: [cat?.name ?? 'No category', parsed.text || null, account.name].filter(Boolean).join(' · '),
          run: async () => {
            if (!cat) {
              quick.open('money', { kind: parsed.direction, amount: parsed.amount, counterparty: parsed.text });
              return;
            }
            const res = await createTransactionAction({
              kind: parsed.direction,
              amount: parsed.amount,
              accountId: account.id,
              categoryId: cat.id,
              counterparty: parsed.text ? parsed.text.slice(0, 80) : null,
              on: ctx.today,
              source: 'command',
            });
            if (res.ok) toast.show({ title: `Logged ${sign}${parsed.amount} ${account.currency}`, detail: `${cat.name} · ${account.name}` });
            else toast.show({ title: res.error, tone: 'error' });
            router.refresh();
          },
        });
      }
    }
    const gymMission = ctx?.missions.find((m) => m.module === 'gym') ?? null;
    if (parsed?.kind === 'complete' && ctx && GYM_WORDS.test(parsed.query) && gymMission && parsed.value == null && !parsed.minimum) {
      out.push({
        id: 'gym',
        icon: <Barbell size={18} />,
        title: 'Log today’s workout',
        detail: 'Counts for your week, the calendar and your groups · add sets later in Gym',
        run: async () => {
          const res = await quickWorkoutAction();
          if (res.ok) {
            const w = res.summary.week;
            toast.show({ title: `${res.summary.name} logged`, detail: `${w.target != null ? `${w.done} of ${w.target} this week` : `${w.done} this week`}${res.summary.points ? ` · +${res.summary.points} points` : ''}`, tone: 'accent' });
          } else toast.show({ title: res.error, tone: 'error', actions: [{ label: 'Open Gym', onClick: () => router.push('/gym') }] });
          router.refresh();
        },
      });
    }
    if (parsed?.kind === 'complete' && ctx && parsed.value != null && ctx.subjects.length) {
      const subject = matchMission(parsed.query, ctx.subjects.map((x) => ({ ...x, title: x.name })));
      if (subject) {
        const timed = subject.measure === 'minutes' || subject.measure === 'sessions';
        const unit = timed ? 'min' : subject.measure === 'custom' ? subject.unit ?? '' : subject.measure;
        const value = parsed.value;
        out.push({
          id: 'learn',
          icon: <BookOpenText size={18} />,
          title: `Log ${subject.name} · ${value} ${unit}`.trim(),
          detail: 'Learning · today',
          run: async () => {
            const res = await logLearningAction({ subjectId: subject.id, day: ctx.today, minutes: timed ? Math.round(value) : null, quantity: timed ? null : value });
            if (res.ok) toast.show({ title: `${res.subjectName} logged`, detail: `${res.week.done} of ${res.week.target} this week` });
            else toast.show({ title: res.error, tone: 'error' });
            router.refresh();
          },
        });
      }
    }
    if (parsed?.kind === 'complete' && ctx && !out.some((a) => a.id === 'gym' || a.id === 'learn')) {
      const m = matchMission(parsed.query, ctx.missions.filter((x) => !x.module));
      if (m) {
        const value = parsed.value;
        out.push({
          id: 'complete',
          icon: <CheckCircle size={18} />,
          title: parsed.minimum ? `Keep ${m.title} · minimum` : value != null ? `Log ${m.title} · ${value}${m.unit ? ` ${m.unit}` : ''}` : `Keep ${m.title}`,
          detail: 'Today',
          run: async () => {
            const res = await putCompletion({
              missionId: m.id,
              day: ctx.today,
              outcome: parsed.minimum ? 'minimum' : 'full',
              value: m.measure !== 'check' ? value : undefined,
            });
            if (res.ok && !('queued' in res)) toast.show({ title: `${m.title} · ${res.outcome}`, detail: res.xpGained ? `+${res.xpGained} points` : undefined });
            else if (!res.ok) toast.show({ title: 'error' in res ? res.error : 'Couldn’t save', tone: 'error' });
            router.refresh();
          },
        });
      }
    }
    if (parsed?.kind === 'task' && ctx) {
      const dueOn = resolveDue(parsed.due, ctx.today);
      const custom = ctx.areas.filter((a) => a.kind !== 'gym' && a.kind !== 'body' && a.kind !== 'learning');
      const when = dueOn ? (dueOn === ctx.today ? 'today' : `${weekdayName(dueOn)} ${formatDay(dueOn)}`) : 'no date';
      const title = parsed.title;
      out.push({
        id: 'task',
        icon: <CalendarPlus size={18} />,
        title: `New task: ${title}`,
        detail: custom.length === 1 ? `${custom[0].name} · ${when}` : `Due ${when} · pick an area`,
        run: async () => {
          if (custom.length !== 1) {
            quick.open('task', { title, dueOn });
            return;
          }
          const res = await saveMissionAction(null, { title, areaId: custom[0].id, cadence: 'once', dueOn });
          if (res.ok) toast.show({ title: 'Task added', detail: `${custom[0].name} · ${when}` });
          else toast.show({ title: res.error, tone: 'error' });
          router.refresh();
        },
      });
    }
    if (parsed?.kind === 'mission') {
      const title = parsed.title;
      out.push({ id: 'mission', icon: <Plus size={18} />, title: `New routine: ${title}`, detail: 'Pick the area and how often', run: () => quick.open('routine', { title }) });
    }
    if (parsed?.kind === 'navigate') {
      out.push({ id: 'nav', icon: <ArrowRight size={18} />, title: `Go to ${parsed.label}`, run: () => router.push(parsed.href) });
    }
    const term = q.trim().toLowerCase();
    for (const d of DESTINATIONS) {
      if (d.module && ctx && !ctx.modules.includes(d.module)) continue;
      if (!term || d.label.toLowerCase().includes(term)) {
        if (!out.some((a) => a.title === `Go to ${d.label}`)) out.push({ id: d.href, icon: <ArrowRight size={18} />, title: `Go to ${d.label}`, run: () => router.push(d.href) });
      }
    }
    if (ctx && term && !parsed) {
      for (const m of ctx.missions.filter((m) => !m.module && m.title.toLowerCase().includes(term)).slice(0, 4)) {
        out.push({
          id: `m-${m.id}`,
          icon: <CheckCircle size={18} />,
          title: `Keep ${m.title}`,
          detail: 'Today',
          run: async () => {
            await putCompletion({ missionId: m.id, day: ctx.today, outcome: 'full' });
            toast.show({ title: `${m.title} kept` });
            router.refresh();
          },
        });
      }
    }
    return out.slice(0, 8);
  }, [parsed, ctx, q, quick, router, toast]);

  useEffect(() => setActive(0), [q]);

  async function run(a: Action) {
    close();
    void trackAction('command_used', { kind: a.id });
    await a.run();
  }

  const api = useMemo(() => ({ open: show }), [show]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === dialog.current && close()}
        aria-label="Command bar"
        className="command fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-4 pt-[12vh]"
      >
        <div className="mx-auto w-full max-w-[560px] overflow-hidden rounded-[16px] border border-line-strong bg-raised shadow-pop">
          <div className="flex items-center gap-3 border-b border-line px-4">
            <MagnifyingGlass size={18} className="text-ink-3" />
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((i) => Math.min(actions.length - 1, i + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((i) => Math.max(0, i - 1));
                } else if (e.key === 'Enter' && actions[active]) {
                  e.preventDefault();
                  void run(actions[active]);
                }
              }}
              placeholder="€18 lunch · gym done · log German 45"
              className="h-14 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-ink-3"
              aria-label="Command"
              aria-controls="command-results"
              aria-activedescendant={actions[active] ? `cmd-${actions[active].id}` : undefined}
              autoComplete="off"
              spellCheck={false}
            />
            <kbd className="font-mono text-[11px] text-ink-3">esc</kbd>
          </div>
          <ul id="command-results" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
            {actions.map((a, i) => (
              <li key={a.id} id={`cmd-${a.id}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseMove={() => setActive(i)}
                  onClick={() => void run(a)}
                  className={cn('flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left', i === active ? 'bg-sunken' : '')}
                >
                  <span className={cn(i === active ? 'text-accent-text' : 'text-ink-3')}>{a.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] text-ink">{a.title}</span>
                    {a.detail && <span className="block truncate text-[13px] text-ink-3">{a.detail}</span>}
                  </span>
                  {i === active && <kbd className="font-mono text-[11px] text-ink-3">↵</kbd>}
                </button>
              </li>
            ))}
            {!actions.length && (
              <li className="px-3 py-6 text-center text-sm text-ink-3">
                {!ctx && parsed ? 'Loading…' : 'Try “€18 lunch”, “+800 salary”, “gym done” or “add task call Martin tomorrow”.'}
              </li>
            )}
          </ul>
        </div>
        <style>{`.command::backdrop { background: var(--scrim); }`}</style>
      </dialog>
    </Ctx.Provider>
  );
}
