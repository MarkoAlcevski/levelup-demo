'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Crown, Info, LinkSimple, Medal, ShareNetwork, Trophy } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/engine/dates';
import { fmtAmount, ofAmount, unitLabel, type GroupUnit } from '@/lib/engine/groups';
import type { GroupPage } from '@/lib/server/groups';
import { archiveGroupAction, endSeasonAction, leaveGroupAction, removeMemberAction, updateGroupSettingsAction, updateMembershipAction } from '@/lib/actions';
import { Button, Field, Input, Segmented, Textarea } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { LinkSetup } from './group-forms';
import { GymPics } from './gym-pics';

const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;

export function GroupView({ data, isNew }: { data: GroupPage; isNew: boolean }) {
  const g = data.group;
  const me = data.me!;
  const [tab, setTab] = useState<'board' | 'pics' | 'hall' | 'rules'>('board');
  const [invite, setInvite] = useState(isNew && me.role === 'owner');
  const [settings, setSettings] = useState(false);
  const [mine, setMine] = useState(false);
  const linked = !!me.missionId;

  return (
    <>
      <section aria-label="Season" className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="label-mono">
            {!data.season
              ? 'No season yet'
              : data.season.upcoming
                ? `${data.season.label} · starts ${formatDay(data.season.start, data.today)}`
                : `${data.season.label} · ${data.season.daysLeft} day${data.season.daysLeft === 1 ? '' : 's'} left`}
          </p>
          <p className="mt-1 text-[40px] font-semibold leading-none tracking-[-0.04em] text-ink tnum">{data.groupRate == null ? '—' : pct(data.groupRate)}</p>
          <p className="mt-1 text-[13px] text-ink-3">group completion so far · {data.members.length} member{data.members.length === 1 ? '' : 's'}</p>
          {g.prize && <p className="mt-1 text-[13px] text-ink-2">Prize: {g.prize}</p>}
        </div>
        <Button variant="outline" onClick={() => setInvite(true)}>
          <ShareNetwork size={16} /> Invite
        </Button>
      </section>

      {!linked && (
        <section aria-label="Your target" className="rounded-[16px] border border-accent/35 bg-accent-soft p-4">
          <p className="text-[17px] font-semibold text-ink">Set your target to compete</p>
          <p className="mt-1 text-[14px] text-ink-2">Link your own {g.kind === 'gym' ? 'gym program' : g.kind === 'learning' ? 'learning subject' : 'routine'} and pledge a weekly number. It locks for this season from today.</p>
          <div className="mt-4">
            <LinkSetup groupId={g.id} kind={g.kind} targetRule={g.targetRule} sameTarget={g.sameTarget} minTarget={g.minTarget} maxTarget={g.maxTarget} />
          </div>
        </section>
      )}

      <nav aria-label="Group sections" className="flex rounded-[12px] bg-sunken p-1">
        {(
          [
            ['board', 'Leaderboard'],
            ...(g.kind === 'gym' ? ([['pics', 'Gym pics']] as const) : []),
            ['hall', 'Hall of Fame'],
            ['rules', 'Rules'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            aria-pressed={tab === k}
            onClick={() => setTab(k)}
            className={cn('pressable h-10 flex-1 rounded-[9px] text-[13px] font-medium', tab === k ? 'bg-raised text-ink shadow-[0_1px_2px_rgb(0_0_0/0.2),0_0_0_1px_var(--line-2)]' : 'text-ink-3 hover:text-ink-2')}
          >
            {l}
          </button>
        ))}
      </nav>

      {tab === 'board' && (
        <>
          <section aria-labelledby="board-h">
            <h2 id="board-h" className="sr-only">Leaderboard</h2>
            {data.standings.length ? (
              <ol className="flex flex-col divide-y divide-line">
                {data.standings.map((s) => {
                  const isMe = data.members.find((m) => m.userId === s.userId)?.isMe;
                  const due = s.pledgedToDate > 0;
                  return (
                    <li key={s.userId} className={cn('py-3.5', isMe && '-mx-3 rounded-[12px] bg-sunken/60 px-3')}>
                      <div className="flex items-center gap-3">
                        <span className={cn('grid size-9 shrink-0 place-items-center rounded-full text-[15px] font-semibold tnum', s.rank === 1 && s.rate > 0 ? 'bg-accent text-accent-ink' : 'bg-sunken text-ink-2')}>
                          {s.rank === 1 && s.rate > 0 ? <Crown size={17} weight="fill" /> : s.rank}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[16px] font-semibold text-ink">
                            {s.name}
                            {isMe && <span className="ml-1.5 text-[13px] font-normal text-ink-3">you</span>}
                            {s.tied && <span className="ml-2 font-mono text-[10px] uppercase text-ink-3">tie</span>}
                          </span>
                          <span className="block text-[13px] text-ink-3 tnum">
                            {due ? `${ofAmount(s.eligible, s.pledgedToDate, s.unit)} so far` : 'Nothing due yet'} · {fmtAmount(s.target, s.unit)} a week
                            {s.done > s.eligible && <span> · +{fmtAmount(s.done - s.eligible, s.unit)} extra</span>}
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-[20px] font-semibold tracking-[-0.02em] text-ink tnum">{due ? pct(s.rate) : '—'}</span>
                      </div>
                      {/* one bar, one segment per week (sized by its days), each filled by that week's share of the pledge */}
                      <div className="mt-2.5 flex gap-1" role="img" aria-label={`${s.name}: ${due ? pct(s.rate) : 'nothing due yet'}; ${s.perfectWeeks} of ${s.weeks} finished weeks on target`}>
                        {s.weekly.map((w) => {
                          const fill = w.pledged > 0 ? Math.min(1, w.done / w.pledged) : 0;
                          return (
                            <span
                              key={w.start}
                              title={`${formatDay(w.start)}–${formatDay(w.end)}: ${ofAmount(w.done, w.pledged, s.unit)}`}
                              style={{ flexGrow: w.days }}
                              className="relative h-1.5 basis-0 overflow-hidden rounded-full bg-sunken"
                            >
                              <span
                                className={cn('absolute inset-y-0 left-0 rounded-full', fill >= 1 ? 'bg-accent' : w.complete ? 'bg-ink-3/60' : 'bg-accent/55')}
                                style={{ width: `${fill * 100}%` }}
                              />
                            </span>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-sm text-ink-3">The leaderboard fills in as members set their targets.</p>
            )}
            {data.members.filter((m) => !m.linked).length > 0 && (
              <p className="mt-2 text-[13px] text-ink-3">Not set up yet: {data.members.filter((m) => !m.linked).map((m) => m.name).join(', ')}.</p>
            )}
            <p className="mt-2 text-[12px] text-ink-3">
              Ranked by how much of their own target each person has kept so far (capped at 100% a week). Extra work shows, but can’t buy a win.
            </p>
          </section>

          <section aria-labelledby="act-h">
            <h2 id="act-h" className="mb-1 text-[17px] font-semibold tracking-[-0.015em] text-ink">Activity</h2>
            {data.activity.length ? (
              <ul className="divide-y divide-line">
                {data.activity.map((a) => (
                  <li key={a.id} className="flex min-h-12 items-center gap-3 py-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sunken text-[13px] font-semibold text-ink-2">{a.name.slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0 flex-1 text-[15px] text-ink-2">
                      <span className="font-medium text-ink">{a.name}</span> {a.title}
                      {a.kind === 'award' && <Trophy size={14} weight="fill" className="ml-1 inline text-accent-text" aria-label="award" />}
                    </span>
                    {a.picId && (
                      <button type="button" onClick={() => setTab('pics')} className="pressable block size-11 shrink-0 overflow-hidden rounded-[8px] bg-sunken" aria-label={`Open gym pics — ${a.name}’s pic`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/groups/${g.id}/pics/${a.picId}?v=thumb`} alt="" className="size-full object-cover" />
                      </button>
                    )}
                    {a.proofId && (a.proofKind === 'photo' || a.proofKind === 'screenshot') && (
                      <a href={`/api/groups/${g.id}/proofs/${a.proofId}`} target="_blank" rel="noreferrer" className="block size-11 shrink-0 overflow-hidden rounded-[8px] bg-sunken">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/groups/${g.id}/proofs/${a.proofId}?v=thumb`} alt={`Proof shared by ${a.name}`} className="size-full object-cover" />
                      </a>
                    )}
                    <span className="shrink-0 font-mono text-[11px] uppercase text-ink-3">{formatDay(a.on, data.today)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">Workouts, sessions and weekly targets show up here — just the headline, never the details.</p>
            )}
          </section>
        </>
      )}

      {tab === 'pics' && g.kind === 'gym' && <GymPics groupId={g.id} today={data.today} />}

      {tab === 'hall' && (
        <>
          {data.year && (
            <section aria-labelledby="year-h">
              <h2 id="year-h" className="mb-1 text-[17px] font-semibold tracking-[-0.015em] text-ink">{data.year.year} championship</h2>
              {data.year.champion && (
                <p className="mb-2 flex items-center gap-2 text-[15px] text-ink">
                  <Trophy size={18} weight="fill" className="text-accent-text" /> {data.year.champion.title}: {data.year.champion.name}
                </p>
              )}
              <ol className="divide-y divide-line">
                {data.year.rows.map((r) => (
                  <li key={r.userId} className="flex min-h-12 items-center gap-3">
                    <span className="w-6 text-center font-mono text-[13px] text-ink-3 tnum">{r.rank}</span>
                    <span className="min-w-0 flex-1 text-[15px] text-ink">
                      {r.name}
                      {r.tied && <span className="ml-2 font-mono text-[10px] uppercase text-ink-3">tie</span>}
                    </span>
                    <span className="text-[13px] text-ink-3 tnum">{r.wins} win{r.wins === 1 ? '' : 's'}</span>
                    <span className="w-14 text-right text-[15px] font-semibold text-ink tnum">{r.points} pts</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <section aria-labelledby="hall-h">
            <h2 id="hall-h" className="mb-1 text-[17px] font-semibold tracking-[-0.015em] text-ink">Hall of Fame</h2>
            {data.hall.length ? (
              <ol className="flex flex-col gap-3">
                {data.hall.map((h) => (
                  <li key={h.seasonId} className="rounded-[16px] border border-line px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-[15px] font-semibold text-ink">{h.label}</p>
                      <p className="text-[12px] text-ink-3">{h.range}{h.groupRate != null ? ` · group ${pct(h.groupRate)}` : ''}</p>
                    </div>
                    {h.champions.length ? (
                      h.champions.map((c) => (
                        <p key={c.name} className="mt-1 flex items-center gap-2 text-[15px] text-ink">
                          <Crown size={16} weight="fill" className="text-accent-text" /> {c.name}
                          <span className="text-[13px] text-ink-3">{c.detail}</span>
                        </p>
                      ))
                    ) : (
                      <p className="mt-1 text-[13px] text-ink-3">No champion — nobody logged anything.</p>
                    )}
                    {h.awards.length > 0 && (
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {h.awards.map((a) => (
                          <li key={a.name + a.kind} className="inline-flex items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-[12px] text-ink-2">
                            <Medal size={12} /> {a.title} · {a.name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-ink-3">Every finished season lands here for good: the winner, the numbers, the awards.</p>
            )}
          </section>
          {data.records.length > 0 && (
            <section aria-labelledby="rec-h">
              <h2 id="rec-h" className="mb-1 text-[17px] font-semibold tracking-[-0.015em] text-ink">Group records</h2>
              <ul className="divide-y divide-line">
                {data.records.map((r) => (
                  <li key={r.label} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-[15px] text-ink-2">{r.label}</span>
                    <span className="text-right">
                      <span className="block text-[15px] font-semibold text-ink">{r.value}</span>
                      <span className="block text-[12px] text-ink-3">{r.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {tab === 'rules' && (
        <section aria-labelledby="rules-h" className="flex flex-col gap-3 text-[15px] leading-6 text-ink-2">
          <h2 id="rules-h" className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.015em] text-ink">
            <Info size={18} /> How this group scores
          </h2>
          {g.description && <p className="text-ink">{g.description}</p>}
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              <b className="text-ink">Seasons:</b> {g.seasonLength === 'month' ? 'calendar months' : g.seasonLength === 'week' ? 'Monday–Sunday weeks' : `${g.seasonDays}-day seasons`}. Each season’s standings are frozen when it ends.
            </li>
            <li>
              <b className="text-ink">Targets:</b> {g.targetRule === 'same' ? `everyone pledges ${g.sameTarget} a week` : `everyone pledges their own weekly target${g.minTarget != null || g.maxTarget != null ? ` (${[g.minTarget != null ? `at least ${g.minTarget}` : null, g.maxTarget != null ? `at most ${g.maxTarget}` : null].filter(Boolean).join(', ')})` : ''}`}. It locks for the season — changing it applies next season.
            </li>
            <li>
              <b className="text-ink">Commitment rate</b> = what you did ÷ what you pledged, counted week by week and capped at your pledge each week. Joining mid-season prorates the pledge.
            </li>
            <li>
              <b className="text-ink">Ties</b> are broken by perfect weeks, then total pledged work completed{g.proofPolicy !== 'self_report' ? ', then proof rate' : ''}. Still level? It’s a tie, and it’s shown as one.
            </li>
            <li>
              <b className="text-ink">Proof:</b> {g.proofPolicy === 'proof_required' ? 'only days with proof shared to this group count.' : g.proofPolicy === 'proof_optional' ? 'optional, used as a tie-breaker.' : 'self-report — your word counts.'} Proof is never shared unless you share it.
            </li>
            <li>
              <b className="text-ink">Championship points</b> per season: 1st 5 · 2nd 3 · 3rd 2, plus 3 / 2 / 1 for keeping ≥ 90% / 75% / 50% of your pledge, plus 1 for a perfect season. Most points in the year wins the year; wins break ties.
            </li>
            {g.prize && (
              <li>
                <b className="text-ink">Prize:</b> {g.prize}
              </li>
            )}
            <li>Members see names, targets, progress and group activity here — never anyone’s money, other areas, notes or unshared proof.</li>
          </ul>
        </section>
      )}

      <section aria-label="Your membership" className="flex flex-wrap gap-2 border-t border-line pt-5">
        <Button variant="outline" onClick={() => setMine(true)}>
          Your settings
        </Button>
        {(me.role === 'owner' || me.role === 'admin') && (
          <Button variant="outline" onClick={() => setSettings(true)}>
            Group settings
          </Button>
        )}
      </section>

      <InviteSheet open={invite} onClose={() => setInvite(false)} code={g.joinCode ?? ''} name={g.name} />
      <MySettings open={mine} onClose={() => setMine(false)} data={data} />
      {(me.role === 'owner' || me.role === 'admin') && <OwnerSettings open={settings} onClose={() => setSettings(false)} data={data} />}
    </>
  );
}

function InviteSheet({ open, onClose, code, name }: { open: boolean; onClose: () => void; code: string; name: string }) {
  const toast = useToast();
  const [link, setLink] = useState('');
  useEffect(() => setLink(`${window.location.origin}/groups/join/${code}`), [code]);
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ title: `${what} copied` });
    } catch {
      toast.show({ title: 'Couldn’t copy — select it instead', tone: 'error' });
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={`Invite to ${name}`} size="sm" description="Anyone with the code or link can join. Only people you send it to will see the group.">
      <div className="flex flex-col gap-4 pt-1">
        <div className="rounded-[14px] border border-line-strong bg-surface px-4 py-4 text-center">
          <p className="label-mono">Join code</p>
          <p className="mt-1 font-mono text-[32px] font-semibold tracking-[0.2em] text-ink">{code}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => copy(code, 'Code')}>
            <Copy size={16} /> Copy code
          </Button>
          <Button variant="secondary" onClick={() => copy(link, 'Link')}>
            <LinkSimple size={16} /> Copy link
          </Button>
        </div>
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <Button onClick={() => navigator.share({ title: `Join ${name} on LevelUp`, text: `Join my group “${name}” on LevelUp — code ${code}`, url: link }).catch(() => {})}>
            <ShareNetwork size={16} /> Share…
          </Button>
        )}
        <p className="break-all text-center font-mono text-[12px] text-ink-3">{link}</p>
      </div>
    </Sheet>
  );
}

function MySettings({ open, onClose, data }: { open: boolean; onClose: () => void; data: GroupPage }) {
  const me = data.me!;
  const g = data.group;
  const [name, setName] = useState(me.name);
  const [target, setTarget] = useState(me.target != null ? String(me.target) : '');
  const [share, setShare] = useState(me.proofShare);
  const [relink, setRelink] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const unit = (me.unit ?? 'times') as GroupUnit;
  return (
    <Sheet open={open} onClose={onClose} title="Your settings" description={g.name}>
      {relink ? (
        <LinkSetup groupId={g.id} kind={g.kind} targetRule={g.targetRule} sameTarget={g.sameTarget} minTarget={g.minTarget} maxTarget={g.maxTarget} current={{ missionId: me.missionId, target: me.target }} onDone={onClose} />
      ) : (
        <form
          className="flex flex-col gap-4 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await updateMembershipAction(g.id, { displayName: name, target: target ? Number(target.replace(',', '.')) : null, proofShare: share });
              if (!r.ok) return setError(r.error);
              onClose();
              router.refresh();
            });
          }}
        >
          {data.myCommitment && (
            <p className="rounded-[12px] bg-sunken px-3.5 py-2.5 text-[14px] text-ink-2">
              This season you pledged <span className="font-semibold text-ink">{data.myCommitment.target} {unitLabel(data.myCommitment.unit, data.myCommitment.target)} a week</span>. That’s locked until the season ends.
            </p>
          )}
          <Field label="Name in this group" htmlFor="ms-name">
            <Input id="ms-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </Field>
          {g.targetRule === 'personal' && (
            <Field label={`Next season’s target (${unitLabel(unit)} per week)`} htmlFor="ms-target">
              <Input id="ms-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
            </Field>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">Share proof with this group</span>
            <Segmented label="Proof sharing" size="sm" value={share} onChange={setShare} options={[{ value: 'never', label: 'Never' }, { value: 'ask', label: 'Ask' }, { value: 'auto', label: 'Automatically' }]} />
          </div>
          {error && <p className="text-sm text-bad" role="alert">{error}</p>}
          <Button type="submit" size="lg" block loading={pending}>
            Save
          </Button>
          <Button variant="ghost" onClick={() => setRelink(true)}>
            Change what counts
          </Button>
          {me.role !== 'owner' &&
            (confirmLeave ? (
              <Button
                variant="danger"
                onClick={() =>
                  start(async () => {
                    const r = await leaveGroupAction(g.id);
                    if (!r.ok) return setError(r.error);
                    router.push('/groups');
                  })
                }
              >
                Leave {g.name}
              </Button>
            ) : (
              <button type="button" onClick={() => setConfirmLeave(true)} className="text-[13px] text-ink-3 hover:text-bad">
                Leave group
              </button>
            ))}
        </form>
      )}
    </Sheet>
  );
}

function OwnerSettings({ open, onClose, data }: { open: boolean; onClose: () => void; data: GroupPage }) {
  const g = data.group;
  const [name, setName] = useState(g.name);
  const [description, setDescription] = useState(g.description ?? '');
  const [proof, setProof] = useState(g.proofPolicy);
  const [min, setMin] = useState(g.minTarget != null ? String(g.minTarget) : '');
  const [max, setMax] = useState(g.maxTarget != null ? String(g.maxTarget) : '');
  const [prize, setPrize] = useState(g.prize ?? '');
  const [confirm, setConfirm] = useState<'end' | 'archive' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const num = (s: string) => (s.trim() ? Number(s.replace(',', '.')) : null);
  const isOwner = data.me?.role === 'owner';
  return (
    <Sheet open={open} onClose={onClose} title="Group settings">
      <form
        className="flex flex-col gap-4 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await updateGroupSettingsAction(g.id, { name, description: description || null, proofPolicy: proof, minTarget: num(min), maxTarget: num(max), prize: prize || null });
            if (!r.ok) return setError(r.error);
            onClose();
            router.refresh();
          });
        }}
      >
        <Field label="Name" htmlFor="os-name">
          <Input id="os-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        <Field label="Description" htmlFor="os-desc">
          <Textarea id="os-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} className="min-h-16" />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Proof</span>
          <Segmented label="Proof" size="sm" value={proof} onChange={setProof} options={[{ value: 'self_report', label: 'Self-report' }, { value: 'proof_optional', label: 'Optional' }, { value: 'proof_required', label: 'Required' }]} />
        </div>
        {g.targetRule === 'personal' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lowest target" htmlFor="os-min">
              <Input id="os-min" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
            </Field>
            <Field label="Highest target" htmlFor="os-max">
              <Input id="os-max" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
            </Field>
          </div>
        )}
        <Field label="Prize" htmlFor="os-prize">
          <Input id="os-prize" value={prize} onChange={(e) => setPrize(e.target.value)} maxLength={200} />
        </Field>
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        <Button type="submit" size="lg" block loading={pending}>
          Save settings
        </Button>
        <div className="mt-2 flex flex-col gap-2 border-t border-line pt-4">
          <p className="label-mono">Members</p>
          <ul className="divide-y divide-line">
            {data.members.map((m) => (
              <li key={m.userId} className="flex min-h-11 items-center gap-2">
                <span className="flex-1 text-[15px] text-ink">
                  {m.name} <span className="text-[12px] text-ink-3">{m.role}</span>
                </span>
                {!m.isMe && m.role !== 'owner' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      start(async () => {
                        const r = await removeMemberAction(g.id, m.userId);
                        toast.show(r.ok ? { title: `${m.name} removed` } : { title: r.error, tone: 'error' });
                        router.refresh();
                      })
                    }
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
        {isOwner && (
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            {confirm === 'end' ? (
              <Button
                variant="danger"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    const r = await endSeasonAction(g.id);
                    toast.show(r.ok ? { title: 'Season ended', detail: 'Final standings are in the Hall of Fame. The next season starts tomorrow.' } : { title: r.error, tone: 'error' });
                    onClose();
                    router.refresh();
                  })
                }
              >
                End {data.season?.label ?? 'the season'} now — results become final
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setConfirm('end')} disabled={!data.season}>
                End this season early
              </Button>
            )}
            {confirm === 'archive' ? (
              <Button
                variant="danger"
                onClick={() =>
                  start(async () => {
                    await archiveGroupAction(g.id);
                    router.push('/groups');
                  })
                }
              >
                Archive the group for everyone
              </Button>
            ) : (
              <button type="button" onClick={() => setConfirm('archive')} className="text-[13px] text-ink-3 hover:text-bad">
                Archive group
              </button>
            )}
          </div>
        )}
      </form>
    </Sheet>
  );
}
