'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Barbell, BookOpenText, Hexagon } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { createGroupAction, joinGroupAction, linkMembershipAction, linkOptionsAction } from '@/lib/actions';
import type { LinkOption } from '@/lib/server/groups';
import { fmtAmount, unitLabel, type GroupUnit } from '@/lib/engine/groups';
import { Button, Field, Input, Segmented, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { useViewerInfo } from '@/components/shell/viewer';

const KINDS = [
  { value: 'gym', label: 'Gym', Icon: Barbell, body: 'Workouts per week' },
  { value: 'learning', label: 'Learning', Icon: BookOpenText, body: 'Time or sessions' },
  { value: 'custom', label: 'Custom', Icon: Hexagon, body: 'Any routine' },
] as const;

/** Create a private group. Defaults: monthly seasons, personal targets, self-reported. */
export function CreateGroupForm() {
  const v = useViewerInfo();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'gym' | 'learning' | 'custom' | null>(null);
  const [description, setDescription] = useState('');
  const [season, setSeason] = useState<'week' | 'month' | 'custom'>('month');
  const [seasonDays, setSeasonDays] = useState('30');
  const [proof, setProof] = useState<'self_report' | 'proof_optional' | 'proof_required'>('self_report');
  const [rule, setRule] = useState<'personal' | 'same'>('personal');
  const [same, setSame] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [prize, setPrize] = useState('');
  const [displayName, setDisplayName] = useState(v.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const num = (s: string) => (s.trim() ? Number(s.replace(',', '.')) : null);
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await createGroupAction({
            name, kind: kind!, description: description || null, seasonLength: season, seasonDays: season === 'custom' ? num(seasonDays) : null,
            proofPolicy: proof, targetRule: rule, sameTarget: rule === 'same' ? num(same) : null, minTarget: num(min), maxTarget: num(max), prize: prize || null, displayName,
          });
          if (!res.ok) return setError(res.error);
          router.push(`/groups/${res.id}?new=1`);
        });
      }}
    >
      <Field label="Group name" htmlFor="gr-name">
        <Input id="gr-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Gym Crew" />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-2">What you compete on</span>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Group type">
          {KINDS.map(({ value, label, Icon, body }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              onClick={() => {
                setKind(value);
                if (value === 'learning') setRule('personal');
              }}
              className={cn('pressable flex min-h-20 flex-col items-start justify-start gap-2 rounded-[14px] border px-3 py-2.5 text-left', kind === value ? 'border-accent-text bg-accent-soft' : 'border-line-strong hover:border-ink-3')}
            >
              <Icon size={20} className={kind === value ? 'text-accent-text' : 'text-ink-3'} />
              <span>
                <span className="block text-[15px] font-semibold text-ink">{label}</span>
                <span className="block text-[11px] text-ink-3">{body}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-2">Seasons</span>
        <Segmented label="Season length" value={season} onChange={setSeason} options={[{ value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }, { value: 'custom', label: 'Custom' }]} />
        {season === 'custom' && (
          <div className="flex items-center gap-2">
            <Input aria-label="Days per season" inputMode="numeric" value={seasonDays} onChange={(e) => setSeasonDays(e.target.value.replace(/[^\d]/g, ''))} className="w-24" />
            <span className="text-[13px] text-ink-3">days per season (7–120)</span>
          </div>
        )}
        <p className="text-[12px] text-ink-3">Each season crowns a winner, kept in the group’s Hall of Fame.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-2">Targets</span>
        <Segmented
          label="Target rule"
          value={rule}
          onChange={(r) => kind !== 'learning' && setRule(r)}
          options={[{ value: 'personal', label: 'Everyone sets their own' }, { value: 'same', label: 'Same for everyone' }]}
        />
        {rule === 'same' ? (
          <Field label={kind === 'gym' ? 'Workouts per week' : 'Times per week'} htmlFor="gr-same">
            <Input id="gr-same" inputMode="numeric" value={same} onChange={(e) => setSame(e.target.value.replace(/[^\d.]/g, ''))} placeholder="4" />
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lowest allowed (optional)" htmlFor="gr-min">
              <Input id="gr-min" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder={kind === 'gym' ? '2' : ''} />
            </Field>
            <Field label="Highest allowed (optional)" htmlFor="gr-max">
              <Input id="gr-max" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder={kind === 'gym' ? '6' : ''} />
            </Field>
          </div>
        )}
        <p className="text-[12px] text-ink-3">The ranking is how well each person keeps their own target — someone who does 4 of 4 beats someone who does 6 of 8.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-2">Proof</span>
        <Segmented label="Proof" size="sm" value={proof} onChange={setProof} options={[{ value: 'self_report', label: 'Self-report' }, { value: 'proof_optional', label: 'Optional' }, { value: 'proof_required', label: 'Required' }]} />
        <p className="text-[12px] text-ink-3">
          {proof === 'proof_required' ? 'Only days with proof shared to the group count on the leaderboard.' : proof === 'proof_optional' ? 'Proof is a tie-breaker.' : 'Everyone’s word is enough.'} Proof is never shared unless its owner shares it.
        </p>
      </div>
      <Field label="Description (optional)" htmlFor="gr-desc">
        <Textarea id="gr-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} className="min-h-16" />
      </Field>
      <Field label="Prize (optional)" htmlFor="gr-prize" hint="Just text — LevelUp doesn’t handle money here.">
        <Input id="gr-prize" value={prize} onChange={(e) => setPrize(e.target.value)} maxLength={200} placeholder="Winner picks the restaurant" />
      </Field>
      <Field label="Your name in this group" htmlFor="gr-me">
        <Input id="gr-me" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} />
      </Field>
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <Button type="submit" size="lg" block loading={pending} disabled={!name.trim() || !kind || !displayName.trim()}>
        Create group
      </Button>
      <p className="-mt-3 text-center text-[12px] text-ink-3">Private: only people with the invite code can join.</p>
    </form>
  );
}

