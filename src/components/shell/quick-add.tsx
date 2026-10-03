'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowsLeftRight, Barbell, BookOpenText, CheckSquare, Coins, Minus, Plus, Repeat } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { getAreasAction, gymStartAction, moneyFormAction, subjectsAction } from '@/lib/actions';
import type { MoneyFormOptions } from '@/lib/server/money';
import type { Subject } from '@/lib/server/learning';
import { isGymKind } from '@/lib/modules';
import { activeDraft, draftFromTemplate, emptyDraft, saveDraft } from '@/lib/client/workout';
import { Sheet } from '@/components/ui/sheet';
import { MoneyForm, type MoneyPrefill } from '@/components/money/money-form';
import { MissionForm, blankDraft } from '@/components/plan/mission-form';
import { SessionSheet } from '@/components/learning/session-sheet';

export type QuickMode = 'choose' | 'task' | 'routine' | 'workout' | 'learning' | 'expense' | 'income' | 'transfer' | 'money' | 'mission';

interface QuickAddApi {
  open: (mode?: QuickMode, prefill?: MoneyPrefill & { areaId?: string; title?: string; dueOn?: string | null }) => void;
}

const Ctx = createContext<QuickAddApi | null>(null);

export function useQuickAdd() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useQuickAdd outside provider');
  return c;
}

type Areas = { id: string; kind: string; name: string; icon: string | null }[];

/**
 * The + button, aware of where you are: in Money it logs money, in Gym it starts a workout, in
 * Learning it logs a session, in an area it adds a task there; anywhere else it asks.
 */
