'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/cn';
import { CHARACTER_BY_KEY, RARITY_LABEL, SET_BY_KEY, type Rarity, type SetKey } from '@/lib/engine/collectables';
import type { Pull } from '@/lib/server/collectables';
import { Button } from '@/components/ui/primitives';
import { Bill, Chalk, CharacterArt, RARITY_COLOR, RarityChip, rarityStyle } from './character-art';
import { LevelCoin, formatCoins } from './level-coin';

export interface Opening {
  /** a new number for every box, so the animation starts over */
  nonce: number;
  set: SetKey;
  /** null while the server is rolling */
  pull: Pull | null;
}

type Phase = 'arrive' | 'ready' | 'charge' | 'burst' | 'reveal';

/** The rarer the pull, the longer the box fights back. */
const CHARGE_MS: Record<Rarity, number> = { common: 850, uncommon: 1050, epic: 1500, legendary: 2050, secret: 2700 };
const BOX_ART: Record<SetKey, string> = { gym: '/collectables/boxes/iron_crate.webp', finance: '/collectables/boxes/cash_case.webp' };
const NEUTRAL = '#efe9dc';
/** the glow behind the box, in colours the animation engine can blend */
const GLOW: Record<Rarity, string> = { common: '#c3c6cd', uncommon: '#5fd08a', epic: '#b07cf2', legendary: '#f5c451', secret: '#e8bf5c' };

/**
 * Opening a box, full screen: it drops in, you tap it, it shakes harder the rarer the pull while
 * the glow behind it gives the rarity away, then it bursts into chalk or cash and the character
 * flips in. Secrets fake a Legendary glow, then glitch to black and gold.
 */
