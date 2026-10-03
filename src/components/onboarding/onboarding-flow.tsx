'use client';

import { useState, useTransition } from 'react';
import { ArrowLeft, Barbell, BookOpenText, Check, Plus, Wallet, X } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { AREA_EXAMPLES, AREA_ICONS, MODULES, type ModuleKey } from '@/lib/modules';
import { CURRENCIES } from '@/lib/engine/money';
import { completeOnboardingAction } from '@/lib/actions';
import { Button, Field, Input, Select } from '@/components/ui/primitives';
import { ICONS } from '@/components/icons';
import { LogoMark } from '@/components/viz/marks';

const MODULE_ICON = { gym: Barbell, learning: BookOpenText, money: Wallet } as const;
const QUICK_ICONS = ['hexagon', 'briefcase', 'code', 'rocket', 'pen', 'church', 'graduation', 'run', 'music', 'camera'] as const;

interface DraftArea {
  key: number;
  name: string;
  icon: (typeof AREA_ICONS)[number];
  routine: { title: string; cadence: 'daily' | 'weekly' | null; perWeek: number | null } | null;
}

/**
 * Two screens. Who you are, then which tools you want. Nothing is pre-selected and nothing is
 * scheduled: Gym, Learning and Money each set themselves up the first time you open them.
 */
