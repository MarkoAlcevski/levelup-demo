'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Barbell, CalendarCheck, ShuffleSimple } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { WORKOUT_NAME_EXAMPLES } from '@/lib/modules';
import { setupGymAction } from '@/lib/actions';
import { Button, Input } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * First Gym open: build YOUR plan. How many days you train, what you call them, and whether they
 * sit on fixed weekdays. Nothing is pre-chosen — not the count, not the names, not the days.
 */
export function GymSetup() {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [count, setCount] = useState<number | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [mode, setMode] = useState<'flexible' | 'scheduled' | null>(null);
  const [weekdays, setWeekdays] = useState<(number | null)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const pickCount = (n: number) => {
    setCount(n);
    setNames((prev) => Array.from({ length: n }, (_, i) => prev[i] ?? ''));
    setWeekdays((prev) => Array.from({ length: n }, (_, i) => prev[i] ?? null));
  };
  const namesOk = names.length > 0 && names.every((n) => n.trim());
  const usedDays = weekdays.filter((w): w is number => w != null);
  const scheduleOk = mode === 'flexible' || (mode === 'scheduled' && usedDays.length > 0 && new Set(usedDays).size === usedDays.length);

  function create() {
    setError(null);
    start(async () => {
      const res = await setupGymAction({
        name: 'My program',
        mode: mode!,
        perWeek: count!,
        days: names.map((n, i) => ({ name: n.trim(), weekday: mode === 'scheduled' ? weekdays[i] : null })),
      });
      if (!res.ok) return setError(res.error);
      toast.show({ title: 'Program saved', detail: res.adopted ? 'Your existing Gym routine and its history now belong to this program.' : 'Next: add exercises to each workout.', tone: 'accent' });
      router.push('/gym/program');
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        {step > 0 && (
          <button type="button" onClick={() => setStep((s) => (s - 1) as 0 | 1)} className="pressable -ml-2 grid size-10 place-items-center rounded-full text-ink-2 hover:bg-sunken" aria-label="Back">
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="flex gap-1.5" aria-label={`Step ${step + 1} of 3`}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={cn('h-1 w-8 rounded-full', i <= step ? 'bg-accent' : 'bg-line-strong')} />
          ))}
        </div>
      </div>

      {step === 0 && (
        <section className="flex flex-col gap-5">
          <div>
            <p className="label-mono">Build your training plan</p>
            <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.03em] text-ink">How many days a week do you train?</h2>
            <p className="mt-2 text-[15px] text-ink-2">Each training day becomes a workout you name and fill with your own exercises.</p>
          </div>
          <div className="grid grid-cols-7 gap-2" role="radiogroup" aria-label="Days per week">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={count === n}
                onClick={() => pickCount(n)}
                className={cn(
                  'pressable grid h-14 place-items-center rounded-[14px] border text-xl font-semibold tnum',
                  count === n ? 'border-transparent bg-accent text-accent-ink' : 'border-line-strong text-ink hover:border-ink-3',
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <Button size="lg" block disabled={!count} onClick={() => setStep(1)}>
            Continue
          </Button>
        </section>
      )}

      {step === 1 && count && (
        <section className="flex flex-col gap-5">
          <div>
            <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.03em] text-ink">Name your {count === 1 ? 'workout' : `${count} workouts`}</h2>
            <p className="mt-2 text-[15px] text-ink-2">Anything you like — the examples are only examples.</p>
          </div>
          <ol className="flex flex-col gap-2.5">
            {names.map((n, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="label-mono w-12 shrink-0">Day {i + 1}</span>
                <Input
                  aria-label={`Day ${i + 1} name`}
                  autoFocus={i === 0}
                  value={n}
                  maxLength={40}
                  placeholder={WORKOUT_NAME_EXAMPLES[i % WORKOUT_NAME_EXAMPLES.length]}
                  onChange={(e) => setNames((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
                />
              </li>
            ))}
          </ol>
          <Button size="lg" block disabled={!namesOk} onClick={() => setStep(2)}>
            Continue
          </Button>
        </section>
      )}

      {step === 2 && count && (
        <section className="flex flex-col gap-5">
          <div>
            <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.03em] text-ink">How do you train?</h2>
          </div>
          <div className="grid gap-2.5">
            {([
              { key: 'flexible', Icon: ShuffleSimple, title: `Flexible · ${count} a week`, body: 'Train on whichever days suit you. LevelUp rotates through your workouts in order.' },
              { key: 'scheduled', Icon: CalendarCheck, title: 'Fixed days', body: 'Each workout has its own weekday. The calendar shows what’s planned.' },
            ] as const).map(({ key, Icon, title, body }) => (
              <button
                key={key}
                type="button"
                aria-pressed={mode === key}
                onClick={() => setMode(key)}
                className={cn(
                  'pressable flex items-start gap-3.5 rounded-[16px] border px-4 py-4 text-left',
                  mode === key ? 'border-accent-text bg-accent-soft' : 'border-line-strong bg-surface hover:border-ink-3',
                )}
              >
                <Icon size={22} className={cn('mt-0.5 shrink-0', mode === key ? 'text-accent-text' : 'text-ink-3')} />
                <span>
                  <span className="block text-[16px] font-semibold text-ink">{title}</span>
                  <span className="block text-[13px] text-ink-3">{body}</span>
                </span>
              </button>
            ))}
          </div>
          {mode === 'scheduled' && (
            <ul className="flex flex-col gap-3">
              {names.map((n, i) => (
                <li key={i}>
                  <p className="mb-1.5 text-[15px] font-medium text-ink">{n}</p>
                  <div className="grid grid-cols-7 gap-1.5" role="radiogroup" aria-label={`${n} weekday`}>
                    {WEEKDAYS.map((d, k) => {
                      const iso = k + 1;
                      const taken = weekdays.some((w, j) => j !== i && w === iso);
                      const on = weekdays[i] === iso;
                      return (
                        <button
                          key={d}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          aria-label={`${n} on ${WEEKDAYS_LONG[k]}`}
                          disabled={taken}
                          onClick={() => setWeekdays((all) => all.map((w, j) => (j === i ? (on ? null : iso) : w)))}
                          className={cn(
                            'pressable h-11 rounded-[10px] text-[13px] font-medium',
                            on ? 'bg-ink text-bg' : taken ? 'text-ink-3/40' : 'border border-line-strong text-ink-2 hover:border-ink-3',
                          )}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </li>
              ))}
              {usedDays.length < names.length && usedDays.length > 0 && (
                <p className="text-[13px] text-ink-3">Workouts without a day stay in your program but aren’t planned on the calendar.</p>
              )}
            </ul>
          )}
          {error && <p className="text-sm text-bad" role="alert">{error}</p>}
          <Button size="lg" block disabled={!scheduleOk} loading={pending} onClick={create}>
            <Barbell size={18} /> Create program
          </Button>
        </section>
      )}
    </div>
  );
}
