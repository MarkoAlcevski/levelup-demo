'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight } from '@phosphor-icons/react';
import { APP_NAME } from '@/lib/brand';
import { finishTourAction } from '@/lib/actions';
import { Button } from '@/components/ui/primitives';

/**
 * The guided tour: every part of the app, one spotlight at a time. It starts on Today for every new
 * member (and for demo visitors), walks from page to page on its own, and can be replayed from
 * Profile. Each step names data-tour targets; the first visible one is lit up, and when none is on
 * the page (a module that's off, no groups yet) the card simply sits in the middle.
 *
 * Smoothness: the spotlight and the card are moved by one requestAnimationFrame loop that eases
 * toward the target and writes straight to the DOM (an SVG mask and transforms), so nothing
 * re-renders while it glides or while the page scrolls underneath. Every page the tour visits is
 * prefetched when it starts.
 */

interface Step {
  id: string;
  path: (today: string) => string;
  /** data-tour names to light up, in order of preference */
  targets?: string[];
  title: string;
  body: string;
}

export const STEPS: Step[] = [
  {
    id: 'welcome', path: () => '/today', title: `Welcome to ${APP_NAME}`,
    body: 'A quick tour of every part of the app: what each screen is for and how to use it. It takes about two minutes, and you can replay it any time from Profile.',
  },
  {
    id: 'today', path: () => '/today', targets: ['today'], title: 'Today',
    body: 'How much of today is done, in one line. Below it are your routines, workout and study for the day. Tap one to mark it done, log a number or add a photo as proof.',
  },
  {
    id: 'quick-add', path: () => '/today', targets: ['quick-add'], title: 'Quick add',
    body: 'Log anything fast: a workout, an expense, a study session or a new routine. On a computer, press N.',
  },
  {
    id: 'quest-card', path: () => '/today', targets: ['quest-card'], title: 'Quests pay LevelCoins',
    body: 'Your workout, study, journal and a finished plan turn into quests by themselves. This card shows how many are done and how many LevelCoins you have.',
  },
  {
    id: 'quests', path: () => '/quests', targets: ['quest-list'], title: 'Your quests',
    body: 'Quests from your plan tick themselves when you do the real thing. Add up to five of your own each day: Small pays 10, Medium 20, Big 40. Finish everything due today for a +20 bonus.',
  },
  {
    id: 'boxes', path: () => '/quests?tab=collectables', targets: ['boxes'], title: 'Open boxes',
    body: 'Spend LevelCoins on an Iron Crate for gym characters or a Cash Case for finance ones. Each box holds one character: Common, Uncommon, Epic, Legendary, or a hidden Secret.',
  },
  {
    id: 'collectables', path: () => '/quests?tab=collectables', targets: ['collectables'], title: 'Your collection',
    body: 'Two sets of five. Characters you own come alive; the rest are silhouettes until you pull them. Tap any character to see it up close.',
  },
  {
    id: 'prize', path: () => '/quests?tab=collectables', targets: ['set-prize'], title: 'Collect a set, win a prize',
    body: 'Own all five characters of a set to claim a real prize. At least three of the five must come out of your own boxes. The rest can come from trades.',
  },
  {
    id: 'trades', path: () => '/quests?tab=collectables', targets: ['trades'], title: 'Trade with friends',
    body: 'Extra copies are spares. Offer one of yours for one of theirs to anyone in your groups. They have a week to accept or decline.',
  },
  {
    id: 'areas', path: () => '/areas', targets: ['areas', 'areas-tools', 'page'], title: 'Areas',
    body: 'The parts of your life you track: your own areas, like Business or Health, with their routines and goals, plus Gym, Learning and Money when they’re on.',
  },
  {
    id: 'gym', path: () => '/gym', targets: ['gym', 'page'], title: 'Gym',
    body: 'Your program and your next workout. Log every set with weight and reps. The calendar shows kept and missed days, and Stats shows your personal records.',
  },
  {
    id: 'learning', path: () => '/learning', targets: ['learning', 'page'], title: 'Learning',
    body: 'Add your own subjects, like a language, an exam or coding. Set a weekly target, then log sessions or run a timer.',
  },
  {
    id: 'money', path: () => '/money', targets: ['subnav', 'page'], title: 'Money',
    body: 'Overview, Transactions, Accounts, Plan and Analysis. Log income and spending, plan the month, set targets and see where your money goes.',
  },
  {
    id: 'groups', path: () => '/groups', targets: ['groups', 'page'], title: 'Groups',
    body: 'Private groups with your friends. Each season has a leaderboard and a Hall of Fame, and gym groups get a Gym pics wall where everyone posts. Invite friends with a code.',
  },
  {
    id: 'world', path: () => '/groups/world', targets: ['world-board', 'page'], title: 'World leaderboard',
    body: 'Everyone on LevelUp, ranked every week by LevelCoins and workouts, and by collection size. Only a first name and last initial show, and you can hide yourself in Profile.',
  },
  {
    id: 'progress', path: () => '/progress', targets: ['subnav', 'page'], title: 'Progress',
    body: 'Your record over time: streaks, scores, weekly reports and the proof you’ve saved.',
  },
  {
    id: 'journal', path: (d) => `/journal/${d}`, targets: ['journal', 'page'], title: 'Journal',
    body: 'A page for every day: what you did, what you want to do tomorrow, and notes. It saves as you type. Past days are on the year calendar.',
  },
  {
    id: 'profile', path: () => '/profile', targets: ['modules', 'page'], title: 'Profile',
    body: 'Turn Gym, Learning and Money on or off, choose whether you show on the world leaderboards, and replay this tour whenever you like.',
  },
  {
    id: 'nav', path: () => '/today', targets: ['nav'], title: 'Getting around',
    body: 'Today, Areas, Groups, Money and Progress are always one tap away. Your profile is behind your avatar.',
  },
  {
    id: 'done', path: () => '/today', title: 'You’re set',
    body: 'Do today’s plan, earn LevelCoins, open boxes and climb the leaderboards.',
  },
];

