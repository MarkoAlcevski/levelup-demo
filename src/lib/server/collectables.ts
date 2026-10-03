import 'server-only';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { asSystem, asUser, type Queryable } from '@/lib/db';
import type { ISODate } from '@/lib/engine/dates';
import {
  CHARACTERS, CHARACTER_BY_KEY, MAX_OPEN_OFFERS, OFFER_DAYS, PITY, SETS, SET_BY_KEY,
  copyToGive, isCharacter, prizeCode, rollBox, setProgress, sinceHigh,
  type Copy, type Rarity, type SetKey, type SetProgress,
} from '@/lib/engine/collectables';
import type { Viewer } from './profile';
import { coinBalance } from './quests';
import { track } from './analytics';

/**
 * Boxes, the collection, trades and set prizes. Every write happens here as the trusted server,
 * after the checks a client could otherwise skip: the balance, the pity counter, and that both
 * sides of a trade are still in a group together and still own what they're swapping. Pulls use
 * real (crypto) randomness and are rolled only on the server.
 */

const cryptoRand = () => randomInt(0, 2 ** 32) / 2 ** 32;

export interface CollectableCard {
  key: string;
  set: SetKey;
  rarity: Rarity;
  /** a Secret character's name and art stay hidden until you own one */
  name: string | null;
  tagline: string | null;
  backdrop: string;
  copies: number;
  /** copies you pulled from your own boxes */
  opened: number;
}

export interface TradeView {
  id: string;
  /** you received this offer (in) or sent it (out) */
  direction: 'in' | 'out';
  other: { id: string; name: string };
  /** what you would give / get, from your side */
  youGive: string;
  youGet: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'failed' | 'expired';
  createdAt: string;
}

export interface SetView {
  key: SetKey;
  name: string;
  theme: string;
  prize: string;
  box: { name: string; cost: number; blurb: string };
  progress: SetProgress;
  claimed: { code: string; on: ISODate } | null;
  /** boxes of this theme until a Legendary or Secret is guaranteed */
  pityLeft: number;
  opened: number;
}

export interface CollectablesPage {
  coins: number;
  cards: CollectableCard[];
  sets: SetView[];
  mates: { id: string; name: string }[];
  incoming: TradeView[];
  outgoing: TradeView[];
  history: TradeView[];
}

async function matesOf(q: Queryable, userId: string): Promise<{ id: string; name: string }[]> {
  const rows = await q.query<{ user_id: string; display_name: string }>(
    `select distinct on (gm.user_id) gm.user_id, gm.display_name
       from group_members gm
      where gm.status = 'active' and gm.user_id <> $1
        and gm.group_id in (select group_id from group_members where user_id = $1 and status = 'active')
      order by gm.user_id, gm.joined_at`,
    [userId],
  );
  return rows.map((r) => ({ id: r.user_id, name: r.display_name })).sort((a, b) => a.name.localeCompare(b.name));
}

const expired = (createdAt: Date | string) => Date.now() - new Date(createdAt).getTime() > OFFER_DAYS * 86_400_000;

/** Rarities of every box this user opened for a theme, oldest first (traded copies keep their opener). */
async function pullHistory(q: Queryable, userId: string, set: SetKey): Promise<Rarity[]> {
  const keys = CHARACTERS.filter((c) => c.set === set).map((c) => c.key);
  const rows = await q.query<{ character_key: string }>(
    `select character_key from public.collectables where bought_by = $1 and character_key = any($2::text[]) order by bought_at, id`,
    [userId, keys],
  );
  return rows.map((r) => CHARACTER_BY_KEY.get(r.character_key)!.rarity);
}

