'use client';

import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { RARITY_LABEL, type Rarity, type SetKey } from '@/lib/engine/collectables';

/** One hue per rarity at matched lightness, so none shouts louder than its rank. Secret is gold on black. */
export const RARITY_COLOR: Record<Rarity, string> = {
  common: 'oklch(0.76 0.02 260)',
  uncommon: 'oklch(0.79 0.15 150)',
  epic: 'oklch(0.72 0.17 305)',
  legendary: 'oklch(0.85 0.15 85)',
  secret: 'oklch(0.82 0.13 75)',
};

export const rarityStyle = (r: Rarity) => ({ '--r': RARITY_COLOR[r] }) as CSSProperties;

export function RarityChip({ rarity, className }: { rarity: Rarity; className?: string }) {
  if (rarity === 'secret') {
    return (
      <span className={cn('lu-holo-chip inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[oklch(0.88_0.12_85)]', className)}>
        {RARITY_LABEL[rarity]}
      </span>
    );
  }
  return (
    <span
      style={rarityStyle(rarity)}
      className={cn('inline-flex items-center rounded-full bg-[var(--r)] px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-[oklch(0.2_0.02_260)]', className)}
    >
      {RARITY_LABEL[rarity]}
    </span>
  );
}

/** owned: alive · missing: a silhouette you still have to pull · preview: full colour, still (trades) */
export type ArtState = 'owned' | 'missing' | 'preview';

interface ArtProps {
  c: { key: string; rarity: Rarity; backdrop: string; set: SetKey };
  state: ArtState;
  /** the big version in a sheet: particles and a tap reaction */
  hero?: boolean;
  /** replay the reaction (after a pull or a trade) */
  burst?: number;
  className?: string;
}

/**
 * The character on its flat print backdrop. Owned characters are alive: they breathe, Epics glow,
 * Legendaries catch the light, Secrets shimmer like foil, and the big version gets its theme's
 * particles (chalk for the gym set, cash for the finance set). Missing ones are a silhouette.
 */
export function CharacterArt({ c, state, hero = false, burst = 0, className }: ArtProps) {
  const alive = state === 'owned';
  const missing = state === 'missing';
  return (
    <span
      className={cn('lu-art relative block aspect-square w-full overflow-hidden', className)}
      style={{ background: missing ? 'oklch(0.27 0.01 260)' : c.backdrop }}
      data-rarity={c.rarity}
    >
      {/* halftone print texture */}
      <span aria-hidden className="absolute inset-0 opacity-[0.12] [background-image:radial-gradient(oklch(0.2_0.01_260)_1px,transparent_1.3px)] [background-size:9px_9px]" />
      {hero && alive && <Particles set={c.set} key={`p${burst}`} />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={`i${burst}`}
        src={`/collectables/${c.key}.webp`}
        alt=""
        draggable={false}
        loading={hero ? 'eager' : 'lazy'}
        className={cn(
          'absolute inset-0 size-full select-none object-contain object-bottom',
          alive && 'lu-idle',
          alive && burst > 0 && 'lu-react',
          missing && 'brightness-0 opacity-55',
          missing && c.rarity === 'secret' && 'blur-[3px]',
        )}
        style={{ animationDelay: alive && !burst ? `${(c.key.length % 7) * -0.45}s` : undefined }}
      />
      {alive && (c.rarity === 'legendary' || c.rarity === 'secret') && <span aria-hidden className="lu-foil absolute inset-0" />}
      {alive && c.rarity === 'secret' && <span aria-hidden className="lu-holo absolute inset-0" />}
      {missing && c.rarity === 'secret' && (
        <span aria-hidden className={cn('absolute inset-0 grid place-items-center font-semibold text-[oklch(0.82_0.13_75)]', hero ? 'text-[64px]' : 'text-[30px]')}>
          ?
        </span>
      )}
    </span>
  );
}

const CHALK: [number, number, number][] = [
  [8, 13, 5.5],
  [15, 9, 6.5],
  [22, 13, 5.5],
  [15, 15, 5],
];

const PARTICLES = [
  { x: 12, d: 0, s: 1 },
  { x: 30, d: 1.6, s: 0.8 },
  { x: 52, d: 0.7, s: 1.1 },
  { x: 70, d: 2.3, s: 0.9 },
  { x: 86, d: 1.1, s: 1 },
  { x: 42, d: 3, s: 0.75 },
];

/** Chalk dust for the gym set, cash for the finance set, drifting up behind the character. */
function Particles({ set }: { set: SetKey }) {
  return (
    <span aria-hidden className="absolute inset-0">
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="lu-particle absolute bottom-0"
          style={{ left: `${p.x}%`, animationDelay: `${p.d}s`, '--s': p.s, '--r0': `${(i % 2 ? -1 : 1) * 12}deg`, '--r1': `${(i % 2 ? 1 : -1) * 28}deg` } as CSSProperties}
        >
          {set === 'finance' ? <Bill /> : <Chalk />}
        </span>
      ))}
    </span>
  );
}

export function Bill({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.54} viewBox="0 0 30 16">
      <rect x="1" y="1" width="28" height="14" rx="2" fill="#7BC47F" stroke="#16211A" strokeWidth="1.6" />
      <circle cx="15" cy="8" r="3.4" fill="none" stroke="#16211A" strokeWidth="1.3" />
    </svg>
  );
}

export function Chalk({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.74} viewBox="0 0 30 22">
      {/* a comic chalk puff: outlines first, fills on top, so only the outer edge shows */}
      {CHALK.map(([cx, cy, r], j) => (
        <circle key={`o${j}`} cx={cx} cy={cy} r={r + 1.6} fill="#1A1D21" />
      ))}
      {CHALK.map(([cx, cy, r], j) => (
        <circle key={`f${j}`} cx={cx} cy={cy} r={r} fill="#F4F1EA" />
      ))}
    </svg>
  );
}
