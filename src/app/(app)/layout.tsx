import { asUser } from '@/lib/db';
import { getViewer } from '@/lib/server/context';
import { totalXp } from '@/lib/server/load';
import { levelFromXp } from '@/lib/engine/xp';
import { QuickAddProvider } from '@/components/shell/quick-add';
import { CommandBarProvider } from '@/components/shell/command-bar';
import { SideRail, TabBar } from '@/components/shell/nav';
import { ViewerProvider } from '@/components/shell/viewer';
import { TourProvider } from '@/components/tutorial/tour';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  const lv = levelFromXp(await asUser(viewer.userId, (q) => totalXp(q)));
  const p = viewer.profile;
  return (
    <ViewerProvider
      value={{ name: p.displayName, level: lv.level, progress: lv.progress, modules: p.modules, today: viewer.today, weightUnit: p.weightUnit, baseCurrency: p.baseCurrency }}
    >
      <QuickAddProvider today={viewer.today} modules={p.modules} unit={p.weightUnit}>
        <CommandBarProvider>
          <TourProvider autoStart={!p.tutorialDoneAt && !!p.onboardedAt} today={viewer.today}>
            <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[90] focus:rounded-[10px] focus:bg-raised focus:px-4 focus:py-2">
              Skip to content
            </a>
            <div className="flex min-h-dvh">
              <SideRail />
              <main id="main" className="min-w-0 flex-1">
                {children}
              </main>
            </div>
            <TabBar />
          </TourProvider>
        </CommandBarProvider>
      </QuickAddProvider>
    </ViewerProvider>
  );
}