export async function loadCollectables(viewer: Viewer): Promise<CollectablesPage> {
  const uid = viewer.userId;
  const history = await asSystem(async (q) => ({ gym: await pullHistory(q, uid, 'gym'), finance: await pullHistory(q, uid, 'finance') }));
  return asUser(uid, async (q) => {
    const [coins, copies, prizes, trades, mates] = await Promise.all([
      coinBalance(q),
      q.query<{ character_key: string; bought_by: string | null }>(`select character_key, bought_by from collectables where owner_id = $1`, [uid]),
      q.query<{ set_key: SetKey; code: string; claimed_at: Date }>(`select set_key, code, claimed_at from collectable_prizes`),
      q.query<{ id: string; from_user: string; to_user: string; give_key: string; get_key: string; status: TradeView['status']; created_at: Date }>(
        `select id, from_user, to_user, give_key, get_key, status, created_at from collectable_trades order by created_at desc limit 40`,
      ),
      matesOf(q, uid),
    ]);
    const mine: Copy[] = copies.map((c) => ({ character_key: c.character_key, mine: c.bought_by === uid }));
    const cards: CollectableCard[] = CHARACTERS.map((c) => {
      const n = mine.filter((x) => x.character_key === c.key).length;
      const hidden = c.rarity === 'secret' && n === 0;
      return {
        key: c.key, set: c.set, rarity: c.rarity, backdrop: c.backdrop,
        name: hidden ? null : c.name, tagline: hidden ? null : c.tagline,
        copies: n, opened: mine.filter((x) => x.character_key === c.key && x.mine).length,
      };
    });
    const sets: SetView[] = SETS.map((s) => {
      const p = prizes.find((x) => x.set_key === s.key);
      return {
        key: s.key, name: s.name, theme: s.theme, prize: s.prize, box: s.box,
        progress: setProgress(s.key, mine),
        claimed: p ? { code: p.code, on: new Date(p.claimed_at).toISOString().slice(0, 10) } : null,
        pityLeft: PITY - sinceHigh(history[s.key]),
        opened: history[s.key].length,
      };
    });
    const names = new Map(mates.map((m) => [m.id, m.name]));
    const views: TradeView[] = trades.map((t) => {
      const out = t.from_user === uid;
      const otherId = out ? t.to_user : t.from_user;
      return {
        id: t.id,
        direction: out ? 'out' : 'in',
        other: { id: otherId, name: names.get(otherId) ?? 'A former group mate' },
        youGive: out ? t.give_key : t.get_key,
        youGet: out ? t.get_key : t.give_key,
        status: t.status === 'pending' && expired(t.created_at) ? 'expired' : t.status,
        createdAt: new Date(t.created_at).toISOString(),
      };
    });
    return {
      coins,
      cards,
      sets,
      mates,
      incoming: views.filter((t) => t.status === 'pending' && t.direction === 'in'),
      outgoing: views.filter((t) => t.status === 'pending' && t.direction === 'out'),
      history: views.filter((t) => t.status !== 'pending').slice(0, 10),
    };
  });
}

/** A group mate's collection, for picking what to ask for in a trade. Empty for anyone else. */
export async function mateCollection(viewer: Viewer, mateId: string): Promise<{ key: string; copies: number }[]> {
  if (!z.uuid().safeParse(mateId).success) return [];
  const rows = await asUser(viewer.userId, (q) => q.query<{ character_key: string; copies: number }>(`select character_key, copies from public.mate_collectables($1)`, [mateId]));
  return rows.filter((r) => isCharacter(r.character_key)).map((r) => ({ key: r.character_key, copies: Number(r.copies) }));
}

type Fail = { ok: false; error: string };

export interface Pull {
  key: string;
  name: string;
  rarity: Rarity;
  set: SetKey;
  isNew: boolean;
  copies: number;
  /** the pity counter paid out */
  pity: boolean;
}

const openInput = z.object({ set: z.enum(['gym', 'finance']), boxId: z.uuid() });

/**
 * Open one box: check the balance, roll with crypto randomness (pity included), record the copy and
 * spend the LevelCoins, all in one transaction. A retry with the same box id returns the same pull
 * and never charges twice.
 */