const STEP_KEY = 'kept_tour_step';
const DONE_KEY = 'kept_tour_done';

const TourContext = createContext<{ start: () => void; active: boolean }>({ start: () => {}, active: false });
export const useTour = () => useContext(TourContext);

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeSession(key: string, value: string | null) {
  try {
    if (value == null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {}
}

export function TourProvider({ autoStart, today, children }: { autoStart: boolean; today: string; children: React.ReactNode }) {
  const [index, setIndex] = useState<number | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  // resume a tour after a reload; start it once for a new member when they land on Today
  useEffect(() => {
    if (index !== null) return;
    const saved = readSession(STEP_KEY);
    if (saved != null && Number.isInteger(Number(saved)) && Number(saved) < STEPS.length) {
      setIndex(Number(saved));
      return;
    }
    if (autoStart && pathname === '/today' && !readSession(DONE_KEY)) setIndex(0);
  }, [autoStart, pathname, index]);

  useEffect(() => {
    if (index !== null) writeSession(STEP_KEY, String(index));
  }, [index]);

  // every page the tour visits, fetched ahead so moving between them is quick
  const prefetched = useRef(false);
  useEffect(() => {
    if (index === null || prefetched.current) return;
    prefetched.current = true;
    for (const p of new Set(STEPS.map((s) => s.path(today)))) router.prefetch(p);
  }, [index, today, router]);

  // walk to the step's page
  useEffect(() => {
    if (index === null) return;
    const want = STEPS[index].path(today);
    if (window.location.pathname + window.location.search !== want) router.push(want, { scroll: false });
  }, [index, today, router]);

  const finish = useCallback((skipped: boolean) => {
    setIndex(null);
    writeSession(STEP_KEY, null);
    writeSession(DONE_KEY, '1');
    void finishTourAction(skipped);
  }, []);

  const start = useCallback(() => {
    writeSession(DONE_KEY, null);
    setIndex(0);
  }, []);

  return (
    <TourContext.Provider value={{ start, active: index !== null }}>
      {children}
      <AnimatePresence>
        {index !== null && (
          <TourOverlay
            key="tour"
            index={index}
            today={today}
            pathname={pathname}
            onBack={() => setIndex((i) => (i === null ? null : Math.max(0, i - 1)))}
            onNext={() => (index >= STEPS.length - 1 ? finish(false) : setIndex(index + 1))}
            onSkip={() => finish(true)}
          />
        )}
      </AnimatePresence>
    </TourContext.Provider>
  );
}

type Box = { x: number; y: number; w: number; h: number };
const PAD = 8;
const GAP = 14;

function TourOverlay({
  index, today, pathname, onBack, onNext, onSkip,
}: {
  index: number;
  today: string;
  pathname: string;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const step = STEPS[index];
  const reduce = useReducedMotion();
  const hole = useRef<SVGRectElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const [searching, setSearching] = useState(false);
  const last = index === STEPS.length - 1;

  // what the loop eases toward, and where things are now
  const target = useRef<Box | null>(null);
  const cur = useRef<Box | null>(null);
  const cardAt = useRef<{ x: number; y: number } | null>(null);
  const cardSize = useRef({ w: 380, h: 240 });
  const el = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const c = card.current;
    if (!c) return;
    const ro = new ResizeObserver(() => {
      cardSize.current = { w: c.offsetWidth, h: c.offsetHeight };
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // find this step's target once its page is showing
  useEffect(() => {
    el.current = null;
    if (!step.targets) {
      target.current = null;
      setSearching(false);
      return;
    }
    setSearching(true);
    const want = step.path(today);
    const wantPath = want.split('?')[0];
    let raf = 0;
    let alive = true;
    const t0 = performance.now();
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
    };
    const find = () => {
      if (!alive) return;
      if (pathname === wantPath && window.location.pathname + window.location.search === want) {
        for (const name of step.targets!) {
          const hit = [...document.querySelectorAll(`[data-tour="${name}"]`)].find(visible) as HTMLElement | undefined;
          if (hit) {
            el.current = hit;
            const r = hit.getBoundingClientRect();
            hit.scrollIntoView({ block: r.height > window.innerHeight * 0.55 ? 'start' : 'center', behavior: reduce ? 'auto' : 'smooth' });
            setSearching(false);
            return;
          }
        }
      }
      // keep the old spotlight while the next page loads; give up after a while and centre the card
      if (performance.now() - t0 > 700) target.current = null;
      if (performance.now() - t0 > 6000) {
        setSearching(false);
        return;
      }
      raf = requestAnimationFrame(find);
    };
    raf = requestAnimationFrame(find);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [index, pathname, today, step, reduce]);

  // one loop: follow the target, ease toward it, write to the DOM
  useEffect(() => {
    let raf = 0;
    const k = reduce ? 1 : 0.2;
    const tick = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const e = el.current;
      if (e && e.isConnected) {
        const r = e.getBoundingClientRect();
        target.current = { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
      } else if (e && !e.isConnected) el.current = null;

      // the hole: collapse to the middle when there's nothing to show
      const goal = target.current ?? { x: vw / 2, y: vh / 2, w: 0, h: 0 };
      const c = cur.current ?? { ...goal };
      c.x += (goal.x - c.x) * k;
      c.y += (goal.y - c.y) * k;
      c.w += (goal.w - c.w) * k;
      c.h += (goal.h - c.h) * k;
      cur.current = c;
      const h = hole.current;
      if (h) {
        h.setAttribute('x', String(c.x));
        h.setAttribute('y', String(c.y));
        h.setAttribute('width', String(Math.max(0, c.w)));
        h.setAttribute('height', String(Math.max(0, c.h)));
      }
      const g = ring.current;
      if (g) {
        g.style.transform = `translate3d(${c.x}px, ${c.y}px, 0)`;
        g.style.width = `${Math.max(0, c.w)}px`;
        g.style.height = `${Math.max(0, c.h)}px`;
        g.style.opacity = c.w > 12 ? '1' : '0';
      }

      // the card: under the spotlight if it fits, above if not, otherwise pinned to the bottom
      const { w: cw, h: ch } = cardSize.current;
      let want: { x: number; y: number };
      if (!target.current) want = { x: (vw - cw) / 2, y: Math.max(16, (vh - ch) / 2) };
      else {
        const t = target.current;
        const x = Math.min(Math.max(16, t.x + t.w / 2 - cw / 2), vw - cw - 16);
        if (vh - (t.y + t.h) >= ch + GAP + 16) want = { x, y: t.y + t.h + GAP };
        else if (t.y >= ch + GAP + 16) want = { x, y: t.y - GAP - ch };
        else want = { x: (vw - cw) / 2, y: vh - ch - 16 };
      }
      const a = cardAt.current ?? want;
      a.x += (want.x - a.x) * k;
      a.y += (want.y - a.y) * k;
      cardAt.current = a;
      if (card.current) card.current.style.transform = `translate3d(${a.x}px, ${a.y}px, 0)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  // keyboard: Esc skips, arrows move, Tab stays inside the card
  useEffect(() => {
    next.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onSkip();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onNext();
      } else if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        onBack();
      } else if (e.key === 'Tab' && card.current) {
        const items = [...card.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
        if (!items.length) return;
        const first = items[0];
        const lastItem = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          lastItem.focus();
        } else if (!e.shiftKey && document.activeElement === lastItem) {
          e.preventDefault();
          first.focus();
        } else if (!card.current.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, onBack, onNext, onSkip]);

  return (
    <motion.div className="fixed inset-0 z-[100]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.25 }}>
      {/* the dim layer with a hole cut out of it */}
      <svg aria-hidden className="pointer-events-none fixed inset-0 h-full w-full">
        <defs>
          <mask id="tour-hole">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            <rect ref={hole} rx="18" ry="18" fill="black" />
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgb(0 0 0 / 0.66)" mask="url(#tour-hole)" />
      </svg>
      <div ref={ring} aria-hidden className="tour-ring pointer-events-none fixed left-0 top-0 rounded-[18px] border-2 border-accent opacity-0 will-change-transform" />
      {/* the page underneath stays still while the tour is open */}
      <div aria-hidden className="fixed inset-0" />

      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="fixed left-0 top-0 w-[min(380px,calc(100vw-32px))] will-change-transform"
      >
        <motion.div
          className="rounded-[20px] border border-line-strong bg-raised p-5 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.7)]"
          initial={reduce ? false : { scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="label-mono" aria-live="polite">
              {index + 1} of {STEPS.length}
            </p>
            <button type="button" onClick={onSkip} className="pressable -mr-2 rounded-[8px] px-2 py-1 text-[13px] font-medium text-ink-3 hover:bg-sunken hover:text-ink-2">
              Skip tour
            </button>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step.id}
              initial={reduce ? false : { opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? undefined : { opacity: 0, x: -14 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <h2 id="tour-title" className="mt-2 text-[19px] font-semibold tracking-[-0.02em] text-ink">
                {step.title}
              </h2>
              <p id="tour-body" className="mt-1.5 text-[15px] leading-6 text-ink-2">
                {step.body}
              </p>
            </motion.div>
          </AnimatePresence>
          <div className="mt-4 flex items-center gap-1" aria-hidden>
            {STEPS.map((s, i) => (
              <motion.span
                key={s.id}
                className={i <= index ? 'h-1 rounded-full bg-accent transition-colors duration-300' : 'h-1 rounded-full bg-line-strong transition-colors duration-300'}
                animate={{ flexGrow: i === index ? 4 : 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                style={{ flexBasis: 0 }}
              />
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <span className={searching ? 'tour-searching text-[12px] text-ink-3' : 'text-[12px] text-transparent'}>{searching ? `Opening ${step.title}` : '.'}</span>
            <span className="flex items-center gap-2">
              {index > 0 && (
                <Button variant="ghost" size="sm" onClick={onBack}>
                  <ArrowLeft size={15} /> Back
                </Button>
              )}
              <Button ref={next} size="sm" onClick={onNext}>
                {index === 0 ? 'Show me around' : last ? 'Start leveling up' : 'Next'}
                {!last && <ArrowRight size={15} />}
              </Button>
            </span>
          </div>
        </motion.div>
        {last && !reduce && <Confetti />}
      </div>
    </motion.div>
  );
}

/** A small burst behind the last card. */
function Confetti() {
  const bits = Array.from({ length: 22 }, (_, i) => {
    const a = (i / 22) * Math.PI * 2;
    return { x: Math.cos(a) * (140 + (i % 4) * 30), y: Math.sin(a) * (110 + (i % 3) * 30) - 30, r: (i % 2 ? 1 : -1) * (180 + i * 12), c: i % 3 };
  });
  const colors = ['var(--accent)', 'oklch(0.85 0.15 85)', 'oklch(0.72 0.17 305)'];
  return (
    <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2">
      {bits.map((b, i) => (
        <motion.span
          key={i}
          className="absolute size-2.5 rounded-[2px]"
          style={{ background: colors[b.c] }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 0.6 }}
          animate={{ x: b.x, y: b.y + 40, rotate: b.r, opacity: 0, scale: 1 }}
          transition={{ duration: 1.4, ease: [0.15, 0.8, 0.3, 1], delay: 0.1 }}
        />
      ))}
    </span>
  );
}