export function OnboardingFlow({ defaultName, defaultCurrency, next }: { defaultName: string; defaultCurrency: string; next?: string | null }) {
  const [step, setStep] = useState<0 | 1>(0);
  const [name, setName] = useState(defaultName);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [modules, setModules] = useState<ModuleKey[]>([]);
  const [areas, setAreas] = useState<DraftArea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = (k: ModuleKey) => setModules((m) => (m.includes(k) ? m.filter((x) => x !== k) : [...m, k]));
  const addArea = () =>
    setAreas((a) => [...a, { key: Date.now(), name: '', icon: 'hexagon', routine: null }]);
  const patch = (key: number, p: Partial<DraftArea>) => setAreas((a) => a.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const named = areas.filter((a) => a.name.trim());
  // a first routine needs a frequency the user chose — nothing is assumed
  const unscheduled = named.find((a) => a.routine?.title.trim() && (!a.routine.cadence || (a.routine.cadence === 'weekly' && !a.routine.perWeek)));
  const canFinish = (modules.length > 0 || named.length > 0) && !unscheduled;

  function finish() {
    setError(null);
    start(async () => {
      const res = await completeOnboardingAction(
        {
          displayName: name.trim(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          baseCurrency: currency,
          modules,
          areas: named.map((a) => ({
            name: a.name.trim().slice(0, 40),
            icon: a.icon,
            firstRoutine: a.routine?.title.trim()
              ? { title: a.routine.title.trim(), cadence: a.routine.cadence ?? 'daily', perWeek: a.routine.cadence === 'weekly' ? a.routine.perWeek : null }
              : null,
          })),
        },
        next ?? null,
      );
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col px-5 pt-[max(24px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))]">
      <div className="flex h-10 items-center gap-3">
        {step === 1 ? (
          <button type="button" onClick={() => setStep(0)} className="pressable -ml-2 grid size-10 place-items-center rounded-full text-ink-2 hover:bg-sunken" aria-label="Back">
            <ArrowLeft size={18} />
          </button>
        ) : (
          <LogoMark size={22} />
        )}
        <div className="ml-auto flex gap-1.5" aria-label={`Step ${step + 1} of 2`}>
          {[0, 1].map((i) => (
            <span key={i} className={cn('h-1 w-8 rounded-full transition-colors', i <= step ? 'bg-accent' : 'bg-line-strong')} />
          ))}
        </div>
      </div>

      {step === 0 ? (
        <form
          className="flex flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(1);
          }}
        >
          <div className="mt-10">
            <p className="label-mono">Welcome to LevelUp</p>
            <h1 className="mt-2 text-[34px] font-semibold leading-[1.1] tracking-[-0.035em] text-ink">Keep track of what you actually do.</h1>
            <p className="mt-3 text-[15px] leading-6 text-ink-2">
              You decide what matters and how often. LevelUp records it, shows you whether you did it, and pays you LevelCoins for it.
            </p>
          </div>
          <div className="mt-8 flex flex-col gap-4">
            <Field label="Your name" htmlFor="ob-name" hint="Shown on Today and to friends in groups you join.">
              <Input id="ob-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Alex" autoComplete="given-name" />
            </Field>
            <Field label="Main currency" htmlFor="ob-cur" hint="Totals convert into this. Every account keeps its own currency.">
              <Select id="ob-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Button type="submit" size="lg" block className="mt-auto">
            Continue
          </Button>
        </form>
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="mt-8">
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] text-ink">What do you want to use?</h1>
            <p className="mt-2 text-[15px] text-ink-2">Pick any. Nothing gets scheduled — you set each one up when you first open it.</p>
          </div>

          <ul className="mt-6 flex flex-col gap-2.5">
            {MODULES.map((m) => {
              const on = modules.includes(m.key);
              const Icon = MODULE_ICON[m.key];
              return (
                <li key={m.key}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(m.key)}
                    className={cn(
                      'pressable flex w-full items-center gap-4 rounded-[16px] border px-4 py-4 text-left transition-colors',
                      on ? 'border-accent-text bg-accent-soft' : 'border-line-strong bg-surface hover:border-ink-3',
                    )}
                  >
                    <span className={cn('grid size-11 shrink-0 place-items-center rounded-[12px]', on ? 'bg-accent text-accent-ink' : 'bg-sunken text-ink-2')}>
                      <Icon size={22} weight={on ? 'fill' : 'regular'} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[17px] font-semibold text-ink">{m.name}</span>
                      <span className="block text-[13px] text-ink-3">{m.blurb}</span>
                    </span>
                    <span className={cn('grid size-6 shrink-0 place-items-center rounded-full border', on ? 'border-transparent bg-accent text-accent-ink' : 'border-line-strong')}>
                      {on && <Check size={14} weight="bold" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-6">
            <p className="text-[13px] font-medium text-ink-2">Your own areas</p>
            <ul className="mt-2 flex flex-col gap-2.5">
              {areas.map((a, i) => (
                <li key={a.key} className="rounded-[16px] border border-line-strong bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label={`Area ${i + 1} name`}
                      autoFocus
                      value={a.name}
                      onChange={(e) => patch(a.key, { name: e.target.value })}
                      maxLength={40}
                      placeholder={`e.g. ${AREA_EXAMPLES[i % AREA_EXAMPLES.length]}`}
                    />
                    <button type="button" onClick={() => setAreas((x) => x.filter((y) => y.key !== a.key))} className="pressable grid size-11 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink" aria-label="Remove area">
                      <X size={16} />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Icon">
                    {QUICK_ICONS.map((k) => {
                      const I = ICONS[k];
                      return (
                        <button
                          key={k}
                          type="button"
                          aria-pressed={a.icon === k}
                          aria-label={k}
                          onClick={() => patch(a.key, { icon: k })}
                          className={cn('pressable grid size-10 place-items-center rounded-[10px]', a.icon === k ? 'bg-ink text-bg' : 'text-ink-3 hover:bg-sunken hover:text-ink')}
                        >
                          <I size={18} />
                        </button>
                      );
                    })}
                  </div>
                  {a.routine ? (
                    <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
                      <Input
                        aria-label="First routine"
                        value={a.routine.title}
                        onChange={(e) => patch(a.key, { routine: { ...a.routine!, title: e.target.value } })}
                        maxLength={120}
                        placeholder="First routine, e.g. Outreach"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        {(['daily', 'weekly'] as const).map((c) => (
                          <button
                            key={c}
                            type="button"
                            aria-pressed={a.routine!.cadence === c}
                            onClick={() => patch(a.key, { routine: { ...a.routine!, cadence: c } })}
                            className={cn('pressable h-9 rounded-full border px-3.5 text-sm font-medium', a.routine!.cadence === c ? 'border-transparent bg-ink text-bg' : 'border-line-strong text-ink-2')}
                          >
                            {c === 'daily' ? 'Every day' : 'Times a week'}
                          </button>
                        ))}
                        {a.routine.cadence === 'weekly' && (
                          <span className="flex items-center gap-1">
                            {[1, 2, 3, 4, 5, 6].map((n) => (
                              <button
                                key={n}
                                type="button"
                                aria-pressed={a.routine!.perWeek === n}
                                aria-label={`${n} times a week`}
                                onClick={() => patch(a.key, { routine: { ...a.routine!, perWeek: n } })}
                                className={cn('pressable grid size-9 place-items-center rounded-full text-sm font-medium', a.routine!.perWeek === n ? 'bg-ink text-bg' : 'text-ink-2 hover:bg-sunken')}
                              >
                                {n}
                              </button>
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => patch(a.key, { routine: { title: '', cadence: null, perWeek: null } })} className="mt-2 inline-flex min-h-10 items-center gap-1.5 text-[13px] font-medium text-ink-3 hover:text-ink">
                      <Plus size={13} /> Add a first routine (optional)
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {areas.length < 6 && (
              <button
                type="button"
                onClick={addArea}
                className="pressable mt-2.5 flex w-full items-center gap-3 rounded-[16px] border border-dashed border-line-strong px-4 py-3.5 text-left text-[15px] font-medium text-ink-2 hover:border-ink-3 hover:text-ink"
              >
                <Plus size={18} /> Add your own area
                <span className="ml-auto text-[13px] font-normal text-ink-3">Business, Faith, Coding…</span>
              </button>
            )}
          </div>

          {error && (
            <p className="mt-4 text-sm text-bad" role="alert">
              {error}
            </p>
          )}
          <div className="mt-auto pt-8">
            <Button size="lg" block onClick={finish} loading={pending} disabled={!canFinish}>
              Enter LevelUp
            </Button>
            {!canFinish && (
              <p className="mt-2 text-center text-[13px] text-ink-3">
                {unscheduled ? `Choose how often “${unscheduled.routine!.title.trim()}” happens.` : 'Pick at least one — you can add more anytime.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
