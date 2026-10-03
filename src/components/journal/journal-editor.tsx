'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowBendDownRight, CheckCircle, CloudSlash } from '@phosphor-icons/react';
import { saveJournalAction } from '@/lib/actions';
import type { DayFacts, JournalEntry } from '@/lib/server/journal';

type Fields = { did: string; plan: string; notes: string };
type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: string } | { kind: 'offline' };

const draftKey = (day: string) => `kept_journal_${day}`;
function readDraft(day: string): (Fields & { at: string }) | null {
  try {
    const raw = localStorage.getItem(draftKey(day));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeDraft(day: string, f: Fields) {
  try {
    localStorage.setItem(draftKey(day), JSON.stringify({ ...f, at: new Date().toISOString() }));
  } catch {}
}
function dropDraft(day: string) {
  try {
    localStorage.removeItem(draftKey(day));
  } catch {}
}
const FIELD =
  'min-h-32 w-full resize-y rounded-[14px] border border-line-strong bg-surface px-4 py-3.5 text-[17px] leading-7 text-ink placeholder:text-ink-3 [field-sizing:content] transition-[border-color,box-shadow] duration-150 focus:border-accent-text focus:outline-none focus:ring-3 focus:ring-accent-soft';
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Facts from LevelUp, as lines you can drop into “What I did”. */
function factLines(f: DayFacts): string[] {
  const out: string[] = [];
  for (const w of f.workouts) out.push(`${w.name} — ${w.sets ? `${w.sets} set${w.sets === 1 ? '' : 's'}` : 'logged'}${w.minutes ? `, ${w.minutes} min` : ''}`);
  for (const l of f.learning) out.push(`${l.subject}: ${l.amount}${l.topic ? ` (${l.topic})` : ''}`);
  for (const k of f.kept) out.push(k.value ? `${k.title}: ${k.value}` : k.title);
  for (const t of f.tasksDone) out.push(t);
  if (f.focus?.done) out.push(`Weekly focus done: ${f.focus.title}`);
  return out;
}

/**
 * One day's page: what I did, what I want to do, notes. Autosaves while you type (and keeps a copy on
 * the device, so nothing is lost offline or on a flaky connection).
 */
export function JournalEditor({
  day,
  today,
  entry,
  facts,
  carried,
}: {
  day: string;
  today: string;
  entry: JournalEntry;
  facts: DayFacts;
  carried: string | null;
}) {
  const [f, setF] = useState<Fields>({ did: entry.did, plan: entry.plan, notes: entry.notes });
  const [status, setStatus] = useState<Status>(entry.updatedAt ? { kind: 'saved', at: entry.updatedAt } : { kind: 'idle' });
  const latest = useRef(f);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);

  const save = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current || inflight.current) return;
    inflight.current = true;
    dirty.current = false;
    const sent = latest.current;
    setStatus({ kind: 'saving' });
    try {
      const r = await saveJournalAction({ day, ...sent });
      if (!r.ok) throw new Error(r.error);
      if (latest.current === sent) dropDraft(day);
      setStatus({ kind: 'saved', at: r.savedAt });
    } catch {
      dirty.current = true;
      setStatus({ kind: 'offline' });
    } finally {
      inflight.current = false;
      if (dirty.current && navigator.onLine && latest.current !== sent) timer.current = setTimeout(save, 800);
    }
  }, [day]);

  // restore an unsaved copy from this device (written offline, or the tab closed mid-save)
  useEffect(() => {
    const d = readDraft(day);
    if (!d) return;
    const differs = d.did !== entry.did || d.plan !== entry.plan || d.notes !== entry.notes;
    if (differs && (!entry.updatedAt || d.at > entry.updatedAt)) {
      const restored = { did: d.did, plan: d.plan, notes: d.notes };
      latest.current = restored;
      setF(restored);
      dirty.current = true;
      timer.current = setTimeout(save, 300);
    } else dropDraft(day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  // flush on leave, retry when back online, warn before closing with unsaved words
  useEffect(() => {
    const online = () => {
      if (dirty.current) void save();
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current || inflight.current) {
        e.preventDefault();
      }
    };
    window.addEventListener('online', online);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('beforeunload', beforeUnload);
      if (dirty.current) void save();
    };
  }, [save]);

  const change = (k: keyof Fields, v: string) => {
    const next = { ...latest.current, [k]: v };
    latest.current = next;
    setF(next);
    dirty.current = true;
    writeDraft(day, next);
    setStatus((s) => (s.kind === 'offline' ? s : { kind: 'idle' }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 900);
  };

  const lines = factLines(facts);
  const addFacts = () => {
    const bullet = lines.map((l) => `• ${l}`).join('\n');
    change('did', f.did.trim() ? `${f.did.replace(/\s+$/, '')}\n${bullet}` : bullet);
  };
  const past = day < today;
  const future = day > today;
  const planHint = future ? 'Plans for this day.' : day === today ? 'Tomorrow, this week, someday.' : 'What you wanted to do next.';
  const hasFacts = lines.length > 0 || facts.missed.length > 0 || !!facts.money || facts.proofs > 0;

  return (
    <div className="flex flex-col gap-7">
      <p className="-mt-3 flex min-h-5 items-center gap-1.5 text-[12px] text-ink-3" role="status" aria-live="polite">
        {status.kind === 'saving' && 'Saving…'}
        {status.kind === 'saved' && (
          <>
            <CheckCircle size={14} weight="fill" className="text-good" /> Saved {clock(status.at)}
          </>
        )}
        {status.kind === 'offline' && (
          <>
            <CloudSlash size={14} /> Not synced yet — kept on this device, will save when you’re back online
          </>
        )}
        {status.kind === 'idle' && 'Saves as you type'}
      </p>

      {carried && !future && (
        <figure className="rounded-[14px] bg-sunken px-4 py-3">
          <figcaption className="label-mono flex items-center gap-1.5">
            <ArrowBendDownRight size={13} /> The day before, you wanted to
          </figcaption>
          <p className="mt-1.5 whitespace-pre-line text-[15px] leading-6 text-ink-2">{carried}</p>
        </figure>
      )}

      {!future && (
        <section aria-labelledby="did-h" data-tour="journal" className="flex flex-col gap-2">
          <label id="did-h" htmlFor="j-did" className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
            What I did
          </label>
          <textarea
            id="j-did"
            value={f.did}
            onChange={(e) => change('did', e.target.value)}
            onBlur={() => void save()}
            placeholder={day === today ? 'The day so far…' : 'How the day went…'}
            className={FIELD}
          />
          {hasFacts && (
            <div className="rounded-[14px] border border-line px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="label-mono">In LevelUp that day</p>
                {lines.length > 0 && (
                  <button type="button" onClick={addFacts} className="pressable -mr-2 min-h-11 rounded-[10px] px-2 text-[13px] font-medium text-accent-text hover:bg-sunken">
                    Add to what I did
                  </button>
                )}
              </div>
              <ul className="mt-1 flex flex-col gap-1.5 text-[14px] leading-5 text-ink-2">
                {facts.focus && (
                  <li>
                    Weekly focus: {facts.focus.title} {facts.focus.done ? <span className="text-good">· done</span> : null}
                  </li>
                )}
                {facts.workouts.map((w) => (
                  <li key={w.id}>
                    <Link href={`/gym/session/${w.id}`} className="underline decoration-line-strong underline-offset-2 hover:text-ink">
                      {w.name}
                    </Link>{' '}
                    · {w.sets ? `${w.sets} set${w.sets === 1 ? '' : 's'}` : 'logged without sets'}{w.minutes ? ` · ${w.minutes} min` : ''}
                  </li>
                ))}
                {facts.learning.map((l, i) => (
                  <li key={`l${i}`}>
                    {l.subject} · {l.amount}
                    {l.topic ? ` · ${l.topic}` : ''}
                  </li>
                ))}
                {facts.kept.length > 0 && <li>Kept: {facts.kept.map((k) => (k.value ? `${k.title} (${k.value})` : k.title)).join(', ')}</li>}
                {facts.tasksDone.length > 0 && <li>Done: {facts.tasksDone.join(', ')}</li>}
                {facts.missed.length > 0 && <li className="text-ink-3">Missed: {facts.missed.join(', ')}</li>}
                {facts.money && (
                  <li>
                    <Link href={`/money/transactions?from=${day}&to=${day}`} className="underline decoration-line-strong underline-offset-2 hover:text-ink">
                      Money
                    </Link>
                    : {[facts.money.spent && `spent ${facts.money.spent}`, facts.money.income && `earned ${facts.money.income}`].filter(Boolean).join(', ') || `${facts.money.count} transactions`}
                  </li>
                )}
                {facts.proofs > 0 && (
                  <li>
                    <Link href={`/progress/evidence?month=${day.slice(0, 7)}`} className="underline decoration-line-strong underline-offset-2 hover:text-ink">
                      {facts.proofs} proof{facts.proofs === 1 ? '' : 's'}
                    </Link>{' '}
                    captured
                  </li>
                )}
              </ul>
            </div>
          )}
          {past && !hasFacts && !f.did && <p className="text-[13px] text-ink-3">Nothing was logged in LevelUp that day.</p>}
        </section>
      )}

      <section aria-labelledby="plan-h" className="flex flex-col gap-2">
        <label id="plan-h" htmlFor="j-plan" className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
          What I want to do
        </label>
        <textarea id="j-plan" value={f.plan} onChange={(e) => change('plan', e.target.value)} onBlur={() => void save()} placeholder={planHint} className={FIELD} />
      </section>

      <section aria-labelledby="notes-h" className="flex flex-col gap-2">
        <label id="notes-h" htmlFor="j-notes" className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
          Notes
        </label>
        <textarea
          id="j-notes"
          value={f.notes}
          onChange={(e) => change('notes', e.target.value)}
          onBlur={() => void save()}
          placeholder="Thoughts, ideas, anything worth remembering."
          className={FIELD}
        />
      </section>
    </div>
  );
}
