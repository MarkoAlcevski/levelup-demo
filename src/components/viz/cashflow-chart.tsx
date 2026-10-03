'use client';

import { useState } from 'react';
import { formatMoney } from '@/lib/engine/money';

/**
 * Monthly income vs expenses: two series, same axis, side-by-side columns with a 2px gap.
 * Income wears the accent; expenses a neutral. A legend is always shown; hover gives exact values.
 */
export function CashflowChart({
  months,
  currency,
  height = 180,
}: {
  months: { month: string; label: string; income: number; expenses: number; net: number; partial: boolean }[];
  currency: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const firstActive = months.findIndex((m) => m.income !== 0 || m.expenses !== 0);
  const data = firstActive < 0 ? [] : months.slice(firstActive);
  if (!data.length) return <p className="py-6 text-sm text-ink-3">Cash flow appears after your first income or expense.</p>;
  const W = 640;
  const H = height;
  const padL = 44;
  const padB = 22;
  const padT = 8;
  const max = Math.max(1, ...data.flatMap((m) => [m.income, m.expenses]));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => padT + (1 - v / top) * (H - padT - padB);
  const slot = (W - padL) / data.length;
  const bar = Math.min(24, (slot - 12) / 2);
  const col = (x: number, v: number, fill: string, opacity = 1) => {
    const t = y(v);
    const b = y(0);
    const h = Math.max(0, b - t);
    const r = Math.min(4, h, bar / 2);
    return <path d={`M${x},${b} V${t + r} Q${x},${t} ${x + r},${t} H${x + bar - r} Q${x + bar},${t} ${x + bar},${t + r} V${b} Z`} fill={fill} fillOpacity={opacity} />;
  };
  const h = hover != null ? data[hover] : null;
  return (
    <div className="relative">
      <div className="mb-3 flex items-center gap-4 text-xs text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-accent" /> Income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-ink-3/60" /> Expenses
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Monthly income and expenses" onMouseLeave={() => setHover(null)}>
        {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((g) => (
          <g key={g}>
            <line x1={padL} x2={W} y1={y(g)} y2={y(g)} stroke="var(--line)" />
            <text x={padL - 6} y={y(g) + 3.5} textAnchor="end" fontSize={10} className="fill-ink-3 font-mono">
              {formatMoney(g, currency, { whole: true }).replace(/\.00$/, '')}
            </text>
          </g>
        ))}
        {data.map((m, i) => {
          const x0 = padL + i * slot + (slot - (bar * 2 + 2)) / 2;
          return (
            <g key={m.month} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
              <rect x={padL + i * slot} y={padT} width={slot} height={H - padT - padB} fill="transparent" />
              {col(x0, m.income, 'var(--accent)', m.partial ? 0.55 : 1)}
              {col(x0 + bar + 2, m.expenses, 'var(--text-3)', m.partial ? 0.35 : 0.6)}
              <text x={padL + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={10} className="fill-ink-3 font-mono">
                {m.label}
                {m.partial ? '*' : ''}
              </text>
            </g>
          );
        })}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-6 right-0 rounded-[10px] border border-line-strong bg-raised px-3 py-2 text-xs shadow-pop">
          <p className="font-medium text-ink">
            {h.label}
            {h.partial ? ' (so far)' : ''}
          </p>
          <p className="text-ink-2 tnum">Income {formatMoney(h.income, currency, { compact: true })}</p>
          <p className="text-ink-2 tnum">Expenses {formatMoney(h.expenses, currency, { compact: true })}</p>
          <p className="text-ink tnum">Net {formatMoney(h.net, currency, { compact: true, signed: true })}</p>
        </div>
      )}
      <p className="mt-1 text-[11px] text-ink-3">* month in progress</p>
      <table className="sr-only">
        <caption>Monthly cash flow in {currency}</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Income</th>
            <th>Expenses</th>
            <th>Net</th>
          </tr>
        </thead>
        <tbody>
          {data.map((m) => (
            <tr key={m.month}>
              <td>{m.month}</td>
              <td>{formatMoney(m.income, currency)}</td>
              <td>{formatMoney(m.expenses, currency)}</td>
              <td>{formatMoney(m.net, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function niceStep(max: number): number {
  const raw = max / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}
