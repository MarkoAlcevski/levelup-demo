import type { Metadata } from 'next';
import Link from 'next/link';
import { CaretRight, GlobeHemisphereWest, Plus } from '@phosphor-icons/react/dist/ssr';
import { getViewer } from '@/lib/server/context';
import { GROUP_KIND_LABEL, listGroups } from '@/lib/server/groups';
import { Page, Section } from '@/components/page';
import { Meter } from '@/components/viz/marks';
import { JoinCodeForm } from '@/components/groups/group-forms';
import { myWorldRank } from '@/lib/server/world';

export const metadata: Metadata = { title: 'Groups' };

const pct = (r: number) => `${Math.round(r * 100)}%`;

export default async function GroupsPage() {
  const viewer = await getViewer();
  const [groups, world] = await Promise.all([listGroups(viewer), myWorldRank(viewer).catch(() => null)]);
  const create = (
    <Link href="/groups/new" className="pressable inline-flex h-11 items-center gap-2 rounded-[12px] bg-accent px-4 text-[15px] font-medium text-accent-ink hover:brightness-[1.04]">
      <Plus size={16} weight="bold" /> New group
    </Link>
  );
  return (
    <Page title="Groups" actions={groups.length ? create : undefined}>
      <Link
        href="/groups/world"
        data-tour="world"
        className="pressable flex items-center gap-3.5 rounded-[16px] border border-line bg-surface px-4 py-3.5 hover:border-line-strong"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-accent-soft text-accent-text">
          <GlobeHemisphereWest size={22} weight="fill" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold text-ink">World leaderboard</span>
          <span className="block text-[13px] text-ink-3">
            {world ? `You’re #${world.rank} of ${world.total} this week` : 'Everyone on LevelUp, ranked every week'}
          </span>
        </span>
        <CaretRight size={16} className="shrink-0 text-ink-3" aria-hidden />
      </Link>

      {groups.length ? (
        <ul className="flex flex-col gap-3" data-tour="groups">
          {groups.map((g) => (
            <li key={g.id}>
              <Link href={`/groups/${g.id}`} className="pressable block rounded-[16px] border border-line px-4 py-4 hover:border-line-strong hover:bg-sunken/40">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="label-mono">
                      {GROUP_KIND_LABEL[g.kind]} · {g.members} member{g.members === 1 ? '' : 's'}
                      {g.season ? ` · ${g.season.label}, ${g.season.daysLeft}d left` : ''}
                    </p>
                    <p className="mt-1 truncate text-[18px] font-semibold tracking-[-0.02em] text-ink">{g.name}</p>
                  </div>
                  {g.me?.linked && (
                    <div className="shrink-0 text-right">
                      <p className="text-[22px] font-semibold leading-none tracking-[-0.03em] text-ink tnum">#{g.me.rank}</p>
                      <p className="mt-1 text-[12px] text-ink-3 tnum">{pct(g.me.rate)}</p>
                    </div>
                  )}
                  <CaretRight size={16} className="shrink-0 text-ink-3" aria-hidden />
                </div>
                {g.me?.linked ? (
                  <>
                    <Meter className="mt-3" value={g.me.rate} label={`You’ve kept ${pct(g.me.rate)} of your target this season`} />
                    {g.leader && <p className="mt-2 text-[13px] text-ink-3">Leading: {g.leader.name} · {pct(g.leader.rate)}</p>}
                  </>
                ) : (
                  <p className="mt-2 text-[14px] font-medium text-accent-text">Set your target to join the leaderboard →</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-[16px] border border-dashed border-line-strong px-5 py-8">
          <p className="text-lg font-semibold text-ink">Keep each other honest</p>
          <p className="mt-1.5 max-w-md text-[15px] leading-6 text-ink-2">
            A private group for friends who train or study together. Everyone sets their own weekly target, and the leaderboard ranks how well each of you keeps it — not who does the most.
          </p>
          <div className="mt-5">{create}</div>
        </div>
      )}

      <Section title="Join with a code">
        <JoinCodeForm />
        <p className="mt-2 text-[13px] text-ink-3">Got an invite link? Just open it — it brings you straight here.</p>
      </Section>
    </Page>
  );
}
