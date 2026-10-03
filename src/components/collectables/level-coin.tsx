import { cn } from '@/lib/cn';

/** A LevelCoin: a gold disc with a raised chevron. */
export function LevelCoin({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className={cn('inline-block shrink-0', className)}>
      <circle cx="10" cy="10" r="9.25" fill="oklch(0.84 0.15 85)" stroke="oklch(0.62 0.13 70)" strokeWidth="1.5" />
      <path d="M6 11.6 10 7.6l4 4" fill="none" stroke="oklch(0.42 0.1 65)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const formatCoins = (n: number) => n.toLocaleString('en-US');
