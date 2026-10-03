import { cn } from '@/lib/cn';
import type { RingSegment } from '@/lib/server/today';

/**
 * Small, dependency-free progress marks. State is always carried by SHAPE as well as colour
 * (filled / half / arc / slashed / dashed), so none of it relies on colour vision.
 */

// ───────────────────────────────────────────── day ring

const SEG_STYLE: Record<RingSegment, { stroke: string; opacity: number; dash?: string }> = {
  exceeded: { stroke: 'var(--accent)', opacity: 1 },
  full: { stroke: 'var(--accent)', opacity: 1 },
  minimum: { stroke: 'var(--accent)', opacity: 0.55 },
  partial: { stroke: 'var(--accent)', opacity: 0.28 },
  missed: { stroke: 'var(--bad)', opacity: 0.6 },
  excused: { stroke: 'var(--text-3)', opacity: 0.5, dash: '2 3' },
  open: { stroke: 'var(--line-2)', opacity: 1 },
};

export function DayRing({ segments, size = 132, stroke = 9, className }: { segments: RingSegment[]; size?: number; stroke?: number; className?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const n = Math.max(1, segments.length);
  const gap = n > 1 ? Math.min(10, (c / n) * 0.28) : 0;
  const len = c / n - gap;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn('-rotate-90', className)} aria-hidden>
      {segments.length === 0 && (
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-2)" strokeWidth={stroke} />
      )}
      {segments.map((s, i) => {
        const st = SEG_STYLE[s];
        return (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={st.stroke}
            strokeOpacity={st.opacity}
            strokeWidth={stroke}
            strokeLinecap={n > 1 ? 'butt' : 'round'}
            strokeDasharray={`${Math.max(0.5, len)} ${c - Math.max(0.5, len)}`}
            strokeDashoffset={-i * (len + gap)}
            style={{ transition: 'stroke 300ms ease, stroke-opacity 300ms ease' }}
          />
        );
      })}
    </svg>
  );
}

// ───────────────────────────────────────────── weekly quota pips

export function Pips({ done, total, className }: { done: number; total: number; className?: string }) {
  const n = Math.min(total, 10);
  return (
    <span className={cn('inline-flex items-center gap-[3px]', className)} role="img" aria-label={`${done} of ${total} this week`}>
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className={cn('h-1.5 w-3 rounded-full transition-colors duration-300', i < done ? 'bg-accent' : 'bg-line-strong')}
        />
      ))}
    </span>
  );
}

// ───────────────────────────────────────────── meter with previous-period tick

export function Meter({ value, previous, className, tone = 'accent', label }: { value: number | null; previous?: number | null; className?: string; tone?: 'accent' | 'ink' | 'warn' | 'bad'; label?: string }) {
  const v = Math.max(0, Math.min(1, value ?? 0));
  const p = previous == null ? null : Math.max(0, Math.min(1, previous));
  const fill = { accent: 'bg-accent', ink: 'bg-ink-2', warn: 'bg-warn', bad: 'bg-bad' }[tone];
  return (
    <div className={cn('relative h-1.5 w-full rounded-full bg-sunken', className)} role={label ? 'img' : undefined} aria-label={label}>
      <div className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-[var(--ease-out)]', fill)} style={{ width: `${v * 100}%` }} />
      {p != null && (
        <div className="absolute -top-1 -bottom-1 w-[2px] rounded-full bg-ink-2" style={{ left: `calc(${p * 100}% - 1px)` }} title="Previous period" />
      )}
    </div>
  );
}

// ───────────────────────────────────────────── sparkline

export function Sparkline({
  values,
  width = 96,
  height = 28,
  className,
  domain,
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  className?: string;
  domain?: [number, number];
}) {
  const pts = values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v != null);
  if (pts.length < 2) return <div style={{ width, height }} className={className} />;
  const lo = domain?.[0] ?? Math.min(...pts.map((p) => p.v));
  const hi = domain?.[1] ?? Math.max(...pts.map((p) => p.v));
  const span = hi - lo || 1;
  const pad = 4;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <path d={d} fill="none" stroke="var(--text-3)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={3.5} fill="var(--accent)" stroke="var(--surface-1)" strokeWidth={2} />
    </svg>
  );
}

// ───────────────────────────────────────────── delta badge

/**
 * Signed change vs a named period. Colour = direction × whether up is good; the arrow and sign
 * carry the same meaning without colour.
 */
export function Delta({
  value,
  kind = 'pp',
  upIsGood = true,
  className,
  vs,
}: {
  value: number | null;
  kind?: 'pp' | 'pct' | 'abs' | 'pts';
  upIsGood?: boolean;
  className?: string;
  vs?: string;
}) {
  if (value == null || !Number.isFinite(value)) return <span className={cn('text-xs text-ink-3', className)}>—</span>;
  const rounded = kind === 'pct' ? Math.round(value * 1000) / 10 : Math.round(value * 10) / 10;
  const flat = Math.abs(rounded) < (kind === 'pct' ? 0.5 : 0.5);
  const up = rounded > 0;
  const good = flat ? null : up === upIsGood;
  const text =
    kind === 'pp' ? `${Math.abs(rounded).toFixed(Math.abs(rounded) < 10 ? 1 : 0)}pp`
    : kind === 'pct' ? `${Math.abs(rounded).toFixed(Math.abs(rounded) < 10 ? 1 : 0)}%`
    : kind === 'pts' ? `${Math.abs(Math.round(rounded))}`
    : `${Math.abs(rounded)}`;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium tnum',
        good == null ? 'text-ink-3' : good ? 'text-good' : 'text-bad',
        className,
      )}
    >
      <span aria-hidden>{flat ? '→' : up ? '↑' : '↓'}</span>
      <span className="sr-only">{flat ? 'unchanged' : up ? 'up' : 'down'}</span>
      {flat ? 'flat' : text}
      {vs && <span className="ml-1 font-normal text-ink-3">{vs}</span>}
    </span>
  );
}

// ───────────────────────────────────────────── level ring

export function LevelRing({ level, progress, size = 44, stroke = 3 }: { level: number; progress: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0.01, progress) * c} ${c}`}
          style={{ transition: 'stroke-dasharray 600ms var(--ease-out)' }}
        />
      </svg>
      <span className="relative font-semibold leading-none text-ink" style={{ fontSize: size * 0.36 }}>
        {level}
      </span>
    </span>
  );
}

// ───────────────────────────────────────────── keystone glyph (a trapezoid — the stone that locks an arch)

export function KeystoneGlyph({ size = 16, className, filled }: { size?: number; className?: string; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden>
      <path
        d="M2.5 2.5h11l-2.6 11h-5.8z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The LevelUp mark: three bars, each a level higher than the last. */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="2.5" y="13.5" width="5.5" height="8" rx="1.6" fill="var(--accent)" opacity="0.45" />
      <rect x="9.25" y="8.5" width="5.5" height="13" rx="1.6" fill="var(--accent)" opacity="0.72" />
      <rect x="16" y="2.5" width="5.5" height="19" rx="1.6" fill="var(--accent)" />
    </svg>
  );
}
