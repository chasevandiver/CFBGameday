import { ArrowDown, ArrowUp, Check, Minus, X } from "lucide-react";
import { fmtSpread } from "../../lib/slate";

export function LiveBadge() {
  return (
    <span className="chip bg-live/15 text-live">
      <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-live" />
      Live
    </span>
  );
}

export function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null || rank > 25) return null;
  return (
    <span className="stat shrink-0 text-[10.5px] font-semibold leading-none text-dim" title="Model rank">
      #{rank}
    </span>
  );
}

export function EdgeChip({
  flag,
  edge,
}: {
  flag: "EDGE" | "BIG_EDGE" | null;
  edge: number | null;
}) {
  if (!flag) return null;
  const delta = edge !== null ? ` ${fmtSpread(Math.round(Math.abs(edge) * 10) / 10)}` : "";
  return (
    <span
      className={`chip ${
        flag === "BIG_EDGE" ? "bg-edge text-white" : "border border-edge/60 bg-edge/10 text-edge"
      }`}
      title={edge !== null ? `Model vs market: ${edge > 0 ? "+" : ""}${edge} pts` : undefined}
    >
      {flag === "BIG_EDGE" ? "Big Edge" : "Edge"}
      {delta && <span className="stat normal-case tracking-normal">{delta.replace("+", "")}</span>}
    </span>
  );
}

export function ConsensusChip({ on }: { on: boolean }) {
  if (!on) return null;
  return <span className="chip border border-accent/50 bg-accent/10 text-accent">Consensus</span>;
}

export function PickedChip() {
  return <span className="chip bg-accent/15 text-accent">Picked</span>;
}

/** Pass/fail/push chip — icon + text, never color alone. */
export function ResultChip({
  label,
  result,
}: {
  label: string;
  result: "pass" | "fail" | "push";
}) {
  const styles = {
    pass: "bg-win/12 text-win",
    fail: "bg-loss/12 text-loss",
    push: "bg-push/12 text-push",
  }[result];
  const Icon = result === "pass" ? Check : result === "fail" ? X : Minus;
  return (
    <span className={`chip ${styles}`}>
      <Icon size={11} strokeWidth={3} aria-hidden />
      {label}
    </span>
  );
}

/** Line movement: arrow + delta vs open. Down = toward home, up = away. */
export function MoveIndicator({ move, open }: { move: number | null; open: number | null }) {
  if (move === null) return null;
  const toward = move < 0; // spread dropped → market moved toward the home side
  return (
    <span
      className={`stat inline-flex items-center gap-0.5 text-[10.5px] font-medium ${
        toward ? "text-win" : "text-loss"
      }`}
      title={open !== null ? `Opened ${fmtSpread(open)}` : undefined}
    >
      {toward ? <ArrowDown size={11} aria-hidden /> : <ArrowUp size={11} aria-hidden />}
      {Math.abs(move)}
    </span>
  );
}
