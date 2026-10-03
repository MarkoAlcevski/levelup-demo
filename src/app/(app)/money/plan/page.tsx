import type { Metadata } from 'next';
import { getViewer } from '@/lib/server/context';
import { loadMoneyPlan } from '@/lib/server/money-plan';
import { Page } from '@/components/page';
import { MoneySubnav } from '@/components/money/subnav';
import { PlanView } from '@/components/money/plan-view';

export const metadata: Metadata = { title: 'Money plan' };

export default async function MoneyPlanRoute() {
  const viewer = await getViewer();
  const data = await loadMoneyPlan(viewer);
  return (
    <Page title="Plan" kicker="Money" subnav={<MoneySubnav active="plan" />}>
      <PlanView data={data} />
    </Page>
  );
}
