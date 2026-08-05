/** Loading placeholder that mirrors the real game-card layout — no shift. */
export function SkeletonCard() {
  return (
    <div className="card relative overflow-hidden p-3.5 pt-4" aria-hidden>
      <div className="absolute inset-x-0 top-0 h-[3px] bg-(--line)" />
      <div className="flex items-center justify-between">
        <span className="skeleton h-3.5 w-20" />
        <span className="skeleton h-3.5 w-12" />
      </div>
      <div className="mt-3 flex flex-col gap-2.5">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="skeleton h-[26px] w-[26px] rounded-full" />
            <span className="skeleton h-4 flex-1" />
            <span className="skeleton h-6 w-10" />
            <span className="skeleton h-6 w-10" />
            <span className="skeleton h-6 w-12" />
          </div>
        ))}
      </div>
      <div className="mt-3 border-t border-chalk/8 pt-3">
        <div className="flex justify-between">
          <span className="skeleton h-4 w-16" />
          <span className="skeleton h-4 w-14" />
        </div>
        <span className="skeleton mt-2.5 block h-1.5 w-full rounded-full" />
      </div>
    </div>
  );
}
