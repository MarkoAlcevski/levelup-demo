'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Barbell, BookOpenText, CaretRight, Compass, DownloadSimple, Gift, GlobeHemisphereWest, Lock, Medal, Plus, SignOut, Trophy, Wallet } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/engine/dates';
import { formatMoney, CURRENCIES } from '@/lib/engine/money';
import type { YouData, RewardView } from '@/lib/server/you';
import type { MoneyFormOptions } from '@/lib/server/money';
import { createRewardAction, moneyFormAction, redeemRewardAction, saveSettingsAction, setModuleAction, setWorldVisibleAction, signOutAction } from '@/lib/actions';
import { Button, Field, Input, Segmented, Select, Switch } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { LevelRing } from '@/components/viz/marks';
import { useTour } from '@/components/tutorial/tour';

const ACCENT_SWATCH: Record<string, string> = {
  volt: 'oklch(0.915 0.2 120)',
  ember: 'oklch(0.74 0.18 48)',
  cobalt: 'oklch(0.72 0.15 255)',
  ivory: 'oklch(0.94 0.025 85)',
};
const TIER: Record<string, string> = { bronze: 'text-[oklch(0.72_0.08_60)]', silver: 'text-ink-2', gold: 'text-accent-text' };
const n = (v: number) => v.toLocaleString('en-US');

