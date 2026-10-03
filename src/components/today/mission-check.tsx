'use client';

import { cn } from '@/lib/cn';
import type { Outcome } from '@/lib/engine/types';

export type CheckState = Outcome | 'open' | 'overdue';

/**
 * The completion circle. Every state has its own SHAPE:
 *   open — hollow ring · full — filled + check · exceeded — filled + check + halo
 *   minimum — half-filled · partial — progress arc · missed — ring with a slash
 *   skipped (excused) — dashed ring · overdue — ring in the warning colour
 */
export function MissionCheck({ state, progress = 0, size = 28 }: { state: CheckState; progress?: number; size?: number }) {
  const r = size / 2 - 1.5;
  const c = 2 * Math.PI * r;
  const filled = state === 'full' || state === 'exceeded';
  return (
    <span className="relative grid place-items-center" style={{ width: size, height: size }} data-state={state}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="overflow-visible">
        {/* track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={state === 'overdue' ? 'var(--warn)' : filled ? 'var(--accent)' : 'var(--text-3)'}
          strokeOpacity={state === 'open' ? 0.75 : 1}
          strokeWidth={1.75}
          strokeDasharray={state === 'skipped' ? '3 3.2' : undefined}
          style={{ transition: 'stroke 200ms ease' }}
        />
        {/* halo for exceeded */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r + 3.5}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.25}
          className="transition-opacity duration-300"
          opacity={state === 'exceeded' ? 0.6 : 0}
        />
        {/* fill */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="var(--accent)"
          className="origin-center transition-[transform,opacity] duration-300 ease-[var(--ease-out)]"
          style={{ transform: filled ? 'scale(1)' : 'scale(0.4)', opacity: filled ? 1 : 0, transformBox: 'fill-box' }}
        />
        {/* minimum: half fill */}
        {state === 'minimum' && <path d={`M${size / 2},${size / 2 - r} A${r},${r} 0 0 0 ${size / 2},${size / 2 + r} Z`} fill="var(--accent)" />}
        {/* partial: arc */}
        {state === 'partial' && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r - 3.5}
            fill="none"
            stroke="var(--accent)"
            strokeOpacity={0.8}
            strokeWidth={3}
            strokeDasharray={`${Math.max(0.05, Math.min(0.95, progress)) * 2 * Math.PI * (r - 3.5)} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            strokeLinecap="round"
          />
        )}
        {/* missed: slash */}
        {state === 'missed' && <path d={`M${size * 0.3},${size * 0.7} L${size * 0.7},${size * 0.3}`} stroke="var(--text-3)" strokeWidth={1.75} strokeLinecap="round" />}
        {/* check */}
        <path
          d={`M${size * 0.3},${size * 0.52} L${size * 0.44},${size * 0.65} L${size * 0.71},${size * 0.37}`}
          fill="none"
          stroke="var(--accent-ink)"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          className={cn('check-path', filled && 'check-path-on')}
        />
      </svg>
      <style>{`
        .check-path { stroke-dasharray: 1; stroke-dashoffset: 1; transition: stroke-dashoffset 260ms var(--ease-out) 90ms; }
        .check-path-on { stroke-dashoffset: 0; }
      `}</style>
    </span>
  );
}
