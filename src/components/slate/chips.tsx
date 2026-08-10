import { ArrowDown, ArrowUp, Check, Minus, Users, X } from "lucide-react";
import type { LiveBetStatus } from "../../lib/live-status";
import { fmtSpread, type MoveRead } from "../../lib/slate";

export function LiveBadge() {
  return (
    <span className="chip bg-live/15 text-live">
      <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-live" />
      Live
    </span>
  );
}

export function RankBadge({ rank, poll }: { rank: number | null; poll?: string | null }) {
  if (rank === null || rank > 25) return null;
  return (
    <span
      className="stat shrink-0 text-[10.5px] font-semibold leading-none text-dim"
      title={poll ? `${poll} rank` : "Model rank"}
    >
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

/**
 * The viewer's pool pick, named. It used to render the bare word "Picked",
 * which told you that you had one and nothing about which side — the card
 * already knew, and the live and final states already printed it. One chip per
 * market, so a spread and a total on the same game read as two.
 *
 * Deliberately NOT accent-coloured. This app is two products — a pick'em pool
 * and a bet tracker — and a pick chip that looked identical to a bet chip
 * (`BetChip`, same tint, same weight) made a card carrying both unreadable:
 * you could not tell what you had money on. Accent now means money. A pool
 * pick reads as chalk with the group mark, so the two are separable without
 * reading either label.
 */
export function PickedChip({ label }: { label: string }) {
  return (
    <span className="chip bg-chalk/10 text-chalk/85">
      <Users size={10} aria-hidden className="shrink-0 opacity-70" />
      <span className="sr-only">Group pick: </span>
      {label}
    </span>
  );
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

/**
 * Live "is this bet winning right now" chip — icon + text, never color alone.
 * Clinched outcomes (totals past the line) go solid.
 */
export function LiveStatusChip({ prefix, status }: { prefix: string; status: LiveBetStatus }) {
  const style =
    status.state === "winning"
      ? status.clinched
        ? "bg-win text-white"
        : "bg-win/12 text-win"
      : status.state === "losing"
        ? status.clinched
          ? "bg-loss text-white"
          : "bg-loss/12 text-loss"
        : "bg-push/12 text-push";
  const Icon = status.state === "winning" ? Check : status.state === "losing" ? X : Minus;
  return (
    <span className={`chip ${style}`}>
      <Icon size={11} strokeWidth={3} aria-hidden />
      {prefix && <span>{prefix}</span>}
      <span className="normal-case tracking-normal">{status.label}</span>
    </span>
  );
}

/**
 * Line movement: arrow + delta vs open. Always neutral.
 *
 * It used to tint green when the market steamed toward the model's side and red
 * when it steamed away. Green/red on this card means one thing — is your money
 * good — and the movement carries no money, so the colour was borrowing a
 * vocabulary it had no claim on. The model-lean read survives in the title,
 * where it costs nothing to ignore.
 */
export function MoveIndicator({ move, open }: { move: MoveRead | null; open: number | null }) {
  if (move === null) return null;
  const toward = move.delta < 0; // spread dropped → market moved toward the home side
  const title = [
    open !== null ? `Opened ${fmtSpread(open)}` : null,
    move.vsModel === "toward"
      ? "Market moving toward the model's side"
      : move.vsModel === "away"
        ? "Market moving away from the model's side"
        : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      className="stat inline-flex items-center gap-0.5 text-[10.5px] font-medium text-dim"
      title={title || undefined}
    >
      {toward ? <ArrowDown size={11} aria-hidden /> : <ArrowUp size={11} aria-hidden />}
      {Math.abs(move.delta)}
    </span>
  );
}
