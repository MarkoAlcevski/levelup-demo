'use client';

import { useMemo, useState } from 'react';
import { formatDay } from '@/lib/engine/dates';

/**
 * Execution over time: one column per day (or week) + a 2px moving-average line.
 * Columns ≤ 24px with a 2px gap, 4px rounded tops, square at the baseline; hairline grid.
 * Hover/focus shows the exact value; a visually-hidden table carries every value too.
 */
export function TrendChart({
  points,
  unit = 'day',
  height = 168,
}: {
  points: { label: string; value: number | null; planned: number }[];
  unit?: 'day' | 'week';
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const padL = 30;
  const padB = 22;
  const padT = 8;
  const n = points.length;
  const slot = (W - padL) / Math.max(1, n);
  const bar = Math.min(24, Math.max(2, slot - 2));
  const y = (v: number) => padT + (1 - v) * (H - padT - padB);

  const avg = useMemo(() => {
    const k = unit === 'day' ? 7 : 4;
    return points.map((_, i) => {
      const win = points.slice(Math.max(0, i - k + 1), i + 1).filter((p) => p.value != null);
      if (win.length < Math.min(3, k)) return null;
      const due = win.reduce((s, p) => s + p.planned, 0);
      return due ? win.reduce((s, p) => s + (p.value as number) * p.planned, 0) / due : null;
    });
  }, [points, unit]);

  const line = avg
    .map((v, i) => (v == null ? null : `${padL + i * slot + slot / 2},${y(v)}`))
    .reduce<string[]>((acc, p, i, arr) => {
      if (p == null) return acc;
      acc.push(`${i === 0 || arr[i - 1] == null ? 'M' : 'L'}${p}`);
      return acc;
    }, [])
    .join(' ');

  const tickEvery = unit === 'day' ? (n > 60 ? 14 : n > 20 ? 7 : 1) : 4;
  const h = hover != null ? points[hover] : null;

  return (
    <div className="relative">
      <div className="mb-3 flex items-center gap-4 text-xs text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2 rounded-[2px] bg-ink-3/45" /> {unit === 'day' ? 'Daily' : 'Weekly'} execution
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[2px] w-4 rounded-full bg-accent" /> {unit === 'day' ? '7-day' : '4-week'} average
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full touch-pan-y" role="img" aria-label="Execution over time" onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((g) => (
          <g key={g}>
            <line x1={padL} x2={W} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth={1} />
            <text x={padL - 6} y={y(g) + 3.5} textAnchor="end" className="fill-ink-3 font-mono" fontSize={10}>
              {g * 100}%
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = padL + i * slot + (slot - bar) / 2;
          const v = p.value ?? 0;
          const top = y(v);
          const base = y(0);
          const hgt = Math.max(0, base - top);
          const r = Math.min(4, bar / 2, hgt);
          return (
            <g key={p.label}>
              {p.value != null && hgt > 0 && (
                <path
                  d={`M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bar - r} Q${x + bar},${top} ${x + bar},${top + r} V${base} Z`}
                  fill={hover === i ? 'var(--text-2)' : 'var(--text-3)'}
                  fillOpacity={hover === i ? 0.7 : 0.4}
                />
              )}
              {p.value == null && <rect x={x} y={base - 1} width={bar} height={1} fill="var(--line-2)" />}
              <rect
                x={padL + i * slot}
                y={padT}
                width={slot}
                height={H - padT - padB}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onTouchStart={() => setHover(i)}
              />
              {i % tickEvery === 0 && (
                <text x={padL + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="fill-ink-3 font-mono" fontSize={10}>
                  {formatDay(p.label).replace(' ', ' ')}
                </text>
              )}
            </g>
          );
        })}
        {line && <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />}
        {hover != null && avg[hover] != null && (
          <circle cx={padL + hover * slot + slot / 2} cy={y(avg[hover] as number)} r={4} fill="var(--accent)" stroke="var(--surface-1)" strokeWidth={2} pointerEvents="none" />
        )}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-6 right-0 rounded-[10px] border border-line-strong bg-raised px-3 py-2 text-xs shadow-pop">
          <p className="font-medium text-ink">{unit === 'week' ? `Week of ${formatDay(h.label)}` : formatDay(h.label)}</p>
          <p className="mt-0.5 text-ink-2 tnum">
            {h.value == null ? 'Nothing due' : `${Math.round(h.value * 100)}% of ${h.planned} planned`}
          </p>
          {avg[hover!] != null && <p className="text-ink-3 tnum">Average {Math.round((avg[hover!] as number) * 100)}%</p>}
        </div>
      )}
      <table className="sr-only">
        <caption>Execution by {unit}</caption>
        <thead>
          <tr>
            <th>{unit === 'day' ? 'Day' : 'Week of'}</th>
            <th>Execution</th>
            <th>Planned</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.label}>
              <td>{p.label}</td>
              <td>{p.value == null ? 'none due' : `${Math.round(p.value * 100)}%`}</td>
              <td>{p.planned}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