export function JoinCodeForm() {
  const [code, setCode] = useState('');
  const router = useRouter();
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (c.length === 8) router.push(`/groups/join/${c}`);
      }}
    >
      <Input aria-label="Join code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={9} placeholder="8-character code" className="font-mono uppercase tracking-[0.15em]" autoCapitalize="characters" />
      <Button type="submit" size="lg" disabled={code.replace(/[^A-Za-z0-9]/g, '').length !== 8}>
        Join
      </Button>
    </form>
  );
}

export function JoinGroup({ code, preview }: { code: string; preview: { id: string; name: string; kind: string; members: number; alreadyMember: boolean } }) {
  const v = useViewerInfo();
  const [name, setName] = useState(v.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (preview.alreadyMember) {
    return (
      <Button size="lg" block onClick={() => router.push(`/groups/${preview.id}`)}>
        Open the group
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await joinGroupAction(code, name);
          if (!res.ok) return setError(res.error);
          router.push(`/groups/${res.id}?new=1`);
        });
      }}
    >
      <Field label="Your name in this group" htmlFor="jg-name" error={error}>
        <Input id="jg-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
      </Field>
      <Button type="submit" size="lg" block loading={pending} disabled={!name.trim()}>
        Join {preview.name}
      </Button>
      <p className="text-center text-[12px] text-ink-3">Members see your name, your target and your progress in this group — never your money, your other areas or private proof.</p>
    </form>
  );
}

