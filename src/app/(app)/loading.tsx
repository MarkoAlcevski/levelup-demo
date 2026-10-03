/** Shown instantly while a screen's data loads — the layout never jumps when it arrives. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pt-[max(20px,env(safe-area-inset-top))] lg:px-8 lg:pt-10" aria-busy aria-label="Loading">
      <div className="h-3 w-40 animate-pulse rounded bg-sunken" />
      <div className="mt-3 h-8 w-64 animate-pulse rounded-[8px] bg-sunken" />
      <div className="mt-8 flex items-center gap-6">
        <div className="size-32 animate-pulse rounded-full border-[9px] border-sunken" />
        <div className="flex flex-col gap-2">
          <div className="h-5 w-40 animate-pulse rounded bg-sunken" />
          <div className="h-3.5 w-28 animate-pulse rounded bg-sunken" />
        </div>
      </div>
      <div className="mt-8 h-28 animate-pulse rounded-[16px] bg-sunken" />
      <div className="mt-8 flex flex-col gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="size-7 animate-pulse rounded-full bg-sunken" />
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="h-4 w-1/3 animate-pulse rounded bg-sunken" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-sunken" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