export function QuickAddProvider({ children, today, modules = [], unit = 'kg' }: { children: React.ReactNode; today: string; modules?: string[]; unit?: 'kg' | 'lb' }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<QuickMode>('choose');
  const [prefill, setPrefill] = useState<(MoneyPrefill & { areaId?: string; title?: string; dueOn?: string | null }) | undefined>();
  const [money, setMoney] = useState<MoneyFormOptions | null>(null);
  const [areas, setAreas] = useState<Areas | null>(null);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [gym, setGym] = useState<Awaited<ReturnType<typeof gymStartAction>> | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  const router = useRouter();
  const pathname = usePathname();

  const contextMode = useCallback((): QuickMode => {
    if (pathname.startsWith('/money')) return 'expense';
    if (pathname.startsWith('/gym')) return 'workout';
    if (pathname.startsWith('/learning')) return 'learning';
    if (/^\/areas\/[0-9a-f-]{36}/.test(pathname)) return 'task';
    return 'choose';
  }, [pathname]);

  const show = useCallback(
    (m?: QuickMode, p?: MoneyPrefill & { areaId?: string; title?: string; dueOn?: string | null }) => {
      let next = m ?? contextMode();
      if (next === 'mission') next = 'routine';
      if (next === 'money') next = p?.kind ?? 'expense';
      const areaFromPath = /^\/areas\/([0-9a-f-]{36})/.exec(pathname)?.[1];
      setMode(next);
      setPrefill({ ...(areaFromPath ? { areaId: areaFromPath } : {}), ...p });
      setNonce((n) => n + 1);
      setOpen(true);
    },
    [contextMode, pathname],
  );

  useEffect(() => {
    if (!open) return;
    if (['expense', 'income', 'transfer'].includes(mode)) void moneyFormAction().then(setMoney);
    if (mode === 'task' || mode === 'routine') void getAreasAction().then(setAreas);
    if (mode === 'learning') void subjectsAction().then(setSubjects);
    if (mode === 'workout') void gymStartAction().then(setGym);
  }, [open, mode, nonce]);

  // "N" opens quick add (when not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable=true], dialog')) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        show();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show]);

  const api = useMemo(() => ({ open: show }), [show]);
  const close = () => setOpen(false);
  const done = () => {
    close();
    router.refresh();
  };

  const startWorkout = (dayId: string | null) => {
    const existing = activeDraft();
    close();
    if (existing) return router.push(`/gym/workout?id=${existing.id}`);
    if (gym?.activeId) return router.push(`/gym/workout?id=${gym.activeId}`);
    const day = dayId && gym ? gym.start.find((d) => d.id === dayId) : null;
    const draft = day && gym ? draftFromTemplate(day, gym.last, today, unit) : emptyDraft('Workout', today, unit);
    saveDraft(draft);
    router.push(`/gym/workout?id=${draft.id}`);
  };

  const tiles: { mode: QuickMode; label: string; Icon: typeof Plus; show: boolean }[] = [
    { mode: 'task', label: 'Task', Icon: CheckSquare, show: true },
    { mode: 'routine', label: 'Routine', Icon: Repeat, show: true },
    { mode: 'workout', label: 'Workout', Icon: Barbell, show: modules.includes('gym') },
    { mode: 'learning', label: 'Learning session', Icon: BookOpenText, show: modules.includes('learning') },
    { mode: 'expense', label: 'Expense', Icon: Minus, show: modules.includes('money') },
    { mode: 'income', label: 'Income', Icon: Coins, show: modules.includes('money') },
    { mode: 'transfer', label: 'Transfer', Icon: ArrowsLeftRight, show: modules.includes('money') },
  ];
  const customAreas = (areas ?? []).filter((a) => !isGymKind(a.kind) && a.kind !== 'learning');
  const title = mode === 'choose' ? 'Add' : tiles.find((t) => t.mode === mode)?.label ?? 'Add';
  const loading = <div className="h-56 animate-pulse rounded-[14px] bg-sunken" aria-label="Loading" />;

  return (
    <Ctx.Provider value={api}>
      {children}
      <Sheet open={open && mode !== 'learning'} onClose={close} title={title} hideTitle={mode !== 'choose' && mode !== 'workout'}>
        <div className="flex flex-col gap-4">
          {mode !== 'choose' && (
            <button type="button" onClick={() => setMode('choose')} className="-mt-1 self-start text-[13px] font-medium text-ink-3 hover:text-ink">
              ← Everything you can add
            </button>
          )}
          {mode === 'choose' && (
            <ul className="grid grid-cols-2 gap-2">
              {tiles.filter((t) => t.show).map(({ mode: m, label, Icon }) => (
                <li key={m}>
                  <button
                    type="button"
                    onClick={() => setMode(m)}
                    className="pressable flex h-[76px] w-full flex-col items-start justify-between rounded-[14px] border border-line-strong px-3.5 py-3 text-left hover:border-ink-3"
                  >
                    <Icon size={20} className="text-ink-2" />
                    <span className="text-[15px] font-medium text-ink">{label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {(mode === 'expense' || mode === 'income' || mode === 'transfer') &&
            (money ? <MoneyForm key={`${nonce}-${mode}`} options={money} today={today} prefill={{ ...prefill, kind: mode }} onDone={done} /> : loading)}
          {(mode === 'task' || mode === 'routine') &&
            (areas ? (
              customAreas.length ? (
                <MissionForm
                  key={`${nonce}-${mode}`}
                  initial={{ ...blankDraft(customAreas.find((a) => a.id === prefill?.areaId)?.id ?? customAreas[0].id, mode), title: prefill?.title ?? '', ...(mode === 'task' && prefill?.dueOn ? { dueOn: prefill.dueOn } : {}) }}
                  areas={customAreas}
                  today={today}
                  onDone={done}
                />
              ) : (
                <div className="rounded-[14px] border border-dashed border-line-strong px-5 py-6 text-center">
                  <p className="font-medium text-ink">Create an area first</p>
                  <p className="mt-1 text-sm text-ink-3">Tasks and routines live in areas you make — Business, Faith, Coding…</p>
                  <button type="button" onClick={() => { close(); router.push('/areas'); }} className="pressable mt-4 inline-flex h-10 items-center rounded-[10px] bg-accent px-4 text-sm font-medium text-accent-ink">
                    Go to Areas
                  </button>
                </div>
              )
            ) : (
              loading
            ))}
          {mode === 'workout' &&
            (gym === undefined ? (
              loading
            ) : gym === null ? (
              <div className="rounded-[14px] border border-dashed border-line-strong px-5 py-6 text-center">
                <p className="font-medium text-ink">Build your program first</p>
                <p className="mt-1 text-sm text-ink-3">Name your workout days and add your exercises — it takes a minute.</p>
                <button type="button" onClick={() => { close(); router.push('/gym'); }} className="pressable mt-4 inline-flex h-10 items-center rounded-[10px] bg-accent px-4 text-sm font-medium text-accent-ink">
                  Set up Gym
                </button>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {gym.activeId && (
                  <li>
                    <button type="button" onClick={() => startWorkout(null)} className="pressable flex min-h-14 w-full items-center rounded-[14px] bg-accent px-4 text-left text-[15px] font-semibold text-accent-ink">
                      Resume the workout in progress
                    </button>
                  </li>
                )}
                {gym.start.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => startWorkout(d.id)}
                      className={cn('pressable flex min-h-14 w-full items-center justify-between gap-3 rounded-[14px] border px-4 text-left', d.id === gym.nextDayId ? 'border-accent-text bg-accent-soft' : 'border-line-strong hover:border-ink-3')}
                    >
                      <span>
                        <span className="block text-[15px] font-semibold text-ink">{d.name}</span>
                        <span className="block text-[12px] text-ink-3">{d.exercises.length} exercises{d.id === gym.nextDayId ? ' · next up' : ''}</span>
                      </span>
                      <span className="text-[13px] font-medium text-ink-2">Start</span>
                    </button>
                  </li>
                ))}
                <li>
                  <button type="button" onClick={() => startWorkout(null)} className="pressable flex min-h-12 w-full items-center rounded-[14px] border border-dashed border-line-strong px-4 text-left text-[15px] text-ink-2 hover:text-ink">
                    Empty workout
                  </button>
                </li>
              </ul>
            ))}
        </div>
      </Sheet>
      {subjects && (
        <SessionSheet
          open={open && mode === 'learning'}
          onClose={close}
          subjects={subjects.map((s) => ({ id: s.id, name: s.name, measure: s.measure, unit: s.unit }))}
          today={today}
        />
      )}
      {open && mode === 'learning' && subjects && !subjects.length && (
        <Sheet open onClose={close} title="Add a subject first" size="sm">
          <p className="text-sm text-ink-3">Tell LevelUp what you’re learning and how you want to measure it.</p>
          <button type="button" onClick={() => { close(); router.push('/learning'); }} className="pressable mt-4 inline-flex h-10 items-center rounded-[10px] bg-accent px-4 text-sm font-medium text-accent-ink">
            Set up Learning
          </button>
        </Sheet>
      )}
    </Ctx.Provider>
  );
}