/** Profile: level, points, streak, rewards, achievements, records, settings. Everything that isn’t today’s work. */
export function ProfileView({ data }: { data: YouData }) {
  const lv = data.level;
  const earned = data.achievements.filter((a) => a.unlockedOn).length;
  return (
    <>
      <section aria-label="Level and points" className="flex items-center gap-5">
        <LevelRing level={lv.level} progress={lv.progress} size={88} stroke={5} />
        <div className="min-w-0 flex-1">
          <p className="label-mono">Level {lv.level}</p>
          <p className="mt-0.5 text-[30px] font-semibold leading-tight tracking-[-0.03em] text-ink tnum">{n(lv.xp)}</p>
          <p className="text-[13px] text-ink-3 tnum">
            lifetime points · {n(Math.max(0, lv.span - lv.into))} to level {lv.level + 1}
          </p>
        </div>
      </section>

      <dl className="-mt-2 grid grid-cols-3 gap-4 border-y border-line py-4">
        <div>
          <dt className="label-mono">Available</dt>
          <dd className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink tnum">{n(data.available)}</dd>
          <dd className="text-[12px] text-ink-3">to spend on rewards</dd>
        </div>
        <div>
          <dt className="label-mono">Streak</dt>
          <dd className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink tnum">
            {data.streak.current} <span className="text-[14px] font-normal text-ink-3">day{data.streak.current === 1 ? '' : 's'}</span>
          </dd>
          <dd className="text-[12px] text-ink-3">best {data.streak.best}</dd>
        </div>
        <div>
          <dt className="label-mono">Achievements</dt>
          <dd className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink tnum">{earned}</dd>
          <dd className="text-[12px] text-ink-3">of {data.achievements.filter((a) => !a.hidden || a.unlockedOn).length}</dd>
        </div>
      </dl>
      <p className="-mt-5 text-xs text-ink-3">Points come from what you finish. Spending them on rewards never lowers your level. They measure execution inside LevelUp — not you.</p>

      <Link href="/quests?tab=collectables" className="pressable -mt-2 flex min-h-14 items-center gap-3 rounded-[16px] border border-line px-4 py-3 hover:border-line-strong">
        <Trophy size={20} className="shrink-0 text-accent-text" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-ink">Quests &amp; collectables</span>
          <span className="block text-[13px] text-ink-3">Quests pay LevelCoins. LevelCoins open boxes of collectables you can trade with friends.</span>
        </span>
        <CaretRight size={16} className="shrink-0 text-ink-3" />
      </Link>

      <Rewards data={data} />
      <Achievements data={data} />

      {data.records.length > 0 && (
        <section aria-labelledby="rec-h">
          <h2 id="rec-h" className="mb-2 text-[17px] font-semibold tracking-[-0.015em] text-ink">Records</h2>
          <ul className="divide-y divide-line">
            {data.records.map((r) => {
              const body = (
                <>
                  <span className="min-w-0 flex-1 text-[15px] text-ink-2">{r.label}</span>
                  <span className="text-right">
                    <span className="block text-[15px] font-semibold text-ink tnum">{r.value}</span>
                    {r.on && <span className="block text-[12px] text-ink-3">{formatDay(r.on)}</span>}
                  </span>
                </>
              );
              return (
                <li key={r.key}>
                  {r.href ? (
                    <Link href={r.href} className="flex min-h-13 items-center gap-3 py-2 hover:text-ink">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex min-h-13 items-center gap-3 py-2">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Timeline items={data.timeline} />
      <Settings data={data} />
    </>
  );
}

function Achievements({ data }: { data: YouData }) {
  const [all, setAll] = useState(false);
  const [allEarned, setAllEarned] = useState(false);
  const earned = data.achievements.filter((a) => a.unlockedOn).sort((a, b) => ((a.unlockedOn ?? '') < (b.unlockedOn ?? '') ? 1 : -1));
  const next = data.achievements.filter((a) => !a.unlockedOn && !a.hidden).sort((a, b) => b.progress - a.progress);
  const shown = all ? next : next.slice(0, 4);
  return (
    <section aria-labelledby="ach-h">
      <h2 id="ach-h" className="mb-3 text-[17px] font-semibold tracking-[-0.015em] text-ink">Achievements</h2>
      {earned.length > 0 && (
        <ul className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(allEarned ? earned : earned.slice(0, 6)).map((a) => (
            <li key={a.key} className="flex items-center gap-3 rounded-[14px] border border-line px-4 py-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft">
                <Medal size={20} weight="fill" className={TIER[a.tier]} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[15px] font-medium text-ink">
                  {a.title}
                  {a.isNew && <span className="rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold uppercase text-accent-ink">New</span>}
                </p>
                <p className="text-[13px] text-ink-3">
                  {a.description} · {formatDay(a.unlockedOn!)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {earned.length > 6 && (
        <button type="button" onClick={() => setAllEarned(!allEarned)} className="mb-3 min-h-11 text-[14px] font-medium text-ink-2 hover:text-ink">
          {allEarned ? 'Show fewer' : `Show all ${earned.length} earned`}
        </button>
      )}
      {shown.length > 0 && (
        <>
          <p className="label-mono mb-2">Closest next</p>
          <ul className="divide-y divide-line">
            {shown.map((a) => (
              <li key={a.key} className="flex items-center gap-3 py-2.5">
                <Medal size={18} className="shrink-0 text-ink-3" />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] text-ink">{a.title}</p>
                  <p className="text-[13px] text-ink-3">{a.description}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-sunken">
                      <div className="h-full rounded-full bg-ink-3" style={{ width: `${Math.round(a.progress * 100)}%` }} />
                    </div>
                    <span className="shrink-0 text-[11px] text-ink-3 tnum">{a.label}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {next.length > 4 && (
            <button type="button" onClick={() => setAll(!all)} className="mt-1 min-h-11 text-[14px] font-medium text-ink-2 hover:text-ink">
              {all ? 'Show fewer' : `Show all ${next.length}`}
            </button>
          )}
        </>
      )}
      {data.achievements.some((a) => a.hidden) && (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-3">
          <Lock size={12} /> {data.achievements.filter((a) => a.hidden).length} hidden — you’ll know them when you earn them.
        </p>
      )}
    </section>
  );
}

function Timeline({ items }: { items: YouData['timeline'] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 8);
  return (
    <section aria-labelledby="tl-h">
      <h2 id="tl-h" className="mb-3 text-[17px] font-semibold tracking-[-0.015em] text-ink">Timeline</h2>
      {items.length ? (
        <>
          <ol className="relative ml-2 border-l border-line pl-5">
            {shown.map((t) => (
              <li key={t.id} className="relative pb-5 last:pb-0">
                <span className={cn('absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-bg', t.kind === 'record' || t.kind === 'achievement' || t.kind === 'group' ? 'bg-accent' : t.kind === 'keystone' ? 'bg-ink-2' : 'bg-ink-3')} />
                <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">{formatDay(t.day)}</p>
                <p className="text-[15px] font-medium text-ink">{t.kind === 'keystone' ? `Weekly Focus done: ${t.title}` : t.title}</p>
                {t.detail && <p className="text-[13px] text-ink-3">{t.detail}</p>}
              </li>
            ))}
          </ol>
          {items.length > 8 && (
            <button type="button" onClick={() => setAll(!all)} className="mt-2 min-h-11 text-[14px] font-medium text-ink-2 hover:text-ink">
              {all ? 'Show less' : 'Show more'}
            </button>
          )}
        </>
      ) : (
        <p className="text-sm text-ink-3">Milestones, records, finished Weekly Focuses and group wins collect here.</p>
      )}
    </section>
  );
}

function Rewards({ data }: { data: YouData }) {
  const [creating, setCreating] = useState(false);
  const [redeem, setRedeem] = useState<RewardView | null>(null);
  return (
    <section aria-labelledby="rw-h">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 id="rw-h" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Rewards</h2>
          <p className="text-[13px] text-ink-3">Things you’ll buy yourself with points you earned.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          <Plus size={14} weight="bold" /> Reward
        </Button>
      </div>
      {data.rewards.length ? (
        <ul className="divide-y divide-line rounded-[16px] border border-line">
          {data.rewards.map((r) => {
            const affordable = data.available >= r.cost;
            return (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <Gift size={20} className={affordable ? 'text-accent-text' : 'text-ink-3'} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-ink">{r.title}</p>
                  <p className="text-[13px] text-ink-3 tnum">
                    {n(r.cost)} points
                    {r.moneyMinor && r.moneyCurrency ? ` · costs ${formatMoney(r.moneyMinor, r.moneyCurrency, { compact: true })}` : ''}
                    {r.redeemedCount ? ` · redeemed ${r.redeemedCount}×` : ''}
                  </p>
                  {!affordable && (
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sunken">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (data.available / r.cost) * 100)}%` }} />
                    </div>
                  )}
                </div>
                <Button size="sm" variant={affordable ? 'primary' : 'secondary'} disabled={!affordable} onClick={() => setRedeem(r)}>
                  {affordable ? 'Redeem' : `${n(r.cost - data.available)} to go`}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <button type="button" onClick={() => setCreating(true)} className="pressable w-full rounded-[16px] border border-dashed border-line-strong px-4 py-5 text-left hover:bg-sunken/40">
          <p className="text-[15px] font-medium text-ink">Set a reward you actually want</p>
          <p className="text-[13px] text-ink-3">Pick something, give it a price in points, and earn it.</p>
        </button>
      )}
      <CreateReward open={creating} onClose={() => setCreating(false)} base={data.settings.baseCurrency} />
      <Redeem reward={redeem} onClose={() => setRedeem(null)} />
    </section>
  );
}

function CreateReward({ open, onClose, base }: { open: boolean; onClose: () => void; base: string }) {
  const [title, setTitle] = useState('');
  const [cost, setCost] = useState('');
  const [money, setMoney] = useState('');
  const [currency, setCurrency] = useState(base);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Sheet open={open} onClose={onClose} title="New reward" description="A finished routine earns 10–70 points, a full week usually several hundred.">
      <form
        className="flex flex-col gap-4 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await createRewardAction({ title, cost: Number(cost), money: money || null, currency });
            if (!res.ok) return setError(res.error);
            setTitle('');
            setCost('');
            setMoney('');
            onClose();
          });
        }}
      >
        <Field label="Reward" htmlFor="rw-title">
          <Input id="rw-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Price in points" htmlFor="rw-cost">
          <Input id="rw-cost" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="What it costs in money (optional)" htmlFor="rw-money">
            <Input id="rw-money" inputMode="decimal" value={money} onChange={(e) => setMoney(e.target.value)} />
          </Field>
          <Field label="Currency" htmlFor="rw-cur">
            <Select id="rw-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        <Button type="submit" size="lg" block loading={pending} disabled={!title.trim() || !Number(cost)}>
          Add reward
        </Button>
      </form>
    </Sheet>
  );
}

function Redeem({ reward, onClose }: { reward: RewardView | null; onClose: () => void }) {
  const [accounts, setAccounts] = useState<MoneyFormOptions['accounts'] | null>(null);
  const [accountId, setAccountId] = useState<string>('');
  const [logIt, setLogIt] = useState(true);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const priced = !!reward?.moneyMinor;
  useEffect(() => {
    if (!reward || !reward.moneyMinor) return;
    let alive = true;
    void moneyFormAction().then((o) => {
      if (!alive) return;
      const list = (o?.accounts ?? []).filter((a) => a.currency === reward.moneyCurrency);
      setAccounts(list);
      setAccountId(list[0]?.id ?? '');
    });
    return () => {
      alive = false;
    };
  }, [reward]);
  return (
    <Sheet open={!!reward} onClose={onClose} size="sm" title={reward ? `Redeem “${reward.title}”` : ''} description={reward ? `${n(reward.cost)} points. Your level stays exactly where it is.` : undefined}>
      {reward && (
        <div className="flex flex-col gap-4 pt-1">
          {priced && (
            <div className="flex flex-col gap-3 rounded-[12px] border border-line px-4 py-3">
              <label className="flex items-center gap-3 text-[15px] text-ink">
                <input type="checkbox" checked={logIt} onChange={(e) => setLogIt(e.target.checked)} className="size-5 accent-[var(--accent)]" />
                Log {formatMoney(reward.moneyMinor!, reward.moneyCurrency!)} as earned spending
              </label>
              {logIt && accounts && accounts.length > 0 && (
                <Select aria-label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )}
              {logIt && accounts && !accounts.length && <p className="text-[13px] text-ink-3">No {reward.moneyCurrency} account to log it against.</p>}
            </div>
          )}
          <Button
            size="lg"
            block
            loading={pending}
            onClick={() =>
              start(async () => {
                const res = await redeemRewardAction(reward.id, priced && logIt && accountId ? accountId : null);
                if (!res.ok) {
                  toast.show({ title: res.error, tone: 'error' });
                  return;
                }
                onClose();
                toast.show({ title: `Enjoy it — ${reward.title}`, detail: res.logged ? 'Logged as earned spending.' : `${n(res.balance ?? 0)} points left.`, tone: 'accent' });
                router.refresh();
              })
            }
          >
            Redeem
          </Button>
        </div>
      )}
    </Sheet>
  );
}

const MODULE_ROWS = [
  { key: 'gym', label: 'Gym', body: 'Program, workout logging, calendar, PRs', Icon: Barbell },
  { key: 'learning', label: 'Learning', body: 'Subjects, sessions, weekly targets', Icon: BookOpenText },
  { key: 'money', label: 'Money', body: 'Accounts, transactions, budgets, targets', Icon: Wallet },
] as const;

function Settings({ data }: { data: YouData }) {
  const [s, setS] = useState(data.settings);
  const [pending, start] = useTransition();
  const [modules, setModules] = useState(new Set(data.settings.modules));
  const [world, setWorld] = useState(data.settings.worldVisible);
  const toast = useToast();
  const router = useRouter();
  const tour = useTour();
  const tzs = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [s.timezone];
  const save = (next = s) =>
    start(async () => {
      const res = await saveSettingsAction({ ...next, modules: undefined });
      toast.show(res.ok ? { title: 'Settings saved' } : { title: res.error, tone: 'error' });
    });
  const toggleModule = (key: 'gym' | 'learning' | 'money', on: boolean) => {
    const next = new Set(modules);
    if (on) next.add(key);
    else next.delete(key);
    setModules(next);
    start(async () => {
      const res = await setModuleAction(key, on);
      if (!res.ok) {
        toast.show({ title: res.error, tone: 'error' });
        setModules(new Set(modules));
        return;
      }
      toast.show({ title: on ? `${MODULE_ROWS.find((m) => m.key === key)!.label} is on` : `${MODULE_ROWS.find((m) => m.key === key)!.label} is off`, detail: on ? undefined : 'Nothing was deleted — turn it back on any time.' });
      router.refresh();
    });
  };
  return (
    <section aria-labelledby="set-h" className="flex flex-col gap-6">
      <h2 id="set-h" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Settings</h2>

      <div className="flex flex-col gap-1" data-tour="modules">
        <p className="label-mono mb-1">Modules</p>
        {MODULE_ROWS.map(({ key, label, body, Icon }) => (
          <div key={key} className="flex items-center gap-3">
            <Icon size={20} className="shrink-0 text-ink-3" />
            <div className="flex-1">
              <Switch checked={modules.has(key)} onChange={(v) => toggleModule(key, v)} label={label} description={body} />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <GlobeHemisphereWest size={20} className="shrink-0 text-ink-3" />
        <div className="flex-1">
          <Switch
            checked={world}
            onChange={(v) => {
              setWorld(v);
              start(async () => {
                const res = await setWorldVisibleAction(v);
                if (!res.ok) {
                  setWorld(!v);
                  toast.show({ title: res.error, tone: 'error' });
                } else toast.show({ title: v ? 'You’re on the world leaderboards' : 'You’re hidden from the world leaderboards' });
              });
            }}
            label="Show me on world leaderboards"
            description="Your first name, last initial and this week’s numbers"
          />
        </div>
      </div>

      {modules.has('gym') && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Weights in</span>
          <Segmented
            label="Weight unit"
            value={s.weightUnit}
            onChange={(weightUnit) => {
              const next = { ...s, weightUnit };
              setS(next);
              save(next);
            }}
            options={[
              { value: 'kg', label: 'Kilograms' },
              { value: 'lb', label: 'Pounds' },
            ]}
          />
          <p className="text-[12px] text-ink-3">Only changes how weights are shown. Logged sets keep the exact number you entered.</p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-2">Theme</span>
        <Segmented
          label="Theme"
          value={s.theme}
          onChange={(theme) => {
            const next = { ...s, theme };
            setS(next);
            document.documentElement.dataset.theme = theme;
            save(next);
          }}
          options={[
            { value: 'system', label: 'System' },
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-2">Accent · unlocked by level</span>
        <div className="flex flex-wrap gap-2">
          {data.accents.map((a) => (
            <button
              key={a.accent}
              type="button"
              disabled={!a.unlocked}
              aria-pressed={s.accent === a.accent}
              onClick={() => {
                const next = { ...s, accent: a.accent };
                setS(next);
                document.documentElement.dataset.accent = a.accent;
                save(next);
              }}
              className={cn(
                'pressable flex h-11 items-center gap-2 rounded-full border px-3 text-sm font-medium disabled:cursor-not-allowed',
                s.accent === a.accent ? 'border-ink text-ink' : 'border-line-strong text-ink-2',
                !a.unlocked && 'opacity-45',
              )}
            >
              <span className="size-4 rounded-full" style={{ background: ACCENT_SWATCH[a.accent] }} />
              {a.name}
              {!a.unlocked && <span className="text-xs text-ink-3">Level {a.level}</span>}
            </button>
          ))}
        </div>
      </div>
      <Field label="Name" htmlFor="set-name">
        <Input id="set-name" value={s.displayName} onChange={(e) => setS({ ...s, displayName: e.target.value })} maxLength={60} autoComplete="name" />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Time zone" htmlFor="set-tz">
          <Select id="set-tz" value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })}>
            {tzs.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Main currency" htmlFor="set-cur" hint="Totals convert into this, with the rate shown.">
          <Select id="set-cur" value={s.baseCurrency} onChange={(e) => setS({ ...s, baseCurrency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Week starts on" htmlFor="set-ws">
          <Select id="set-ws" value={String(s.weekStartsOn)} onChange={(e) => setS({ ...s, weekStartsOn: Number(e.target.value) })}>
            <option value="1">Monday</option>
            <option value="0">Sunday</option>
            <option value="6">Saturday</option>
          </Select>
        </Field>
        <Field label="Reminders" htmlFor="set-notif" hint="Minimal: weekly report only. Balanced: plus one evening nudge when something’s still open.">
          <Select id="set-notif" value={s.notificationLevel} onChange={(e) => setS({ ...s, notificationLevel: e.target.value as typeof s.notificationLevel })}>
            <option value="off">Off</option>
            <option value="minimal">Minimal</option>
            <option value="balanced">Balanced</option>
            <option value="active">Active</option>
          </Select>
        </Field>
      </div>
      <Button onClick={() => save()} loading={pending} className="self-start">
        Save settings
      </Button>

      <div className="flex flex-wrap gap-2 border-t border-line pt-5">
        <button type="button" onClick={() => tour.start()} className="pressable inline-flex h-11 items-center gap-2 rounded-[12px] border border-line-strong px-4 text-[15px] font-medium text-ink hover:bg-sunken">
          <Compass size={16} /> Take the tour
        </button>
        <a href="/api/v1/export" className="pressable inline-flex h-11 items-center gap-2 rounded-[12px] border border-line-strong px-4 text-[15px] font-medium text-ink hover:bg-sunken">
          <DownloadSimple size={16} /> Download my data
        </a>
        <form
          action={signOutAction}
          onSubmit={() => {
            // cached pages hold personal data — drop them on sign-out, along with any unsynced queue
            void (typeof caches !== 'undefined' && caches.keys().then((ks) => ks.filter((k) => k.endsWith('-pages')).forEach((k) => caches.delete(k))));
            try {
              for (const k of Object.keys(localStorage)) if (k.startsWith('kept_')) localStorage.removeItem(k);
            } catch {}
          }}
        >
          <Button type="submit" variant="ghost">
            <SignOut size={16} /> Sign out
          </Button>
        </form>
      </div>
      <p className="-mt-3 text-xs text-ink-3">
        Signed in as {data.email} · member since {formatDay(data.memberSince)}. Your proof, journal and money are private — groups only ever see what you share with them.
      </p>
    </section>
  );
}