export async function openBox(viewer: Viewer, raw: { set: SetKey; boxId: string }): Promise<{ ok: true; pull: Pull; coins: number } | Fail> {
  const parsed = openInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Invalid box.' };
  const { set, boxId } = parsed.data;
  const box = SET_BY_KEY.get(set)!.box;
  const uid = viewer.userId;
  const res = await asSystem(async (q) => {
    await q.query(`select pg_advisory_xact_lock(hashtext($1))`, [`coins:${uid}`]);
    const [already] = await q.query<{ character_key: string }>(`select character_key from public.collectables where purchase_id = $1 and bought_by = $2`, [boxId, uid]);
    let key: string;
    let pity = false;
    let fresh = false;
    if (already) key = already.character_key;
    else {
      const [{ bal }] = await q.query<{ bal: number }>(`select coalesce(sum(amount), 0)::int as bal from public.coin_events where user_id = $1`, [uid]);
      if (Number(bal) < box.cost) return { ok: false as const, error: `You need ${box.cost - Number(bal)} more LevelCoins. Finish a few quests.` };
      const since = sinceHigh(await pullHistory(q, uid, set));
      const c = rollBox(set, cryptoRand, since);
      pity = since >= PITY - 1;
      key = c.key;
      await q.query(`insert into public.collectables (owner_id, bought_by, character_key, purchase_id) values ($1, $1, $2, $3)`, [uid, key, boxId]);
      await q.query(`insert into public.coin_events (user_id, source, source_key, amount, occurred_on) values ($1, 'collectable', $2, $3, $4)`, [uid, boxId, -box.cost, viewer.today]);
      fresh = true;
    }
    const [{ bal }] = await q.query<{ bal: number }>(`select coalesce(sum(amount), 0)::int as bal from public.coin_events where user_id = $1`, [uid]);
    const [{ n }] = await q.query<{ n: number }>(`select count(*)::int as n from public.collectables where owner_id = $1 and character_key = $2`, [uid, key]);
    return { ok: true as const, key, pity, fresh, coins: Number(bal), copies: Number(n) };
  });
  if (!res.ok) return res;
  const c = CHARACTER_BY_KEY.get(res.key)!;
  if (res.fresh) void track(uid, 'box_opened', { set, rarity: c.rarity, pity: res.pity });
  return {
    ok: true,
    coins: res.coins,
    pull: { key: c.key, name: c.name, rarity: c.rarity, set: c.set, isNew: res.copies === 1, copies: res.copies, pity: res.pity },
  };
}

const offerInput = z.object({
  to: z.uuid(),
  give: z.string().refine(isCharacter, 'Pick what you give.'),
  get: z.string().refine(isCharacter, 'Pick what you want back.'),
});

export async function offerTrade(viewer: Viewer, raw: { to: string; give: string; get: string }): Promise<{ ok: true; id: string } | Fail> {
  const parsed = offerInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the trade.' };
  const { to, give, get } = parsed.data;
  if (give === get) return { ok: false, error: 'Swap two different characters.' };
  const uid = viewer.userId;
  const check = await asUser(uid, async (q) => {
    const [{ ok }] = await q.query<{ ok: boolean }>(`select public.shares_group($1) as ok`, [to]);
    if (!ok) return 'You can only trade with people in one of your groups.';
    const [{ n }] = await q.query<{ n: number }>(`select count(*)::int as n from collectables where owner_id = $1 and character_key = $2`, [uid, give]);
    if (!Number(n)) return `You don’t have ${CHARACTER_BY_KEY.get(give)!.name} to give.`;
    const theirs = await q.query<{ copies: number }>(`select copies from public.mate_collectables($1) where character_key = $2`, [to, get]);
    if (!Number(theirs[0]?.copies ?? 0)) return `They don’t have ${CHARACTER_BY_KEY.get(get)!.name} any more.`;
    return null;
  });
  if (check) return { ok: false, error: check };
  const res = await asSystem(async (q) => {
    const [{ open }] = await q.query<{ open: number }>(
      `select count(*)::int as open from public.collectable_trades where from_user = $1 and status = 'pending' and created_at > now() - make_interval(days => $2)`,
      [uid, OFFER_DAYS],
    );
    if (Number(open) >= MAX_OPEN_OFFERS) return { ok: false as const, error: `You have ${MAX_OPEN_OFFERS} offers waiting. Cancel one first.` };
    const [dup] = await q.query(
      `select 1 from public.collectable_trades where from_user = $1 and to_user = $2 and give_key = $3 and get_key = $4 and status = 'pending' and created_at > now() - make_interval(days => $5)`,
      [uid, to, give, get, OFFER_DAYS],
    );
    if (dup) return { ok: false as const, error: 'You already offered that trade.' };
    const [row] = await q.query<{ id: string }>(
      `insert into public.collectable_trades (from_user, to_user, give_key, get_key) values ($1, $2, $3, $4) returning id`,
      [uid, to, give, get],
    );
    return { ok: true as const, id: row.id };
  });
  if (res.ok) void track(uid, 'trade_offered', { give, get });
  return res;
}

