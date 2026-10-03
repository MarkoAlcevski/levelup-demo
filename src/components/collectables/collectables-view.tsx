'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowsLeftRight, Check, Copy as CopyIcon, Info, Trophy } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import {
  CHARACTER_BY_KEY, OFFER_DAYS, PITY, RARITIES, RARITY_LABEL, SELF_OPENED_FOR_PRIZE, SET_BY_KEY, oddsLabel, type SetKey,
} from '@/lib/engine/collectables';
import type { CollectableCard, CollectablesPage, SetView, TradeView } from '@/lib/server/collectables';
import { cancelTradeAction, claimPrizeAction, mateCollectionAction, offerTradeAction, openBoxAction, respondTradeAction } from '@/lib/actions';
import { Button } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { CharacterArt, RARITY_COLOR, RarityChip, rarityStyle, type ArtState } from './character-art';
import { BoxOpening, type Opening } from './box-opening';
import { LevelCoin, formatCoins } from './level-coin';

const stateOf = (c: CollectableCard): ArtState => (c.copies > 0 ? 'owned' : 'missing');
const nameOf = (key: string) => CHARACTER_BY_KEY.get(key)?.name ?? key;
const BOX_ART: Record<SetKey, string> = { gym: '/collectables/boxes/iron_crate.webp', finance: '/collectables/boxes/cash_case.webp' };
const STATUS_LABEL: Record<TradeView['status'], string> = {
  pending: 'waiting',
  accepted: 'accepted',
  declined: 'declined',
  cancelled: 'cancelled',
  failed: 'didn’t go through',
  expired: 'expired',
};

