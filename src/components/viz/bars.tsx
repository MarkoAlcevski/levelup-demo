import { cn } from '@/lib/cn';

/**
 * Small, honest charts shared by Gym, Learning and Money: one series, one axis, columns ≤ 24 px
 * with 2 px gaps, an optional target line, and a visually hidden table for screen readers.
 */
export function Bars({
  points,
  label,
  format = (n) => String(Math.round(n)),
  target,
  height = 120,
  className,
}: {
  points: { label: string; value: number; highlight?: boolean }[];
  label: string;
  format?: (n: number) => string;
  target?: number | null;
  height?: number;
  className?: string;
}) {
  const W = 320;
  const H = height;
  const padB = 18;
  const padT = 14;
  const max = Math.max(1, target ?? 0, ...points.map((p) => p.value));
  const slot = W / Math.max(1, points.length);
  const bar = Math.max(4, Math.min(24, slot - 2));
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  return (
    <figure className={cn('m-0', className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={label}>
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--line-2)" />
        {target != null && target > 0 && (
          <>
            <line x1={0} x2={W} y1={y(target)} y2={y(target)} stroke="var(--text-3)" strokeDasharray="3 3" />
            <text x={W} y={y(target) - 4} textAnchor="end" fontSize={9} className="fill-ink-3 font-mono">
              target {format(target)}
            </text>
          </>
        )}
        {points.map((p, i) => {
          const x = i * slot + (slot - bar) / 2;
          const top = y(p.value);
          const h = Math.max(0, y(0) - top);
          const r = Math.min(3, h, bar / 2);
          return (
            <g key={i}>
              {h > 0 && (
                <path
                  d={`M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + bar - r} Q${x + bar},${top} ${x + bar},${top + r} V${y(0)} Z`}
                  fill={p.highlight ? 'var(--accent)' : 'var(--text-3)'}
                  fillOpacity={p.highlight ? 1 : 0.55}
                />
              )}
              {(points.length <= 12 || i % Math.ceil(points.length / 12) === 0) && (
                <text x={i * slot + slot / 2} y={H - 4} textAnchor="middle" fontSize={9} className="fill-ink-3 font-mono">
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <th scope="row">{p.label}</th>
              <td>{format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A progression line (e.g. heaviest set per session) with dots and first/last labels. */
export function Line({
  points,
  label,
  format = (n) => String(n),
  height = 140,
}: {
  points: { label: string; value: number }[];
  label: string;
  format?: (n: number) => string;
  height?: number;
}) {
  if (points.length < 2) return <p className="text-sm text-ink-3">A trend appears after two sessions.</p>;
  const W = 320;
  const H = height;
  const pad = 16;
  const lo = Math.min(...points.map((p) => p.value));
  const hi = Math.max(...points.map((p) => p.value));
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (H - pad * 2 - 12);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={label}>
        <path d={d} fill="none" stroke="var(--text-3)" strokeWidth={1.5} strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 4 : 2.5} fill={i === points.length - 1 ? 'var(--accent)' : 'var(--text-3)'} />
        ))}
        <text x={x(0)} y={H - 2} fontSize={9} className="fill-ink-3 font-mono">
          {points[0].label}
        </text>
        <text x={x(points.length - 1)} y={H - 2} textAnchor="end" fontSize={9} className="fill-ink-3 font-mono">
          {last.label}
        </text>
        <text x={x(points.length - 1)} y={y(last.value) - 8} textAnchor="end" fontSize={10} className="fill-ink font-mono">
          {format(last.value)}
        </text>
      </svg>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <th scope="row">{p.label}</th>
              <td>{format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