export function BoxOpening({
  opening, coins, onAgain, onClose, onCollection,
}: {
  opening: Opening | null;
  coins: number;
  onAgain: () => void;
  onClose: () => void;
  onCollection: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const boxBtn = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('arrive');
  const [tapped, setTapped] = useState(false);
  const pull = opening?.pull ?? null;
  const set = opening ? SET_BY_KEY.get(opening.set)! : null;

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (opening && !d.open) d.showModal();
    if (!opening && d.open) d.close();
  }, [opening]);

  // every new box starts from the top
  useEffect(() => {
    if (!opening) return;
    setPhase('arrive');
    setTapped(false);
    const t = setTimeout(() => setPhase('ready'), reduce ? 50 : 650);
    return () => clearTimeout(t);
  }, [opening?.nonce, reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase === 'ready') boxBtn.current?.focus({ preventScroll: true });
  }, [phase]);

  // tap → charge → burst → reveal, once the server has answered. The timers belong to this box and
  // are only cleared when the next box starts (or the dialog goes away), never by a phase change.
  const started = useRef<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    if (!opening || !tapped || !pull || started.current === opening.nonce) return;
    started.current = opening.nonce;
    if (reduce) {
      setPhase('reveal');
      return;
    }
    setPhase('charge');
    timers.current.push(setTimeout(() => setPhase('burst'), CHARGE_MS[pull.rarity]));
    timers.current.push(setTimeout(() => setPhase('reveal'), CHARGE_MS[pull.rarity] + 420));
  }, [opening, tapped, pull, reduce]);
  useEffect(() => {
    const list = timers.current;
    return () => {
      list.forEach(clearTimeout);
      list.length = 0;
    };
  }, [opening?.nonce]);

  const rarity = pull?.rarity ?? 'common';
  const color = RARITY_COLOR[rarity];
  const high = rarity === 'epic' || rarity === 'legendary' || rarity === 'secret';
  const charge = CHARGE_MS[rarity] / 1000;
  const canAgain = !!set && coins >= set.box.cost;

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-label={set ? `Opening ${set.box.name}` : 'Opening a box'}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-hidden border-0 bg-[oklch(0.1_0.006_260/0.97)] p-0 text-ink backdrop:bg-black/80"
    >
      {opening && set && (
        <motion.div
          key={opening.nonce}
          className="relative mx-auto flex min-h-full w-full max-w-[520px] flex-col items-center justify-center gap-6 px-5 py-10"
          animate={phase === 'reveal' && rarity === 'secret' && !reduce ? { x: [0, -10, 9, -6, 4, 0] } : { x: 0 }}
          transition={{ duration: 0.45, delay: 0.15 }}
        >
          {/* the title line */}
          <div className="h-16 text-center" aria-live="polite">
            <AnimatePresence mode="wait">
              {phase !== 'reveal' ? (
                <motion.div key="box" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                  <p className="label-mono">{set.theme} box</p>
                  <p className="mt-1 text-[24px] font-semibold tracking-[-0.02em] text-ink">{set.box.name}</p>
                </motion.div>
              ) : (
                pull && (
                  <motion.div key="res" initial={{ opacity: 0, scale: reduce ? 1 : 1.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
                    <p className={cn('text-[30px] font-black uppercase tracking-[0.18em]', rarity === 'secret' && 'lu-secret-text')} style={{ color }}>
                      {RARITY_LABEL[rarity]}
                    </p>
                    <p className="text-[13px] text-ink-3">
                      {pull.isNew ? 'New for your collection' : `A spare · you have ${pull.copies}`}
                      {pull.pity ? ' · guaranteed by the pity counter' : ''}
                    </p>
                    <span className="sr-only">
                      You got {pull.name}, {RARITY_LABEL[rarity]}
                      {pull.isNew ? ', new' : ''}.
                    </span>
                  </motion.div>
                )
              )}
            </AnimatePresence>
          </div>

          {/* the stage */}
          <div className="relative grid aspect-square w-full max-w-[340px] place-items-center">
            {/* glow: neutral while waiting, gives the rarity away during the charge */}
            <motion.span
              aria-hidden
              className="absolute inset-[8%] rounded-full blur-[46px]"
              initial={{ opacity: 0.25, backgroundColor: NEUTRAL, scale: 0.7 }}
              animate={
                phase === 'charge'
                  ? rarity === 'secret'
                    ? { backgroundColor: [NEUTRAL, GLOW.legendary, GLOW.legendary, '#e0457b', '#161616', GLOW.secret], opacity: [0.3, 0.6, 0.75, 0.9, 0.6, 1], scale: [0.7, 0.95, 1.05, 1.15, 0.9, 1.3] }
                    : { backgroundColor: [NEUTRAL, NEUTRAL, GLOW[rarity]], opacity: [0.3, 0.5, high ? 0.95 : 0.7], scale: [0.7, 0.9, high ? 1.25 : 1] }
                  : phase === 'reveal' || phase === 'burst'
                    ? { backgroundColor: GLOW[rarity], opacity: high ? 0.75 : 0.45, scale: high ? 1.35 : 1.05 }
                    : { backgroundColor: NEUTRAL, opacity: [0.2, 0.32, 0.2], scale: 0.7 }
              }
              transition={phase === 'charge' ? { duration: charge, ease: 'easeIn' } : phase === 'ready' || phase === 'arrive' ? { duration: 2.4, repeat: Infinity } : { duration: 0.4 }}
            />
            {/* light rays for Epic and up */}
            {high && (phase === 'charge' || phase === 'burst' || phase === 'reveal') && !reduce && (
              <motion.span
                aria-hidden
                className="absolute inset-[-30%]"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: phase === 'charge' ? 0.35 : 0.6, scale: 1 }}
                transition={{ duration: phase === 'charge' ? charge : 0.5 }}
              >
                <span
                  className="lu-spin absolute inset-0 rounded-full"
                  style={{
                    background: `repeating-conic-gradient(from 0deg, ${color} 0deg 7deg, transparent 7deg 22deg)`,
                    maskImage: 'radial-gradient(circle, black 18%, transparent 68%)',
                    WebkitMaskImage: 'radial-gradient(circle, black 18%, transparent 68%)',
                  }}
                />
              </motion.span>
            )}

            {/* the box */}
            <AnimatePresence>
              {phase !== 'reveal' && (
                <motion.button
                  ref={boxBtn}
                  type="button"
                  onClick={() => setTapped(true)}
                  disabled={tapped}
                  aria-label={`Open the ${set.box.name}`}
                  className="relative z-10 w-[72%] cursor-pointer outline-offset-8 disabled:cursor-default"
                  initial={reduce ? { opacity: 0 } : { y: -160, scale: 0.55, opacity: 0, rotate: -8 }}
                  animate={
                    phase === 'charge'
                      ? {
                          y: 0,
                          opacity: 1,
                          scale: [1, 1.02, 1.04, 1.07, 1.1],
                          rotate: [0, -2, 2, -3, 3, -5, 5, -7, 7, -9, 9, -4, 0],
                          x: [0, -2, 2, -4, 4, -5, 5, -7, 7, -8, 8, -3, 0],
                        }
                      : phase === 'burst'
                        ? { scale: 1.6, opacity: 0, rotate: 0, y: 0, x: 0 }
                        : { y: 0, scale: 1, opacity: 1, rotate: 0, x: 0 }
                  }
                  exit={{ opacity: 0 }}
                  transition={
                    phase === 'charge'
                      ? { duration: charge, ease: 'easeIn' }
                      : phase === 'burst'
                        ? { duration: 0.32, ease: 'easeOut' }
                        : { type: 'spring', stiffness: 170, damping: 14 }
                  }
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={BOX_ART[opening.set]} alt="" draggable={false} className={cn('w-full select-none drop-shadow-[0_24px_30px_rgb(0_0_0/0.55)]', phase === 'ready' && !tapped && 'lu-float')} />
                </motion.button>
              )}
            </AnimatePresence>

            {/* burst: flash and debris */}
            {phase === 'burst' && !reduce && <Burst set={opening.set} color={color} rarity={rarity} />}

            {/* the pull */}
            {phase === 'reveal' && pull && (
              <motion.div
                className="relative z-10 w-[74%]"
                style={{ perspective: 900 }}
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.55, rotateY: 100 }}
                animate={{ opacity: 1, scale: 1, rotateY: 0 }}
                transition={{ type: 'spring', stiffness: 170, damping: 15 }}
              >
                <div
                  style={rarityStyle(rarity)}
                  className={cn(
                    'overflow-hidden rounded-[22px] border-[3px] border-[var(--r)] bg-surface shadow-[0_0_60px_-12px_var(--r)]',
                    high && 'lu-glow',
                  )}
                >
                  <CharacterArt c={{ key: pull.key, rarity, backdrop: CHARACTER_BY_KEY.get(pull.key)?.backdrop ?? '#D8CFBF', set: pull.set }} state="owned" hero burst={1} />
                  <div className="flex items-center justify-between gap-2 px-3.5 py-3">
                    <span className="truncate text-[18px] font-semibold text-ink">{pull.name}</span>
                    <RarityChip rarity={rarity} />
                  </div>
                </div>
                {pull.isNew && (
                  <motion.span
                    className="absolute -right-3 -top-3 rounded-full bg-accent px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-accent-ink shadow-lg"
                    initial={{ scale: 0, rotate: -20 }}
                    animate={{ scale: 1, rotate: 8 }}
                    transition={{ delay: 0.35, type: 'spring', stiffness: 400, damping: 12 }}
                  >
                    New
                  </motion.span>
                )}
                {rarity === 'secret' && !reduce && (
                  <motion.span
                    aria-hidden
                    className="pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 rounded-[8px] border-[3px] border-[oklch(0.82_0.13_75)] bg-black/80 px-4 py-1 font-mono text-[26px] font-black uppercase tracking-[0.2em] text-[oklch(0.86_0.13_80)]"
                    initial={{ scale: 3, opacity: 0, rotate: -14 }}
                    animate={{ scale: 1, opacity: [0, 1, 1, 0], rotate: -8 }}
                    transition={{ duration: 1.6, times: [0, 0.15, 0.75, 1], ease: 'easeOut' }}
                  >
                    Secret
                  </motion.span>
                )}
              </motion.div>
            )}
          </div>

          {/* what to do */}
          <div className="flex min-h-[132px] w-full max-w-[340px] flex-col items-center gap-2">
            <AnimatePresence mode="wait">
              {phase === 'ready' || phase === 'arrive' ? (
                <motion.p
                  key="tap"
                  className="text-[15px] font-medium text-ink-2"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.55, 1, 0.55], transition: { duration: 1.8, repeat: Infinity } }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                >
                  {tapped ? 'Opening…' : 'Tap the box to open it'}
                </motion.p>
              ) : phase === 'reveal' ? (
                <motion.div key="acts" className="flex w-full flex-col gap-2" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduce ? 0 : 0.45 }}>
                  {canAgain && (
                    <Button size="lg" block onClick={onAgain}>
                      Open another · {formatCoins(set.box.cost)} <LevelCoin size={16} />
                    </Button>
                  )}
                  <Button size="lg" block variant="secondary" onClick={onCollection}>
                    See my collection
                  </Button>
                  <Button size="lg" block variant="ghost" onClick={() => dialog.current?.close()}>
                    Done
                  </Button>
                </motion.div>
              ) : (
                <span key="gap" />
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </dialog>
  );
}


