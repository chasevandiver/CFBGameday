export function EdgeBadge({ flag }: { flag: "EDGE" | "BIG_EDGE" | null }) {
  if (!flag) return null;
  return (
    <span
      className={`stat rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${
        flag === "BIG_EDGE" ? "bg-flag text-chalk" : "border border-flag text-flag"
      }`}
    >
      {flag === "BIG_EDGE" ? "Big Edge" : "Edge"}
    </span>
  );
}

export function ConsensusBadge({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <span className="stat rounded border border-gold px-1.5 py-0.5 text-[11px] font-semibold uppercase text-gold">
      Consensus
    </span>
  );
}

/** Vegas convention: negative = home favored. Display relative to home. */
export function fmtSpread(spread: number | null): string {
  if (spread === null) return "–";
  if (spread === 0) return "PK";
  return spread > 0 ? `+${spread}` : `${spread}`;
}

export function fmtPct(p: number | null): string {
  if (p === null) return "–";
  return `${Math.round(p * 100)}%`;
}
