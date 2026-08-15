import type { PickCoverView } from "../../lib/live-status";

/**
 * The verdict on a card you have a position on: the word, and what you hold.
 *
 * Shared by the slate's `GameCard` and the home hub's `PositionRow` — the hub
 * used to carry the aura's colour with no word to explain it, which is a glow
 * that means something and says nothing.
 *
 * Two things it deliberately does not show (owner report, 2026-08-15). The
 * signed margin — `COVERING +2½` — was the loudest thing on the card at 18px
 * and answered a question nobody was asking: the tier's colour already says
 * which side of the number you are on, and the score is two rows below. The
 * totals room line ("Needs 7 more") went with it, and is still on the slate
 * card as a `LiveStatusChip`, where it is labelled.
 *
 * What they paid for is the tail. `Pick UTAH +3.5` used to render at 10.5px and
 * 75% opacity in the corner — smaller than the crew line under it — which on a
 * phone in daylight is the one thing on a strip about your money that you
 * cannot read. It is now the size of the verdict word.
 *
 * pointer-events stay off so taps fall through to the card's own link.
 */
export function CoverStrip({ cover, tail }: { cover: PickCoverView; tail: string }) {
  return (
    <div className={`cover-strip relative z-10 pointer-events-none cover-${cover.tier}`}>
      <span className="cover-word">{cover.word}</span>
      {tail && <span className="cover-pick">{tail}</span>}
    </div>
  );
}
