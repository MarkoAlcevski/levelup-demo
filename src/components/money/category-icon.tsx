'use client';

import {
  AirplaneTilt, ArrowsLeftRight, Barbell, Briefcase, Car, ChartLineUp, Coins, DotsThree, FilmSlate, FirstAidKit, ForkKnife,
  Gift, GraduationCap, House, Laptop, Lightning, Repeat, ShoppingBag, ShoppingCart, Wallet, type Icon,
} from '@phosphor-icons/react';

const EXPENSE: Record<string, Icon> = {
  housing: House, groceries: ShoppingCart, restaurants: ForkKnife, transport: Car, utilities: Lightning, subscriptions: Repeat,
  health: FirstAidKit, fitness: Barbell, education: GraduationCap, shopping: ShoppingBag, entertainment: FilmSlate,
  travel: AirplaneTilt, business: Briefcase, gifts: Gift, other: DotsThree,
};
const INCOME: Record<string, Icon> = { salary: Wallet, freelance: Laptop, business: Briefcase, investment: ChartLineUp, gift: Gift, other: Coins };

export function CategoryIcon({ slug, kind, size = 16 }: { slug: string | null; kind: string; size?: number }) {
  const I = kind === 'transfer' ? ArrowsLeftRight : (kind === 'income' ? INCOME : EXPENSE)[slug ?? ''] ?? (kind === 'income' ? Coins : DotsThree);
  return <I size={size} aria-hidden />;
}
