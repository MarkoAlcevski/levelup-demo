'use client';

import { forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';

// ───────────────────────────────────────────── Button

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-[1.04] disabled:opacity-40',
  secondary: 'bg-sunken text-ink hover:bg-line-strong disabled:opacity-50',
  outline: 'border border-line-strong text-ink hover:bg-sunken disabled:opacity-50',
  ghost: 'text-ink-2 hover:bg-sunken hover:text-ink disabled:opacity-50',
  danger: 'bg-bad/12 text-bad hover:bg-bad/20 disabled:opacity-50',
};
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-[10px]',
  md: 'h-11 px-4 text-[15px] gap-2 rounded-[12px]',
  lg: 'h-13 px-5 text-base gap-2 rounded-[14px]',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'pressable relative inline-flex select-none items-center justify-center font-medium whitespace-nowrap',
        VARIANT[variant],
        SIZE[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      <span className={cn('inline-flex items-center gap-[inherit]', loading && 'opacity-0')}>{children}</span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center" aria-hidden>
          <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        </span>
      )}
    </button>
  );
});

// ───────────────────────────────────────────── Segmented control (radio semantics)

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; hint?: string }[];
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex rounded-[12px] bg-sunken p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <label
            key={o.value}
            title={o.hint}
            className={cn(
              'pressable relative flex flex-1 cursor-pointer items-center justify-center rounded-[9px] text-center font-medium select-none',
              size === 'sm' ? 'h-8 px-2 text-[13px]' : 'h-10 px-3 text-sm',
              active ? 'bg-raised text-ink shadow-[0_1px_2px_rgb(0_0_0/0.2),0_0_0_1px_var(--line-2)]' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={active}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────────────── Chip (toggle)

export function Chip({
  selected,
  onClick,
  children,
  className,
  disabled,
  ...rest
}: {
  selected?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'pressable inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium',
        selected ? 'border-transparent bg-ink text-bg' : 'border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink',
        disabled && 'opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ───────────────────────────────────────────── Fields

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[13px] text-bad" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[13px] text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

export const inputClass =
  'h-12 w-full rounded-[12px] border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] duration-150 focus:border-accent-text focus:outline-none focus:ring-3 focus:ring-accent-soft aria-[invalid=true]:border-bad';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(inputClass, className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(inputClass, 'h-auto min-h-24 py-3 leading-6', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn(inputClass, 'appearance-none pr-10', className)} {...rest}>
        {children}
      </select>
      <svg className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-3" width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-[15px] text-ink">{label}</span>
        {description && <span className="block text-[13px] text-ink-3">{description}</span>}
      </label>
      <button
        id={id}
        role="switch"
        type="button"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-accent' : 'bg-line-strong',
        )}
      >
        <span
          className={cn(
            'absolute top-1 left-1 size-5 rounded-full shadow-sm transition-transform duration-200 ease-[var(--ease-out)]',
            checked ? 'translate-x-5 bg-accent-ink' : 'bg-ink-2',
          )}
        />
      </button>
    </div>
  );
}

/** Numeric stepper with direct entry. */
export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 1_000_000,
  unit,
  label,
  id,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string | null;
  label: string;
  id?: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="flex h-14 items-center gap-1 rounded-[14px] border border-line-strong bg-surface p-1">
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(clamp(value - step))} className="pressable grid size-12 place-items-center rounded-[10px] text-xl text-ink-2 hover:bg-sunken">
        −
      </button>
      <div className="flex flex-1 items-baseline justify-center gap-1.5">
        <input
          id={id}
          aria-label={label}
          inputMode="decimal"
          value={Number.isFinite(value) ? String(value) : ''}
          onChange={(e) => {
            const n = Number(e.target.value.replace(',', '.'));
            if (Number.isFinite(n)) onChange(clamp(n));
          }}
          className="tnum w-24 bg-transparent text-center text-2xl font-semibold text-ink outline-none"
        />
        {unit && <span className="text-sm text-ink-3">{unit}</span>}
      </div>
      <button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(clamp(value + step))} className="pressable grid size-12 place-items-center rounded-[10px] text-xl text-ink-2 hover:bg-sunken">
        +
      </button>
    </div>
  );
}
