'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ACCENT_UNLOCKS } from '@/lib/engine/xp';
import { KeystoneGlyph, LevelRing } from '@/components/viz/marks';

export type CelebrationEvent =
  | { kind: 'level'; from: number; to: number; xp: number }
  | { kind: 'keystone'; title: string; xp: number }
  | { kind: 'perfect-day'; kept: number };

/**
 * Rare moments get real ceremony; routine taps get a 300 ms tick. A level-up or a finished
 * Keystone takes the whole screen for a beat — tap anywhere (or Escape) to continue.
 */
export function Celebration({ event, onDone }: { event: CelebrationEvent | null; onDone: () => void }) {
  const [shown, setShown] = useState<CelebrationEvent | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!event) return;
    setShown(event);
    navigator.vibrate?.(event.kind === 'perfect-day' ? 15 : [12, 60, 18]);
    const t = setTimeout(() => closeBtn.current?.focus(), 50);
    const auto = event.kind === 'perfect-day' ? setTimeout(close, 2600) : null;
    return () => {
      clearTimeout(t);
      if (auto) clearTimeout(auto);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);

  function close() {
    setShown(null);
    onDone();
  }

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  const unlock = shown?.kind === 'level' ? ACCENT_UNLOCKS.find((u) => u.level > shown.from && u.level <= shown.to && u.level > 1) : null;

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key="celebrate"
          role="dialog"
          aria-modal="true"
          aria-label={shown.kind === 'level' ? `Level ${shown.to}` : shown.kind === 'keystone' ? 'Weekly focus done' : 'Perfect day'}
          className="fixed inset-0 z-[80] grid place-items-center bg-bg/90 px-6 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.18 } }}
          transition={{ duration: 0.25 }}
          onClick={close}
        >
          <Burst />
          <motion.div
            className="relative flex max-w-sm flex-col items-center text-center"
            initial={{ transform: 'scale(0.92) translateY(12px)', opacity: 0 }}
            animate={{ transform: 'scale(1) translateY(0px)', opacity: 1 }}
            transition={{ type: 'spring', duration: 0.6, bounce: 0.25 }}
          >
            {shown.kind === 'level' && (
              <>
                <p className="label-mono">Level up</p>
                <div className="my-6">
                  <LevelRing level={shown.to} progress={1} size={148} stroke={6} />
                </div>
                <h2 className="text-4xl font-semibold tracking-[-0.03em] text-ink">Level {shown.to}</h2>
                <p className="mt-2 text-ink-3">{shown.xp.toLocaleString('en-US')} points, all earned by doing what you said you would.</p>
                {unlock && (
                  <p className="mt-5 rounded-full border border-line-strong px-4 py-1.5 text-sm text-ink-2">
                    {unlock.name} accent unlocked — switch it on in Profile
                  </p>
                )}
              </>
            )}
            {shown.kind === 'keystone' && (
              <>
                <p className="label-mono">Weekly focus</p>
                <KeystoneGlyph size={96} filled className="my-7 text-accent" />
                <h2 className="text-3xl font-semibold tracking-[-0.03em] text-ink">{shown.title}</h2>
                <p className="mt-3 text-ink-3">The week’s one thing — done. +{shown.xp} points</p>
              </>
            )}
            {shown.kind === 'perfect-day' && (
              <>
                <p className="label-mono">Perfect day</p>
                <h2 className="mt-3 text-4xl font-semibold tracking-[-0.03em] text-ink">All {shown.kept} kept.</h2>
                <p className="mt-2 text-ink-3">+25 points</p>
              </>
            )}
            <button ref={closeBtn} type="button" onClick={close} className="pressable mt-10 h-11 rounded-full border border-line-strong px-6 text-sm font-medium text-ink-2 hover:text-ink">
              Continue
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A restrained burst: small accent squares (the evidence grid) fanning out once. */
function Burst() {
  const pieces = Array.from({ length: 22 }, (_, i) => {
    const angle = (i / 22) * Math.PI * 2 + (i % 2 ? 0.12 : -0.08);
    const dist = 140 + ((i * 37) % 90);
    return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, r: (i * 47) % 90, s: 5 + ((i * 13) % 6), d: (i % 5) * 0.02 };
  });
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className="absolute rounded-[2px] bg-accent"
          style={{ width: p.s, height: p.s }}
          initial={{ transform: 'translate(0px, 0px) rotate(0deg) scale(0.6)', opacity: 0 }}
          animate={{ transform: `translate(${p.x}px, ${p.y}px) rotate(${p.r}deg) scale(1)`, opacity: [0, 1, 0] }}
          transition={{ duration: 1.1, delay: 0.08 + p.d, ease: [0.23, 1, 0.32, 1] }}
        />
      ))}
    </div>
  );
}
