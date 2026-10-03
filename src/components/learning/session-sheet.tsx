'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { finishLearningAction, logLearningAction } from '@/lib/actions';
import { addDays } from '@/lib/engine/dates';
import { fmtMinutes } from '@/lib/format';
import { Button, Chip, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';

export interface SubjectLite {
  id: string;
  name: string;
  measure: 'minutes' | 'sessions' | 'pages' | 'lessons' | 'custom';
  unit: string | null;
}

export function unitWord(s: Pick<SubjectLite, 'measure' | 'unit'>): string {
  return s.measure === 'minutes' ? 'min' : s.measure === 'custom' ? s.unit ?? 'units' : s.measure;
}

export function fmtAmount(n: number, s: Pick<SubjectLite, 'measure' | 'unit'>): string {
  if (s.measure === 'minutes') return fmtMinutes(n);
  const v = Math.round(n * 10) / 10;
  if (s.measure === 'sessions') return `${v} session${v === 1 ? '' : 's'}`;
  return `${v} ${unitWord(s)}`;
}

/**
 * Log a learning session (or finish a timed one). Minutes for time-based subjects; the amount
 * (pages, lessons, your own unit) for the rest, with minutes optional. Topic and note are optional.
 */
export function SessionSheet({
  open,
  onClose,
  subjects,
  today,
  initialSubjectId,
  finishing,
}: {
  open: boolean;
  onClose: () => void;
  subjects: SubjectLite[];
  today: string;
  initialSubjectId?: string | null;
  finishing?: { id: string; startedAt: string } | null;
}) {
  const [subjectId, setSubjectId] = useState(initialSubjectId ?? subjects[0]?.id ?? '');
  const [day, setDay] = useState(today);
  const [minutes, setMinutes] = useState('');
  const [quantity, setQuantity] = useState('');
  const [topic, setTopic] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    setSubjectId(initialSubjectId ?? subjects[0]?.id ?? '');
    setDay(today);
    setQuantity('');
    setTopic('');
    setNote('');
    setError(null);
    setMinutes(finishing ? String(Math.max(1, Math.round((Date.now() - Date.parse(finishing.startedAt)) / 60000))) : '');
  }, [open, initialSubjectId, subjects, today, finishing]);

  const subject = subjects.find((s) => s.id === subjectId);
  const quantityBased = subject && subject.measure !== 'minutes' && subject.measure !== 'sessions';

  function submit() {
    setError(null);
    const m = minutes.trim() ? Math.round(Number(minutes.replace(',', '.'))) : null;
    const qn = quantity.trim() ? Number(quantity.replace(',', '.')) : null;
    if (m != null && !Number.isFinite(m)) return setError('Minutes must be a number.');
    if (qn != null && !Number.isFinite(qn)) return setError('Enter a number.');
    start(async () => {
      const res = finishing
        ? await finishLearningAction(finishing.id, { minutes: m, quantity: qn, topic: topic || null, note: note || null })
        : await logLearningAction({ subjectId, day, minutes: m, quantity: qn, topic: topic || null, note: note || null });
      if (!res.ok) return setError(res.error);
      const s = subject!;
      toast.show({
        title: `${res.subjectName} · ${quantityBased && qn ? fmtAmount(qn, s) : m ? fmtMinutes(m) : 'logged'}`,
        detail: `${fmtAmount(res.week.done, s)} of ${fmtAmount(res.week.target, s)} this week`,
        tone: 'accent',
      });
      onClose();
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title={finishing ? 'Finish session' : 'Log a session'} description={subject ? subject.name : undefined}>
      <form
        className="flex flex-col gap-4 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {!finishing && subjects.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Subject">
            {subjects.map((s) => (
              <Chip key={s.id} selected={s.id === subjectId} onClick={() => setSubjectId(s.id)}>
                {s.name}
              </Chip>
            ))}
          </div>
        )}
        {quantityBased && (
          <Field label={`How many ${unitWord(subject!)}`} htmlFor="ls-qty">
            <Input id="ls-qty" inputMode="decimal" autoFocus value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" />
          </Field>
        )}
        <Field label={quantityBased ? 'Minutes (optional)' : 'Minutes'} htmlFor="ls-min">
          <Input id="ls-min" inputMode="numeric" autoFocus={!quantityBased} value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, ''))} placeholder="45" />
        </Field>
        {!quantityBased && (
          <div className="-mt-2 flex flex-wrap gap-2">
            {[15, 25, 30, 45, 60, 90].map((n) => (
              <Chip key={n} selected={minutes === String(n)} onClick={() => setMinutes(String(n))}>
                {n} min
              </Chip>
            ))}
          </div>
        )}
        <Field label="Topic" htmlFor="ls-topic">
          <Input id="ls-topic" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} placeholder="Konjunktiv II, chapter 4…" />
        </Field>
        <Field label="Note" htmlFor="ls-note">
          <Textarea id="ls-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="Optional" className="min-h-20" />
        </Field>
        {!finishing && (
          <Field label="Day" htmlFor="ls-day">
            <Select id="ls-day" value={day} onChange={(e) => setDay(e.target.value)}>
              {Array.from({ length: 8 }, (_, i) => addDays(today, -i)).map((d, i) => (
                <option key={d} value={d}>
                  {i === 0 ? 'Today' : i === 1 ? 'Yesterday' : d}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {error && (
          <p className="text-sm text-bad" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" block loading={pending} disabled={!subjectId || (!minutes && !quantity)}>
          {finishing ? 'Save session' : 'Log session'}
        </Button>
      </form>
    </Sheet>
  );
}