/** A white flash and a ring of debris: chalk or cash, plus confetti in the rarity colour. */
function Burst({ set, color, rarity }: { set: SetKey; color: string; rarity: Rarity }) {
  const pieces = useMemo(() => {
    const n = rarity === 'common' ? 16 : rarity === 'uncommon' ? 20 : 28;
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const d = 120 + Math.random() * 150;
      return { x: Math.cos(a) * d, y: Math.sin(a) * d - 20, r: (Math.random() - 0.5) * 540, kind: i % 3, s: 0.7 + Math.random() * 0.6 };
    });
  }, [rarity]);
  return (
    <>
      <motion.span
        aria-hidden
        className="pointer-events-none fixed inset-0 z-20 bg-white"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, rarity === 'secret' || rarity === 'legendary' ? 0.95 : 0.75, 0] }}
        transition={{ duration: 0.5, times: [0, 0.2, 1] }}
      />
      <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-30">
        {pieces.map((p, i) => (
          <motion.span
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            initial={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 0.4 }}
            animate={{ x: p.x, y: p.y + 60, rotate: p.r, opacity: 0, scale: p.s }}
            transition={{ duration: 1.1, ease: [0.15, 0.8, 0.3, 1] }}
          >
            {p.kind === 0 ? (
              set === 'finance' ? <Bill size={30} /> : <Chalk size={28} />
            ) : (
              <span className="block size-3 rounded-[2px] border-2 border-[#16211A]" style={{ background: p.kind === 1 ? color : rarity === 'secret' ? '#111' : '#F4F1EA' } as CSSProperties} />
            )}
          </motion.span>
        ))}
      </span>
    </>
  );
}
