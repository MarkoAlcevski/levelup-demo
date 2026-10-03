'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CaretLeft, CaretRight, Trash, X } from '@phosphor-icons/react';
import { formatDay } from '@/lib/engine/dates';
import type { GroupPic } from '@/lib/server/group-pics';
import { deletePicAction } from '@/lib/actions';
import { Button, Field, Input } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';

const src = (groupId: string, id: string, thumb = false) => `/api/groups/${groupId}/pics/${id}${thumb ? '?v=thumb' : ''}`;

/** The group's photo wall: every member can post; only members can see. */
export function GymPics({ groupId, today }: { groupId: string; today: string }) {
  const [pics, setPics] = useState<GroupPic[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<{ file: File; url: string } | null>(null);
  const [caption, setCaption] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const load = useCallback(
    async (before: string | null) => {
      setLoading(true);
      try {
        const r = await fetch(`/api/groups/${groupId}/pics${before ? `?before=${encodeURIComponent(before)}` : ''}`);
        const j = await r.json();
        if (j.ok) {
          setPics((cur) => (before ? [...(cur ?? []), ...j.pics] : j.pics));
          setNext(j.next);
        }
      } finally {
        setLoading(false);
      }
    },
    [groupId],
  );
  useEffect(() => {
    void load(null);
  }, [load]);
  useEffect(() => {
    if (!draft) return;
    return () => URL.revokeObjectURL(draft.url);
  }, [draft]);

  async function post() {
    if (!draft) return;
    setPosting(true);
    setError(null);
    const f = new FormData();
    f.set('file', draft.file);
    f.set('caption', caption);
    try {
      const r = await fetch(`/api/groups/${groupId}/pics`, { method: 'POST', body: f });
      const j = await r.json();
      if (!j.ok) {
        setError(j.error ?? 'Couldn’t post that photo.');
        return;
      }
      setDraft(null);
      setCaption('');
      toast.show({ title: 'Gym pic posted', detail: 'Only this group can see it.', tone: 'accent' });
      void load(null);
    } catch {
      setError('You’re offline — try again when you’re connected.');
    } finally {
      setPosting(false);
    }
  }

  const current = open != null && pics ? pics[open] : null;

  return (
    <section aria-labelledby="pics-h" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="pics-h" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Gym pics</h2>
          <p className="text-[13px] text-ink-3">Only members of this group can see them.</p>
        </div>
        <Button onClick={() => input.current?.click()}>
          <Camera size={18} /> Post a pic
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Choose a gym pic"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setError(null);
            setDraft({ file, url: URL.createObjectURL(file) });
          }}
        />
      </div>

      {pics == null ? (
        <div className="grid grid-cols-3 gap-1.5" aria-label="Loading">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-[10px] bg-sunken" />
          ))}
        </div>
      ) : pics.length ? (
        <>
          <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {pics.map((p, i) => (
              <li key={p.id}>
                <button type="button" onClick={() => setOpen(i)} className="pressable group relative block aspect-square w-full overflow-hidden rounded-[10px] bg-sunken" aria-label={`Gym pic by ${p.name}, ${formatDay(p.on, today)}${p.caption ? `: ${p.caption}` : ''}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src(groupId, p.id, true)} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                  <span className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/70 to-transparent px-2 pt-6 pb-1.5 text-left text-[11px] font-medium text-white">{p.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {next && (
            <Button variant="ghost" onClick={() => load(next)} loading={loading} className="self-center">
              Show more
            </Button>
          )}
        </>
      ) : (
        <button type="button" onClick={() => input.current?.click()} className="pressable rounded-[16px] border border-dashed border-line-strong px-5 py-8 text-center hover:bg-sunken/40">
          <Camera size={26} className="mx-auto text-ink-3" />
          <span className="mt-2 block text-[15px] font-medium text-ink">No gym pics yet</span>
          <span className="mt-1 block text-[13px] text-ink-3">Post the first one — a set, a view from the rack, the whole crew.</span>
        </button>
      )}

      <Sheet open={!!draft} onClose={() => setDraft(null)} title="Post a gym pic" description="Everyone in this group will see it. Location data is removed.">
        {draft && (
          <form
            className="flex flex-col gap-4 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              void post();
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={draft.url} alt="The photo you chose" className="max-h-[46vh] w-full rounded-[14px] bg-sunken object-contain" />
            <Field label="Caption (optional)" htmlFor="pic-caption">
              <Input id="pic-caption" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={140} />
            </Field>
            {error && <p className="text-sm text-bad" role="alert">{error}</p>}
            <Button type="submit" size="lg" block loading={posting}>
              Post to the group
            </Button>
          </form>
        )}
      </Sheet>

      <PicViewer
        groupId={groupId}
        today={today}
        pic={current}
        hasPrev={open != null && open > 0}
        hasNext={open != null && !!pics && open < pics.length - 1}
        onPrev={() => setOpen((i) => (i != null && i > 0 ? i - 1 : i))}
        onNext={() => setOpen((i) => (i != null && pics && i < pics.length - 1 ? i + 1 : i))}
        onClose={() => setOpen(null)}
        onDeleted={(id) => {
          setPics((cur) => (cur ?? []).filter((p) => p.id !== id));
          setOpen(null);
          toast.show({ title: 'Pic deleted' });
        }}
      />
    </section>
  );
}

function PicViewer({
  groupId, today, pic, hasPrev, hasNext, onPrev, onNext, onClose, onDeleted,
}: {
  groupId: string; today: string; pic: GroupPic | null; hasPrev: boolean; hasNext: boolean;
  onPrev: () => void; onNext: () => void; onClose: () => void; onDeleted: (id: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (pic && !d.open) d.showModal();
    if (!pic && d.open) d.close();
    setConfirm(false);
  }, [pic]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onPrev();
        if (e.key === 'ArrowRight') onNext();
      }}
      aria-label="Gym pic"
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-black p-0 text-white backdrop:bg-black"
    >
      {pic && (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-3 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">{pic.name}</p>
              <p className="text-[12px] text-white/70">{formatDay(pic.on, today)}</p>
            </div>
            {pic.canDelete &&
              (confirm ? (
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy}
                  onClick={async () => {
                    setBusy(true);
                    const r = await deletePicAction(groupId, pic.id);
                    setBusy(false);
                    if (r.ok) onDeleted(pic.id);
                  }}
                >
                  Delete for everyone
                </Button>
              ) : (
                <button type="button" onClick={() => setConfirm(true)} className="grid size-11 place-items-center rounded-full text-white/80 hover:bg-white/10" aria-label="Delete this pic">
                  <Trash size={20} />
                </button>
              ))}
            <button type="button" onClick={onClose} className="grid size-11 place-items-center rounded-full text-white/80 hover:bg-white/10" aria-label="Close">
              <X size={22} />
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src(groupId, pic.id)} alt={pic.caption ?? `Gym pic by ${pic.name}`} className="max-h-full max-w-full rounded-[8px] object-contain" />
            {hasPrev && (
              <button type="button" onClick={onPrev} className="absolute left-2 grid size-11 place-items-center rounded-full bg-black/50 hover:bg-black/70" aria-label="Previous pic">
                <CaretLeft size={20} />
              </button>
            )}
            {hasNext && (
              <button type="button" onClick={onNext} className="absolute right-2 grid size-11 place-items-center rounded-full bg-black/50 hover:bg-black/70" aria-label="Next pic">
                <CaretRight size={20} />
              </button>
            )}
          </div>
          {pic.caption && <p className="px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] text-center text-[15px] text-white/90">{pic.caption}</p>}
          {!pic.caption && <div className="pb-[max(20px,env(safe-area-inset-bottom))]" />}
        </div>
      )}
    </dialog>
  );
}