export async function respondTrade(viewer: Viewer, id: string, accept: boolean): Promise<{ ok: true; accepted: boolean } | Fail> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: 'Invalid offer.' };
  const uid = viewer.userId;
  const res = await asSystem(async (q) => {
    const [t] = await q.query<{ id: string; from_user: string; give_key: string; get_key: string; status: string; created_at: Date }>(
      `select id, from_user, give_key, get_key, status, created_at from public.collectable_trades where id = $1 and to_user = $2 for update`,
      [id, uid],
    );
    if (!t || t.status !== 'pending') return { ok: false as const, error: 'This offer is no longer open.' };
    const fail = async (error: string) => {
      await q.query(`update public.collectable_trades set status = 'failed', decided_at = now() where id = $1`, [id]);
      return { ok: false as const, error };
    };
    if (expired(t.created_at)) return fail('This offer expired.');
    if (!accept) {
      await q.query(`update public.collectable_trades set status = 'declined', decided_at = now() where id = $1`, [id]);
      return { ok: true as const, accepted: false };
    }
    const [{ shared }] = await q.query<{ shared: boolean }>(
      `select exists (
         select 1 from public.group_members a join public.group_members b on b.group_id = a.group_id
          where a.user_id = $1 and a.status = 'active' and b.user_id = $2 and b.status = 'active'
       ) as shared`,
      [uid, t.from_user],
    );
    if (!shared) return fail('You’re no longer in a group together.');
    await q.query(`select pg_advisory_xact_lock(hashtext($1))`, [`trade:${[uid, t.from_user].sort().join(':')}`]);
    const copiesOf = (owner: string, key: string) =>
      q.query<{ id: string; mine: boolean; acquired: string }>(
        `select id, coalesce(bought_by = owner_id, false) as mine, acquired_at::text as acquired from public.collectables where owner_id = $1 and character_key = $2 for update`,
        [owner, key],
      );
    const theirCopy = copyToGive(await copiesOf(t.from_user, t.give_key));
    if (!theirCopy) return fail(`They no longer have ${CHARACTER_BY_KEY.get(t.give_key)?.name ?? 'that character'}.`);
    const myCopy = copyToGive(await copiesOf(uid, t.get_key));
    if (!myCopy) return fail(`You no longer have ${CHARACTER_BY_KEY.get(t.get_key)?.name ?? 'that character'}.`);
    await q.query(`update public.collectables set owner_id = $2, acquired_at = now() where id = $1`, [theirCopy.id, uid]);
    await q.query(`update public.collectables set owner_id = $2, acquired_at = now() where id = $1`, [myCopy.id, t.from_user]);
    await q.query(`update public.collectable_trades set status = 'accepted', decided_at = now() where id = $1`, [id]);
    return { ok: true as const, accepted: true };
  });
  if (res.ok && res.accepted) void track(uid, 'trade_accepted', {});
  return res;
}

export async function cancelTrade(viewer: Viewer, id: string): Promise<{ ok: true } | Fail> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: 'Invalid offer.' };
  const rows = await asSystem((q) =>
    q.query(`update public.collectable_trades set status = 'cancelled', decided_at = now() where id = $1 and from_user = $2 and status = 'pending' returning id`, [id, viewer.userId]),
  );
  return rows.length ? { ok: true } : { ok: false, error: 'This offer is no longer open.' };
}

export async function claimPrize(viewer: Viewer, set: string): Promise<{ ok: true; code: string } | Fail> {
  if (set !== 'gym' && set !== 'finance') return { ok: false, error: 'Unknown set.' };
  const uid = viewer.userId;
  const res = await asSystem(async (q) => {
    const [existing] = await q.query<{ code: string }>(`select code from public.collectable_prizes where user_id = $1 and set_key = $2`, [uid, set]);
    if (existing) return { ok: true as const, code: existing.code, fresh: false };
    const rows = await q.query<{ character_key: string; mine: boolean }>(
      `select character_key, coalesce(bought_by = owner_id, false) as mine from public.collectables where owner_id = $1`,
      [uid],
    );
    const p = setProgress(set, rows.map((r) => ({ character_key: r.character_key, mine: r.mine })));
    if (!p.canClaim) return { ok: false as const, error: p.blocker ?? 'This set isn’t complete yet.' };
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = prizeCode(set, (n) => randomInt(n));
      const [row] = await q.query<{ code: string }>(
        `insert into public.collectable_prizes (user_id, set_key, code) values ($1, $2, $3) on conflict (code) do nothing returning code`,
        [uid, set, code],
      );
      if (row) return { ok: true as const, code: row.code, fresh: true };
    }
    return { ok: false as const, error: 'Couldn’t make a prize code. Try again.' };
  });
  if (!res.ok) return res;
  if (res.fresh) void track(uid, 'prize_claimed', { set, prize: SET_BY_KEY.get(set)!.name });
  return { ok: true, code: res.code };
}