/** Link YOUR routine and pledge a weekly target. It locks for the season when it starts. */
export function LinkSetup({
  groupId,
  kind,
  targetRule,
  sameTarget,
  minTarget,
  maxTarget,
  current,
  onDone,
}: {
  groupId: string;
  kind: 'gym' | 'learning' | 'custom';
  targetRule: 'personal' | 'same';
  sameTarget: number | null;
  minTarget: number | null;
  maxTarget: number | null;
  current?: { missionId: string | null; target: number | null } | null;
  onDone?: () => void;
}) {
  const [options, setOptions] = useState<LinkOption[] | null>(null);
  const [missionId, setMissionId] = useState<string | null>(current?.missionId ?? null);
  const [target, setTarget] = useState(current?.target != null ? String(current.target) : '');
  const [share, setShare] = useState<'never' | 'ask' | 'auto'>('ask');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  useEffect(() => {
    void linkOptionsAction(kind).then((o) => {
      setOptions(o);
      if (!missionId && o.length === 1) {
        setMissionId(o[0].missionId);
        if (!target) setTarget(String(o[0].defaultTarget));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  const opt = options?.find((o) => o.missionId === missionId) ?? null;
  const unit = (opt?.unit ?? (kind === 'gym' ? 'workouts' : 'times')) as GroupUnit;

  if (options && !options.length) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[15px] text-ink-2">
          {kind === 'gym' ? 'Set up your gym program first — the group counts the workouts you log.' : kind === 'learning' ? 'Add what you’re learning first — the group counts your sessions.' : 'Create a routine in one of your areas first — the group counts when you keep it.'}
        </p>
        <Button onClick={() => router.push(kind === 'gym' ? '/gym' : kind === 'learning' ? '/learning' : '/areas')}>
          {kind === 'gym' ? 'Set up Gym' : kind === 'learning' ? 'Set up Learning' : 'Go to Areas'}
        </Button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await linkMembershipAction(groupId, { missionId: missionId!, target: targetRule === 'same' ? sameTarget ?? 1 : Number(target.replace(',', '.')), proofShare: share });
          if (!res.ok) return setError(res.error);
          toast.show({ title: 'You’re in', detail: 'Your target is locked for this season from today.', tone: 'accent' });
          onDone?.();
          router.refresh();
        });
      }}
    >
      {!options ? (
        <div className="h-24 animate-pulse rounded-[12px] bg-sunken" />
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">What counts</span>
          <ul className="flex flex-col gap-2">
            {options.map((o) => (
              <li key={o.missionId}>
                <button
                  type="button"
                  aria-pressed={missionId === o.missionId}
                  onClick={() => {
                    setMissionId(o.missionId);
                    if (targetRule === 'personal') setTarget(String(o.defaultTarget));
                  }}
                  className={cn('pressable flex min-h-14 w-full items-center justify-between gap-3 rounded-[12px] border px-4 text-left', missionId === o.missionId ? 'border-accent-text bg-accent-soft' : 'border-line-strong hover:border-ink-3')}
                >
                  <span className="text-[15px] font-medium text-ink">{o.label}</span>
                  <span className="text-[13px] text-ink-3">{o.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {targetRule === 'same' ? (
        <p className="text-[15px] text-ink-2">Everyone’s target here: <span className="font-semibold text-ink">{sameTarget} {unitLabel(unit, sameTarget ?? 2)} a week</span>.</p>
      ) : (
        <Field
          label={`Your target (${unitLabel(unit)} per week)`}
          htmlFor="ln-target"
          hint={[minTarget != null ? `from ${minTarget}` : null, maxTarget != null ? `up to ${maxTarget}` : null].filter(Boolean).join(', ') || 'Your own number. It locks for the season once set.'}
        >
          <Input id="ln-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d.,]/g, ''))} />
        </Field>
      )}
      {missionId && Number(target) > 0 && targetRule === 'personal' && (
        <p className="-mt-2 text-[13px] text-ink-3">A 30-day season would pledge about {fmtAmount(Math.round(((Number(target) * 30) / 7) * 10) / 10, unit)}.</p>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-2">Share proof with this group?</span>
        <Segmented label="Proof sharing" size="sm" value={share} onChange={setShare} options={[{ value: 'never', label: 'Never' }, { value: 'ask', label: 'Ask each time' }, { value: 'auto', label: 'Automatically' }]} />
      </div>
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <Button type="submit" size="lg" block loading={pending} disabled={!missionId || (targetRule === 'personal' && !(Number(target) > 0))}>
        Lock in my target
      </Button>
    </form>
  );
}
