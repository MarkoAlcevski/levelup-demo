'use client';

import { createContext, useContext } from 'react';
import Link from 'next/link';
import { LevelRing } from '@/components/viz/marks';

export interface ViewerInfo {
  name: string;
  level: number;
  progress: number;
  modules: ('gym' | 'learning' | 'money')[];
  today: string;
  weightUnit: 'kg' | 'lb';
  baseCurrency: string;
}

const Ctx = createContext<ViewerInfo | null>(null);

export function ViewerProvider({ value, children }: { value: ViewerInfo; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useViewerInfo(): ViewerInfo {
  const v = useContext(Ctx);
  if (!v) throw new Error('useViewerInfo outside ViewerProvider');
  return v;
}

/** The avatar: level ring → Profile. Profile never takes a tab. */
export function ProfileButton({ size = 40, className }: { size?: number; className?: string }) {
  const v = useViewerInfo();
  return (
    <Link
      href="/profile"
      className={className}
      aria-label={`Profile · level ${v.level}, ${Math.round(v.progress * 100)}% to the next`}
    >
      <LevelRing level={v.level} progress={v.progress} size={size} />
    </Link>
  );
}