/** Boxes of two themes, the two sets they fill, trades with group mates, and a prize for each full set. */
export function CollectablesView({ data, coins, onCoins }: { data: CollectablesPage; coins: number; onCoins: (n: number) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [trade, setTrade] = useState<{ give?: string } | null>(null);
  const [prize, setPrize] = useState<{ set: SetKey; code: string } | null>(null);
  const [odds, setOdds] = useState(false);
  const [opening, setOpening] = useState<Opening | null>(null);
  const [claiming, startClaim] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const card = open ? (data.cards.find((c) => c.key === open) ?? null) : null;

  const openBox = async (set: SetKey) => {
    const nonce = Date.now();
    setOpen(null);
    setOpening({ nonce, set, pull: null });
    const r = await openBoxAction(set, crypto.randomUUID());
    if (!r.ok) {
      setOpening(null);
      toast.show({ title: r.error, tone: 'error' });
      return;
    }
    onCoins(r.coins);
    setOpening((o) => (o && o.nonce === nonce ? { ...o, pull: r.pull } : o));
  };

  const claim = (set: SetKey) =>
    startClaim(async () => {
      const r = await claimPrizeAction(set);
      if (!r.ok) {
        toast.show({ title: r.error, tone: 'error' });
        return;
      }
      setPrize({ set, code: r.code });
      router.refresh();
    });

  const trades = <Trades data={data} onTrade={() => setTrade({})} onChanged={() => router.refresh()} />;

  return (
    <div className="flex flex-col gap-8">
      {data.incoming.length > 0 && trades}

      <section aria-labelledby="boxes-h" data-tour="boxes">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="boxes-h" className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
            Boxes
          </h2>
          <button type="button" onClick={() => setOdds(true)} className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-ink-3 hover:text-ink-2">
            <Info size={15} /> Odds
          </button>
        </div>
        <ul className="grid grid-cols-2 gap-3">
          {data.sets.map((s) => {
            const can = coins >= s.box.cost;
            return (
              <li key={s.key} className="flex flex-col items-center gap-2 rounded-[20px] border border-line bg-surface px-3 pt-4 pb-3 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={BOX_ART[s.key]} alt="" className="lu-float h-[108px] w-auto select-none drop-shadow-[0_14px_18px_rgb(0_0_0/0.45)]" draggable={false} />
                <div>
                  <p className="text-[16px] font-semibold text-ink">{s.box.name}</p>
                  <p className="text-[12px] text-ink-3">{s.box.blurb}</p>
                </div>
                <Button block onClick={() => openBox(s.key)} disabled={!can || !!opening} variant={can ? 'primary' : 'secondary'}>
                  {can ? (
                    <>
                      Open · {formatCoins(s.box.cost)} <LevelCoin size={15} />
                    </>
                  ) : (
                    `${formatCoins(s.box.cost - coins)} more`
                  )}
                </Button>
                <p className="text-[11px] leading-4 text-ink-3">
                  Legendary or better within {s.pityLeft} {s.pityLeft === 1 ? 'box' : 'boxes'}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <div data-tour="collectables" className="flex flex-col gap-8">
        {data.sets.map((s) => (
          <SetSection
            key={s.key}
            set={s}
            cards={data.cards.filter((c) => c.set === s.key)}
            onOpen={setOpen}
            onClaim={() => claim(s.key)}
            onShowCode={() => s.claimed && setPrize({ set: s.key, code: s.claimed.code })}
            claiming={claiming}
          />
        ))}
      </div>
      {data.incoming.length === 0 && trades}

      <CharacterSheet
        card={card}
        coins={coins}
        canTrade={data.mates.length > 0}
        onClose={() => setOpen(null)}
        onOpenBox={openBox}
        onTrade={(key) => {
          setOpen(null);
          setTrade({ give: key });
        }}
      />
      <TradeSheet
        open={!!trade}
        initialGive={trade?.give ?? null}
        data={data}
        onClose={() => setTrade(null)}
        onSent={(to) => {
          setTrade(null);
          toast.show({ title: 'Offer sent', detail: `${to} can accept or decline it for ${OFFER_DAYS} days.`, tone: 'accent' });
          router.refresh();
        }}
      />
      <PrizeSheet prize={prize} onClose={() => setPrize(null)} />
      <OddsSheet open={odds} onClose={() => setOdds(false)} cards={data.cards} />
      <BoxOpening
        opening={opening}
        coins={coins}
        onAgain={() => opening && openBox(opening.set)}
        onClose={() => {
          setOpening(null);
          router.refresh();
        }}
        onCollection={() => {
          setOpening(null);
          router.refresh();
          requestAnimationFrame(() => document.querySelector('[data-tour="collectables"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
        }}
      />
    </div>
  );
}

// ───────────────────────────────────────────── a set

function SetSection({
  set, cards, onOpen, onClaim, onShowCode, claiming,
}: {
  set: SetView;
  cards: CollectableCard[];
  onOpen: (key: string) => void;
  onClaim: () => void;
  onShowCode: () => void;
  claiming: boolean;
}) {
  const p = set.progress;
  return (
    <section aria-labelledby={`set-${set.key}`}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="label-mono">{set.theme}</p>
          <h2 id={`set-${set.key}`} className="mt-0.5 text-[20px] font-semibold tracking-[-0.02em] text-ink">
            {set.name}
          </h2>
        </div>
        <p className="text-[14px] text-ink-3 tnum">
          <span className="font-semibold text-ink">{p.owned}</span> of {p.total}
        </p>
      </div>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {cards.map((c) => (
          <Tile key={c.key} c={c} onOpen={onOpen} />
        ))}
      </ul>

      <div data-tour={set.key === 'gym' ? 'set-prize' : undefined} className="mt-3 flex items-center gap-3 rounded-[14px] bg-sunken px-4 py-3">
        <Trophy size={22} weight="fill" className="shrink-0 text-[oklch(0.8_0.14_85)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-ink">{set.claimed ? 'Prize claimed' : 'Collect all five'}</p>
          <p className="text-[13px] leading-5 text-ink-3">{set.prize}</p>
          {!set.claimed && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden>
              <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(p.owned / p.total) * 100}%` }} />
            </div>
          )}
        </div>
        {set.claimed ? (
          <Button size="sm" variant="secondary" onClick={onShowCode}>
            Your code
          </Button>
        ) : p.canClaim ? (
          <Button size="sm" onClick={onClaim} loading={claiming}>
            Claim prize
          </Button>
        ) : null}
      </div>
      {p.complete && !p.canClaim && !set.claimed && <p className="mt-2 text-[13px] text-ink-3">{p.blocker}</p>}
    </section>
  );
}

function Tile({ c, onOpen }: { c: CollectableCard; onOpen: (key: string) => void }) {
  const state = stateOf(c);
  const label = state === 'owned' ? `${c.name}, ${RARITY_LABEL[c.rarity]}, you own ${c.copies}` : `${c.name ?? 'A secret character'}, ${RARITY_LABEL[c.rarity]}, not found yet`;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(c.key)}
        style={rarityStyle(c.rarity)}
        aria-label={label}
        className={cn(
          'pressable relative block w-full overflow-hidden rounded-[14px] border-2 bg-surface text-left',
          state === 'owned' ? 'border-[var(--r)]' : 'border-line border-dashed hover:border-line-strong',
          state === 'owned' && (c.rarity === 'epic' || c.rarity === 'legendary' || c.rarity === 'secret') && 'lu-glow',
        )}
      >
        <CharacterArt c={c} state={state} />
        {c.copies > 1 && (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white">×{c.copies}</span>
        )}
        <span className="block px-2 pt-1.5 pb-2">
          <span className={cn('block truncate text-[13px] font-semibold', state === 'owned' ? 'text-ink' : 'text-ink-3')}>{c.name ?? '???'}</span>
          <span className="mt-1 block">
            <RarityChip rarity={c.rarity} className="px-1.5" />
          </span>
        </span>
      </button>
    </li>
  );
}

// ───────────────────────────────────────────── one character up close

function CharacterSheet({
  card, coins, canTrade, onClose, onOpenBox, onTrade,
}: {
  card: CollectableCard | null;
  coins: number;
  canTrade: boolean;
  onClose: () => void;
  onOpenBox: (set: SetKey) => void;
  onTrade: (key: string) => void;
}) {
  const [taps, setTaps] = useState(0);
  useEffect(() => setTaps(0), [card?.key]);
  const state = card ? stateOf(card) : 'missing';
  const set = card ? SET_BY_KEY.get(card.set)! : null;
  const title = card ? (card.name ?? 'Secret') : 'Collectable';
  return (
    <Sheet open={!!card} onClose={onClose} title={title} size="sm">
      {card && set && (
        <div className="flex flex-col gap-4 pt-1">
          {state === 'owned' ? (
            <button
              type="button"
              onClick={() => setTaps((t) => t + 1)}
              style={rarityStyle(card.rarity)}
              aria-label={`${card.name}. Tap to make them react.`}
              className={cn('relative block overflow-hidden rounded-[18px] border-2 border-[var(--r)]', card.rarity !== 'common' && card.rarity !== 'uncommon' && 'lu-glow')}
            >
              <CharacterArt c={card} state="owned" hero burst={taps} />
            </button>
          ) : (
            <div className="relative overflow-hidden rounded-[18px] border-2 border-dashed border-line">
              <CharacterArt c={card} state="missing" hero />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <RarityChip rarity={card.rarity} />
            <span className="label-mono">{set.name}</span>
          </div>
          {card.tagline ? (
            <p className="text-[15px] leading-6 text-ink-2">{card.tagline}</p>
          ) : (
            <p className="text-[15px] leading-6 text-ink-2">Nobody knows what this one looks like until they pull it.</p>
          )}

          <div className="rounded-[14px] border border-line px-4 py-3 text-[14px] leading-6 text-ink-2">
            {card.copies > 0 ? (
              <p>
                You own {card.copies}
                {card.opened < card.copies ? ` (${card.copies - card.opened} traded in)` : ''}. {card.copies > 1 ? `${card.copies - 1} spare to trade.` : 'Pull it again to have a spare to trade.'}
              </p>
            ) : (
              <p>
                Not found yet. It comes out of the {set.box.name}: {oddsLabel(card.rarity)} of boxes are {RARITY_LABEL[card.rarity]}.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Button size="lg" block onClick={() => onOpenBox(card.set)} disabled={coins < set.box.cost} variant={coins < set.box.cost ? 'secondary' : 'primary'}>
              {coins < set.box.cost ? (
                `${formatCoins(set.box.cost - coins)} more LevelCoins for a box`
              ) : (
                <>
                  Open {/^[AEIOU]/i.test(set.box.name) ? 'an' : 'a'} {set.box.name} · {formatCoins(set.box.cost)} <LevelCoin size={16} />
                </>
              )}
            </Button>
            {card.copies > 0 && canTrade && (
              <Button size="lg" block variant="outline" onClick={() => onTrade(card.key)}>
                <ArrowsLeftRight size={17} /> Trade {card.copies > 1 ? 'a spare' : 'it'}
              </Button>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function OddsSheet({ open, onClose, cards }: { open: boolean; onClose: () => void; cards: CollectableCard[] }) {
  return (
    <Sheet open={open} onClose={onClose} title="What’s in a box" description="Every box holds one character from its theme. The server rolls it; nothing is decided on your phone.">
      <div className="flex flex-col gap-4 pt-1">
        <ul className="divide-y divide-line rounded-[14px] border border-line px-4">
          {RARITIES.map((r) => (
            <li key={r} className="flex items-center justify-between gap-3 py-2.5 text-[15px]">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="size-3 shrink-0 rounded-full" style={{ background: RARITY_COLOR[r] }} />
                <span className="text-ink">{RARITY_LABEL[r]}</span>
                <span className="truncate text-[13px] text-ink-3">
                  {cards
                    .filter((c) => c.rarity === r)
                    .map((c) => c.name ?? '???')
                    .join(' · ')}
                </span>
              </span>
              <span className="shrink-0 text-ink-2 tnum">{oddsLabel(r)}</span>
            </li>
          ))}
        </ul>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-6 text-ink-2">
          <li>
            <b className="text-ink">Never too unlucky:</b> after {PITY - 1} boxes of a theme without a Legendary or Secret, the next one is one.
          </li>
          <li>
            <b className="text-ink">Spares</b> are extra copies. Trade them with anyone in your groups.
          </li>
          <li>
            <b className="text-ink">Prizes:</b> own all five of a set, with at least {SELF_OPENED_FOR_PRIZE} from your own boxes.
          </li>
        </ul>
        <p className="text-[12px] text-ink-3">LevelCoins only come from finished quests. Boxes can’t be bought with real money.</p>
      </div>
    </Sheet>
  );
}

// ───────────────────────────────────────────── trades

function Mini({ k, className }: { k: string; className?: string }) {
  const c = CHARACTER_BY_KEY.get(k);
  if (!c) return null;
  return (
    <span style={rarityStyle(c.rarity)} className={cn('block size-12 shrink-0 overflow-hidden rounded-[10px] border-2 border-[var(--r)]', className)}>
      <CharacterArt c={c} state="preview" />
    </span>
  );
}

function Trades({ data, onTrade, onChanged }: { data: CollectablesPage; onTrade: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const act = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(id);
    const r = await fn();
    setBusy(null);
    if (!r.ok) toast.show({ title: r.error ?? 'That didn’t work.', tone: 'error' });
    else toast.show({ title: done, tone: 'accent' });
    onChanged();
  };
  return (
    <section aria-labelledby="trades-h" data-tour="trades">
      <h2 id="trades-h" className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
        Trades
      </h2>
      <p className="mt-1 mb-3 text-[14px] leading-5 text-ink-3">Swap one of yours for one of theirs with anyone in your groups. Extra copies are your spares.</p>

      {(data.incoming.length > 0 || data.outgoing.length > 0) && (
        <ul className="mb-3 flex flex-col gap-2">
          {data.incoming.map((t) => (
            <TradeRow key={t.id} t={t}>
              <Button size="sm" onClick={() => act(t.id, () => respondTradeAction(t.id, true), `Traded: ${nameOf(t.youGet)} is yours`)} loading={busy === t.id}>
                Accept
              </Button>
              <Button size="sm" variant="ghost" onClick={() => act(t.id, () => respondTradeAction(t.id, false), 'Offer declined')} disabled={busy === t.id}>
                Decline
              </Button>
            </TradeRow>
          ))}
          {data.outgoing.map((t) => (
            <TradeRow key={t.id} t={t}>
              <Button size="sm" variant="ghost" onClick={() => act(t.id, () => cancelTradeAction(t.id), 'Offer cancelled')} loading={busy === t.id}>
                Cancel
              </Button>
            </TradeRow>
          ))}
        </ul>
      )}

      <Button block variant="outline" onClick={onTrade} disabled={!data.mates.length}>
        <ArrowsLeftRight size={17} /> Trade with a friend
      </Button>
      {!data.mates.length && <p className="mt-2 text-[13px] text-ink-3">Join or start a group in Groups to trade with friends.</p>}

      {data.history.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[13px] font-medium text-ink-3 hover:text-ink-2">Past trades</summary>
          <ul className="mt-2 flex flex-col gap-1.5 text-[13px] text-ink-3">
            {data.history.map((t) => (
              <li key={t.id}>
                {t.direction === 'out'
                  ? `You offered ${t.other.name} ${nameOf(t.youGive)} for ${nameOf(t.youGet)}`
                  : `${t.other.name} offered you ${nameOf(t.youGet)} for ${nameOf(t.youGive)}`}{' '}
                · {STATUS_LABEL[t.status]}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function TradeRow({ t, children }: { t: TradeView; children: React.ReactNode }) {
  const until = new Date(new Date(t.createdAt).getTime() + OFFER_DAYS * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-[16px] border border-line p-3">
      <span className="flex items-center gap-1.5" aria-hidden>
        <Mini k={t.youGive} />
        <ArrowsLeftRight size={16} className="text-ink-3" />
        <Mini k={t.youGet} />
      </span>
      <span className="min-w-[10rem] flex-1">
        <span className="block text-[14px] leading-5 text-ink">
          {t.direction === 'in' ? (
            <>
              <b className="font-semibold">{t.other.name}</b> offers {nameOf(t.youGet)} for your {nameOf(t.youGive)}
            </>
          ) : (
            <>
              You offered {nameOf(t.youGive)} to <b className="font-semibold">{t.other.name}</b> for {nameOf(t.youGet)}
            </>
          )}
        </span>
        <span className="block text-[12px] text-ink-3">Open until {until}</span>
      </span>
      <span className="flex items-center gap-1.5">{children}</span>
    </li>
  );
}

function TradeSheet({
  open, initialGive, data, onClose, onSent,
}: {
  open: boolean;
  initialGive: string | null;
  data: CollectablesPage;
  onClose: () => void;
  onSent: (toName: string) => void;
}) {
  const [mate, setMate] = useState<string | null>(null);
  const [give, setGive] = useState<string | null>(null);
  const [get, setGet] = useState<string | null>(null);
  const [theirs, setTheirs] = useState<{ key: string; copies: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setGive(initialGive);
    setGet(null);
    setError(null);
    setMate(data.mates.length === 1 ? data.mates[0].id : null);
  }, [open, initialGive, data.mates]);

  useEffect(() => {
    if (!mate) return;
    let live = true;
    setTheirs(null);
    setGet(null);
    mateCollectionAction(mate).then((rows) => live && setTheirs(rows));
    return () => {
      live = false;
    };
  }, [mate]);

  const mine = data.cards.filter((c) => c.copies > 0);
  const mateName = data.mates.find((m) => m.id === mate)?.name ?? '';
  const giving = mine.find((c) => c.key === give);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Trade with a friend"
      description="One of yours for one of theirs. They can accept or decline."
      footer={
        <Button
          size="lg"
          block
          loading={pending}
          disabled={!mate || !give || !get}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await offerTradeAction({ to: mate!, give: give!, get: get! });
              if (!r.ok) return setError(r.error);
              onSent(mateName);
            })
          }
        >
          Send offer
        </Button>
      }
    >
      <div className="flex flex-col gap-5 pt-1">
        <fieldset>
          <legend className="label-mono mb-2">1 · Who</legend>
          <div className="flex flex-wrap gap-2">
            {data.mates.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={mate === m.id}
                onClick={() => setMate(m.id)}
                className={cn(
                  'pressable h-10 rounded-full border px-4 text-[14px] font-medium',
                  mate === m.id ? 'border-transparent bg-accent text-accent-ink' : 'border-line-strong text-ink-2 hover:bg-sunken',
                )}
              >
                {m.name}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="label-mono mb-2">2 · You give</legend>
          {mine.length ? (
            <PickGrid items={mine.map((c) => ({ key: c.key, copies: c.copies }))} value={give} onChange={setGive} />
          ) : (
            <p className="text-[14px] text-ink-3">You don’t own any collectables yet. Open a box first.</p>
          )}
          {giving && giving.copies === 1 && <p className="mt-2 text-[13px] text-ink-3">That’s your only {giving.name}. You’ll have none left if they accept.</p>}
        </fieldset>

        <fieldset disabled={!mate}>
          <legend className="label-mono mb-2">3 · You get</legend>
          {!mate ? (
            <p className="text-[14px] text-ink-3">Pick a friend to see what they have.</p>
          ) : theirs === null ? (
            <p className="text-[14px] text-ink-3">Loading {mateName}’s collection…</p>
          ) : theirs.length ? (
            <PickGrid items={theirs.filter((t) => t.key !== give)} value={get} onChange={setGet} />
          ) : (
            <p className="text-[14px] text-ink-3">{mateName} doesn’t own any collectables yet.</p>
          )}
        </fieldset>

        {error && (
          <p className="text-[13px] text-bad" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function PickGrid({ items, value, onChange }: { items: { key: string; copies: number }[]; value: string | null; onChange: (k: string) => void }) {
  return (
    <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5">
      {items.map((it) => {
        const c = CHARACTER_BY_KEY.get(it.key);
        if (!c) return null;
        const on = value === it.key;
        return (
          <li key={it.key}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onChange(it.key)}
              style={rarityStyle(c.rarity)}
              className={cn(
                'pressable relative block w-full overflow-hidden rounded-[12px] border-2 text-left',
                on ? 'border-accent ring-2 ring-accent/40' : 'border-line hover:border-line-strong',
              )}
            >
              <CharacterArt c={c} state="preview" />
              <span className="block truncate px-1.5 py-1 text-[11px] font-medium text-ink">
                {c.name}
                {it.copies > 1 ? ` ×${it.copies}` : ''}
              </span>
              {on && (
                <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-accent text-accent-ink" aria-hidden>
                  <Check size={12} weight="bold" />
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ───────────────────────────────────────────── the prize

function PrizeSheet({ prize, onClose }: { prize: { set: SetKey; code: string } | null; onClose: () => void }) {
  const set = prize ? SET_BY_KEY.get(prize.set) : null;
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [prize?.code]);
  return (
    <Sheet open={!!prize} onClose={onClose} title="Prize unlocked" size="sm">
      {prize && set && (
        <div className="flex flex-col items-center gap-4 pt-1 text-center">
          <Trophy size={44} weight="fill" className="text-[oklch(0.8_0.14_85)]" aria-hidden />
          <p className="text-[15px] leading-6 text-ink-2">
            {set.name} complete. Your prize: <span className="text-ink">{set.prize.toLowerCase()}</span>.
          </p>
          <p className="rounded-[12px] border border-dashed border-line-strong px-5 py-3 font-mono text-[22px] tracking-[0.12em] text-ink select-all">{prize.code}</p>
          <p className="text-[13px] text-ink-3">Keep this code. You’ll need it to receive the prize.</p>
          <Button
            variant="outline"
            onClick={() =>
              navigator.clipboard?.writeText(prize.code).then(
                () => setCopied(true),
                () => setCopied(false),
              )
            }
          >
            {copied ? <Check size={16} weight="bold" /> : <CopyIcon size={16} />} {copied ? 'Copied' : 'Copy code'}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
