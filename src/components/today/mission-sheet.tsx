'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Camera, FileArrowUp, LinkSimple, NotePencil, ArrowCounterClockwise, CheckCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { fmtValue } from '@/lib/format';
import type { MissReason, Outcome } from '@/lib/engine/types';
import type { TodayMission } from '@/lib/server/today';
import type { ProofView } from '@/lib/server/proofs';
import { compressImage, uploadProof } from '@/lib/client/api';
import { Sheet } from '@/components/ui/sheet';
import { Button, Chip, Input, Stepper, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import type { RowState } from './mission-row';

const EXCUSES: { value: MissReason; label: string }[] = [
  { value: 'rest', label: 'Planned rest' },
  { value: 'sick', label: 'Sick' },
  { value: 'travel', label: 'Travel' },
];
const MISS_REASONS: { value: MissReason; label: string }[] = [
  { value: 'no_time', label: 'No time' },
  { value: 'forgot', label: 'Forgot' },
  { value: 'low_energy', label: 'Low energy' },
  { value: 'unexpected', label: 'Something came up' },
  { value: 'procrastinated', label: 'Procrastinated' },
  { value: 'too_hard', label: 'Too hard' },
  { value: 'not_important', label: 'Not important anymore' },
  { value: 'other', label: 'Other' },
];

export function MissionSheet({
  mission: m,
  state: s,
  day,
  open,
  focus,
  onClose,
  onSubmit,
  onUndo,
  onProof,
}: {
  mission: TodayMission | null;
  state: RowState | null;
  day: string;
  open: boolean;
  focus?: 'outcomes' | 'proof';
  onClose: () => void;
  onSubmit: (m: TodayMission, outcome: Outcome, value?: number | null, reason?: MissReason | null) => void;
  onUndo: (m: TodayMission) => void;
  onProof: (m: TodayMission, proof: ProofView) => void;
}) {
  const [value, setValue] = useState<number>(0);
  const [panel, setPanel] = useState<null | 'excuse' | 'miss' | 'note' | 'link'>(null);
  const [text, setText] = useState('');
  const [upload, setUpload] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (!open || !m) return;
    setValue(s?.value ?? m.target ?? 0);
    setPanel(null);
    setText('');
    setError(null);
    setUpload(null);
  }, [open, m, s?.value]);

  if (!m || !s) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;

  const done = s.outcome != null && s.outcome !== 'missed' && s.outcome !== 'skipped';
  const measured = m.measure !== 'check' && m.target != null;
  const proofRequired = m.proofPolicy === 'required';
  const weekly = m.weekly ? ` · ${Math.min(m.weekly.done, m.weekly.quota)} of ${m.weekly.quota} this week` : '';

  async function sendFile(file: File) {
    setError(null);
    setUpload(0);
    const blob = await compressImage(file);
    const form = new FormData();
    form.set('kind', 'file');
    form.set('missionId', m!.id);
    form.set('day', day);
    if (s!.completionId) form.set('completionId', s!.completionId);
    form.set('file', blob, file.name || 'proof');
    const res = await uploadProof(form, (f) => setUpload(f));
    setUpload(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onProof(m!, res.proof);
    toast.show({ title: 'Proof added', detail: `${m!.title} · ${res.proof.kind}`, tone: 'accent' });
    onClose();
  }

  async function sendText(kind: 'note' | 'link') {
    if (!text.trim()) return;
    setError(null);
    setUpload(0.5);
    const form = new FormData();
    form.set('kind', kind);
    form.set('missionId', m!.id);
    form.set('day', day);
    if (s!.completionId) form.set('completionId', s!.completionId);
    form.set(kind === 'note' ? 'body' : 'url', text.trim());
    const res = await uploadProof(form);
    setUpload(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onProof(m!, res.proof);
    toast.show({ title: kind === 'note' ? 'Note added' : 'Link added', detail: m!.title, tone: 'accent' });
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={m.title} description={`${m.areaName} · ${m.cadence}${weekly}`}>
      <div className="flex flex-col gap-6 pt-1">
        {proofRequired && !done && (
          <p className="rounded-[12px] border border-warn/30 bg-warn/8 px-3.5 py-2.5 text-[13px] text-ink-2">
            This one needs proof to count. Add a photo, screenshot, note or link — it marks it done.
          </p>
        )}

        {/* log */}
        {!proofRequired && (
          <section aria-label="Log it" className="flex flex-col gap-3">
            {measured ? (
              <>
                <Stepper
                  label={`${m.title} value`}
                  value={value}
                  onChange={setValue}
                  step={m.unit === 'steps' ? 500 : m.unit === 'min' ? 5 : 1}
                  unit={m.unit}
                />
                <div className="flex flex-wrap gap-2">
                  {m.minimum != null && (
                    <Chip selected={value === m.minimum} onClick={() => setValue(m.minimum!)}>
                      Minimum · {fmtValue(m.minimum, m.unit)}
                    </Chip>
                  )}
                  <Chip selected={value === m.target} onClick={() => setValue(m.target!)}>
                    Target · {fmtValue(m.target, m.unit)}
                  </Chip>
                  <Chip selected={value === Math.ceil(m.target! * m.exceedRatio)} onClick={() => setValue(Math.ceil(m.target! * m.exceedRatio))}>
                    {fmtValue(Math.ceil(m.target! * m.exceedRatio), m.unit)}
                  </Chip>
                </div>
                <Button size="lg" block onClick={() => onSubmit(m, 'full', value)} disabled={value <= 0}>
                  <CheckCircle size={20} weight="bold" /> Log {fmtValue(value, m.unit)}
                </Button>
              </>
            ) : (
              <div className="grid gap-2">
                <Button size="lg" block onClick={() => onSubmit(m, 'full')}>
                  <CheckCircle size={20} weight="bold" /> Done
                </Button>
                <div className={cn('grid gap-2', m.minimumLabel ? 'grid-cols-2' : 'grid-cols-1')}>
                  {m.minimumLabel && (
                    <Button variant="secondary" onClick={() => onSubmit(m, 'minimum')}>
                      <span className="truncate">Minimum · {m.minimumLabel}</span>
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => onSubmit(m, 'exceeded')}>
                    Went beyond
                  </Button>
                </div>
              </div>
            )}
            {m.minimumLabel == null && m.minimum == null && (
              <p className="text-[13px] text-ink-3">
                Tip: give this routine a minimum version (Areas → edit) — on a wrecked day, the minimum keeps your streak honest.
              </p>
            )}
          </section>
        )}

        {/* proof */}
        <section aria-label="Proof" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="label-mono">Proof {s.proofs > 0 && <span className="text-ink-2">· {s.proofs} attached</span>}</h3>
            {s.proofs > 0 && (
              <Link href="/progress/evidence" className="text-[13px] text-ink-3 hover:text-ink">
                View evidence
              </Link>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { k: 'camera', label: 'Photo', Icon: Camera, onClick: () => cameraRef.current?.click() },
              { k: 'file', label: 'Upload', Icon: FileArrowUp, onClick: () => fileRef.current?.click() },
              { k: 'note', label: 'Note', Icon: NotePencil, onClick: () => setPanel(panel === 'note' ? null : 'note') },
              { k: 'link', label: 'Link', Icon: LinkSimple, onClick: () => setPanel(panel === 'link' ? null : 'link') },
            ].map(({ k, label, Icon, onClick }) => (
              <button
                key={k}
                type="button"
                onClick={onClick}
                disabled={upload != null}
                className={cn(
                  'pressable flex h-[72px] flex-col items-center justify-center gap-1.5 rounded-[12px] border text-[13px] font-medium',
                  panel === k ? 'border-accent-text bg-accent-soft text-ink' : 'border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink',
                )}
              >
                <Icon size={22} />
                {label}
              </button>
            ))}
          </div>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={(e) => e.target.files?.[0] && sendFile(e.target.files[0])} />
          <input ref={fileRef} type="file" accept="image/*,application/pdf,video/mp4,video/quicktime,video/webm" className="sr-only" tabIndex={-1} onChange={(e) => e.target.files?.[0] && sendFile(e.target.files[0])} />
          {(panel === 'note' || panel === 'link') && (
            <div className="flex flex-col gap-2">
              {panel === 'note' ? (
                <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="What did you do? “Chapter 7 — shutdown rituals.”" maxLength={4000} aria-label="Proof note" />
              ) : (
                <Input autoFocus type="url" inputMode="url" value={text} onChange={(e) => setText(e.target.value)} placeholder="https://" aria-label="Proof link" />
              )}
              <Button onClick={() => sendText(panel)} disabled={!text.trim() || upload != null} loading={upload != null}>
                Attach {panel}
              </Button>
            </div>
          )}
          {upload != null && panel == null && (
            <div className="flex items-center gap-3 text-[13px] text-ink-3">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-sunken">
                <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.max(6, upload * 100)}%` }} />
              </div>
              Uploading…
            </div>
          )}
          {error && (
            <p className="text-[13px] text-bad" role="alert">
              {error}
            </p>
          )}
          <p className="text-xs text-ink-3">Private to you. Photos are stripped of location data before they’re stored.</p>
        </section>

        {/* didn't happen */}
        <section aria-label="Didn’t happen" className="flex flex-col gap-3">
          <h3 className="label-mono">Didn’t happen</h3>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setPanel(panel === 'excuse' ? null : 'excuse')}>
              Excuse today
            </Button>
            <Button variant="outline" onClick={() => setPanel(panel === 'miss' ? null : 'miss')}>
              Mark missed
            </Button>
          </div>
          {panel === 'excuse' && (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] text-ink-3">Excused days leave your rates untouched — and they’re always shown in reports.</p>
              <div className="flex flex-wrap gap-2">
                {EXCUSES.map((r) => (
                  <Chip key={r.value} onClick={() => onSubmit(m, 'skipped', null, r.value)}>
                    {r.label}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          {panel === 'miss' && (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] text-ink-3">What got in the way? It shows up in your weekly report.</p>
              <div className="flex flex-wrap gap-2">
                {MISS_REASONS.map((r) => (
                  <Chip key={r.value} onClick={() => onSubmit(m, 'missed', null, r.value)}>
                    {r.label}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </section>

        {s.outcome && (
          <Button variant="ghost" onClick={() => onUndo(m)} className="self-start">
            <ArrowCounterClockwise size={16} /> Clear today’s entry
          </Button>
        )}
      </div>
    </Sheet>
  );
}
