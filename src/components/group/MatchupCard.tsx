import { Ban, Check, Minus, X } from "lucide-react";
import Link from "next/link";
import { flipHeadline, flipWhen } from "../../lib/cover";
import type { CoverFlipRow, PickMarket, PickRow } from "../../lib/db-types";
import { DEFAULT_TZ, kickParts, tzLabel } from "../../lib/kick";
import { fmtTotal, pickSideLabel, type GameView, type TeamView } from "../../lib/slate";
import { TeamLine } from "../slate/TeamLine";

/**
 * One matchup, with the group's picks arranged as a split.
 *
 * The question on a Saturday morning is "who's on which side of this game",
 * and the previous layout — game, then market, then a list of names — made you
 * assemble that yourself by reading down two separate sections. Here the two
 * sides are the two halves of the card and each member sits under the one they
 * took, with the number they actually got.
 *
 * Every device is one the slate already uses: the 3px team split edge and
 * `TeamLine` (mark, rank, record) from the game card, `.trow`/`.trail` for the
 * team-owned halves, and the accent ring the odds cells use for "yours".
 */

/** Colour fallback: the light-mode value of --push, which is what this is. */
const NEUTRAL = "var(--push)";

const MARKET_ORDER: PickMarket[] = ["spread", "total", "straight_up"];

const MARKET_LABEL: Record<PickMarket, string> = {
  spread: "Spread",
  total: "Total",
  straight_up: "Winner",
};

export interface MatchupPick {
  id: number;
  userId: string;
  name: string;
  market: PickMarket;
  side: string;
  line: number | null;
  result: PickRow["result"];
}

export function MatchupCard({
  game,
  picks,
  viewerId,
  /** Markets the group has on this week — drives which sections can appear. */
  markets,
  /** Group hides picks until kickoff and this game hasn't kicked off yet. */
  blind = false,
  /** Total picks in, used when `blind` hides who and what. `null` when the
   *  viewer isn't entitled to the count either — a signed-out visitor to a
   *  public group — which is different from nobody being in. */
  blindCount = null,
  /** The admin dropped this game from the board; picks stay but don't count. */
  dropped = false,
  /** Late cover swings on this game (0026), oldest first. */
  flips = [],
}: {
  game: GameView;
  picks: MatchupPick[];
  viewerId: string | null;
  markets: PickMarket[];
  blind?: boolean;
  blindCount?: number | null;
  dropped?: boolean;
  flips?: CoverFlipRow[];
}) {
  const awayColor = game.away.color ?? NEUTRAL;
  const homeColor = game.home.color ?? NEUTRAL;
  const kick = game.startTs === null ? null : kickParts(game.startTs, DEFAULT_TZ);
  const live = game.status === "in_progress";
  const final = game.status === "final";

  const shown = MARKET_ORDER.filter(
    (m) => markets.includes(m) || picks.some((p) => p.market === m),
  );

  return (
    <li className={`card overflow-hidden ${dropped ? "opacity-45" : ""}`}>
      {/* The card's own device for "two teams own this": a hairline split in
          their colours. Raw chroma — it is 3px, not a wash. */}
      <div aria-hidden className="flex h-[3px]">
        <span className="flex-1" style={{ background: awayColor }} />
        <span className="flex-1" style={{ background: homeColor }} />
      </div>

      {/* Both teams stacked rather than "AWAY at HOME" on one line: with a
          logo, a rank and two records each, the single line ran out of phone
          long before it ran out of facts. The whole block is the link — two
          22px rows clear the 44px floor together, and there is nothing else
          up here to tap. */}
      <Link href={`/game/${game.id}`} className="flex items-start gap-2 px-3 py-2">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {(["away", "home"] as const).map((s) => {
            const team = s === "away" ? game.away : game.home;
            const points = s === "away" ? game.awayPoints : game.homePoints;
            return (
              <span
                key={s}
                className="trow flex min-h-[22px] items-center gap-2"
                style={{ "--tc": team.color ?? NEUTRAL } as React.CSSProperties}
              >
                <span className="trail" aria-hidden />
                <TeamLine team={team} size={22} className="flex-1" />
                {(live || final) && (
                  <span className="stat w-7 shrink-0 text-right text-[15px] font-semibold leading-none text-chalk">
                    {points ?? 0}
                  </span>
                )}
              </span>
            );
          })}
        </span>
        <span className="stat shrink-0 pt-1 text-right text-[11px] leading-tight text-dim">
          {final ? "Final" : live ? <span className="text-live">Live</span> : kick ? (
            <>
              {kick.day}
              <span className="block text-chalk/70">
                {kick.time} {tzLabel(DEFAULT_TZ)}
              </span>
            </>
          ) : (
            "TBD"
          )}
        </span>
      </Link>

      {dropped && (
        <p className="stat border-t border-chalk/8 px-3.5 py-2 text-[10px] uppercase tracking-wider text-chalk/40">
          No longer in play
        </p>
      )}

      {/* Blind: the rule is stated once above the list, so each card only
          carries its own number. Repeating "they reveal at kickoff" on every
          matchup is the sign-in-prompt-per-card mistake again. */}
      {blind ? (
        <p className="stat border-t border-chalk/8 px-3.5 py-2.5 text-[11px] uppercase tracking-wider text-chalk/45">
          {blindCount === null
            ? "Hidden"
            : blindCount === 0
              ? "Nobody in yet"
              : `${blindCount} in · hidden`}
        </p>
      ) : picks.length === 0 ? (
        <p className="border-t border-chalk/8 px-3.5 py-3 text-sm text-dim">Nobody in yet.</p>
      ) : (
        shown.map((market) => (
          <MarketSplit
            key={market}
            market={market}
            game={game}
            picks={picks.filter((p) => p.market === market)}
            viewerId={viewerId}
            awayColor={awayColor}
            homeColor={homeColor}
          />
        ))
      )}
      <BadBeat game={game} picks={picks} flips={flips} viewerId={viewerId} />
    </li>
  );
}

/**
 * Who the late swing actually hit. The flip itself is a neutral fact about the
 * game (that is what the table stores); the names only exist here, where the
 * group's picks are already in hand.
 */
function BadBeat({
  game,
  picks,
  flips,
  viewerId,
}: {
  game: GameView;
  picks: MatchupPick[];
  flips: CoverFlipRow[];
  viewerId: string | null;
}) {
  if (flips.length === 0 || game.status !== "final") return null;
  // The last flip is the one that stuck; earlier ones were undone.
  const f = flips[flips.length - 1];
  const on = (side: string) =>
    picks.filter((p) => (f.market === "total" ? p.market === "total" : p.market === "spread") && p.side === side);
  const burned = on(f.from_side);
  const saved = on(f.to_side);
  if (burned.length === 0 && saved.length === 0) return null;

  const names = (list: MatchupPick[]) =>
    list.map((p) => (p.userId === viewerId ? "you" : p.name)).join(", ");

  return (
    <div className="border-t border-chalk/8 px-3 py-2 text-[10.5px]">
      <span className="stat text-loss">{f.winner_changed ? "Wild finish" : "Backdoor"}</span>
      <span className="text-chalk/70">
        {" "}
        · {flipHeadline(f, game.home.abbr, game.away.abbr)} at {flipWhen(f.period, f.clock)}
      </span>
      {burned.length > 0 && (
        <span className="text-chalk/55"> · burned: {names(burned)}</span>
      )}
      {saved.length > 0 && <span className="text-chalk/55"> · saved: {names(saved)}</span>}
    </div>
  );
}

/**
 * One market as two halves.
 *
 * Spread and winner are team-owned, so each half carries `--tc` and reads as
 * that team's. A total is owned by neither, so the halves get the same class
 * with `--tc` unset — `.trow`'s gradient is `var(--tc, transparent)`, so it
 * simply resolves to nothing and the geometry stays identical.
 */
function MarketSplit({
  market,
  game,
  picks,
  viewerId,
  awayColor,
  homeColor,
}: {
  market: PickMarket;
  game: GameView;
  picks: MatchupPick[];
  viewerId: string | null;
  awayColor: string;
  homeColor: string;
}) {
  if (picks.length === 0) return null;
  const teamSided = market !== "total";
  const leftSide = teamSided ? "away" : "over";
  const rightSide = teamSided ? "home" : "under";

  const left = picks.filter((p) => p.side === leftSide);
  const right = picks.filter((p) => p.side === rightSide);
  const total = left.length + right.length;

  // The number is the same for everyone on a total, so it belongs in the
  // heading; on a spread it differs per picker and belongs on their chip.
  const heading =
    market === "total" && picks[0].line !== null
      ? `Total ${fmtTotal(picks[0].line)}`
      : MARKET_LABEL[market];

  const half = (side: "left" | "right") => {
    const isLeft = side === "left";
    const team: TeamView = isLeft ? game.away : game.home;
    const entries = isLeft ? left : right;
    const color = isLeft ? awayColor : homeColor;
    const label = teamSided ? team.abbr : isLeft ? "Over" : "Under";
    return (
      <div
        className="trow min-w-0 flex-1 py-1.5"
        style={teamSided ? ({ "--tc": color } as React.CSSProperties) : undefined}
      >
        {teamSided && <span className="trail" aria-hidden />}
        <p className="stat text-[10px] font-semibold uppercase tracking-wider text-chalk/50">
          {label}
        </p>
        {entries.length === 0 ? (
          <p className="stat mt-1 text-[11px] text-chalk/25">—</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1">
            {entries.map((p) => (
              <PickerChip key={p.id} pick={p} game={game} mine={p.userId === viewerId} />
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="border-t border-chalk/8 px-3.5 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="stat text-[10px] uppercase tracking-wider text-chalk/40">{heading}</p>
        {total > 1 && (
          <p className="stat text-[10px] text-chalk/40">
            {left.length}–{right.length}
          </p>
        )}
      </div>

      {/* The lean, at a glance. Only earns its space once more than one person
          is in — with a single pick the chips below already say it.
          One span over a coloured track rather than two flex children: a flex
          item's percentage width still shrinks to make room for its sibling,
          which rendered a 2–0 as a 50/50. */}
      {total > 1 && (
        <div
          aria-hidden
          className="mt-1.5 h-[3px] overflow-hidden rounded-full"
          style={{ background: teamSided ? homeColor : "var(--push)" }}
        >
          <span
            className="block h-full"
            style={{
              width: `${(left.length / total) * 100}%`,
              background: teamSided ? awayColor : "var(--chalk)",
            }}
          />
        </div>
      )}

      <div className="mt-1.5 flex gap-2">
        {half("left")}
        {half("right")}
      </div>
    </div>
  );
}

/**
 * A member and the number they got.
 *
 * Yours takes the accent treatment the odds cells use for a standing pick, so
 * your own card is findable in a wall of names. A graded pick gets a tick or a
 * cross beside the colour — `ResultChip`'s rule is icon plus text, never colour
 * alone, and this is the same information.
 */
const GRADED_CHIP: Record<
  NonNullable<PickRow["result"]>,
  { Icon: typeof Check; tone: string }
> = {
  win: { Icon: Check, tone: "text-win" },
  loss: { Icon: X, tone: "text-loss" },
  push: { Icon: Minus, tone: "text-push" },
  // Ban, not Minus. Both greys are greys — `--push` #9aa1ad and `--text-dim`
  // #a89f90 differ only in temperature and are not separable at 10px, which a
  // render check caught after the first pass shipped them with the same glyph.
  // The icon is what carries the difference, which is the same reason
  // chips.tsx pairs every colour with one.
  void: { Icon: Ban, tone: "text-dim" },
};

function PickerChip({
  pick,
  game,
  mine,
}: {
  pick: MatchupPick;
  game: GameView;
  mine: boolean;
}) {
  // Every graded state gets an icon and a colour, because `chips.tsx`'s
  // ResultChip says so — "icon + text, never color alone". Push and void used
  // to fall through both branches below and render exactly like an ungraded
  // pick, with only the sr-only string carrying the outcome, so a sighted
  // member could not tell a push from a game nobody had graded yet (UX-22).
  //
  // Void is not push. A canceled game returns the stake and settles nothing,
  // so it takes the muted treatment rather than the push colour — the same
  // distinction the home hub makes in words, where labelling a canceled game
  // "Push" was the bug P1-1(b) fixed.
  const graded = pick.result ? GRADED_CHIP[pick.result] : null;
  const Icon = graded?.Icon;
  // The heading already carries the side for a total, so the chip only needs
  // the number where it differs between pickers — spreads.
  const number =
    pick.market === "spread"
      ? pickSideLabel(pick.market, pick.side, pick.line, "", "").trim()
      : null;

  return (
    <li
      className={`stat inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] ${
        mine
          ? "bg-accent/15 text-accent ring-1 ring-inset ring-accent/45"
          : "bg-elev text-chalk"
      }`}
    >
      {Icon && <Icon size={10} aria-hidden className={`shrink-0 ${graded.tone}`} />}
      <span className={`truncate ${graded?.tone ?? ""}`}>{pick.name}</span>
      {number && <span className="shrink-0 text-dim">{number}</span>}
      <span className="sr-only">
        {" "}
        {pickSideLabel(pick.market, pick.side, pick.line, game.home.abbr, game.away.abbr)}
        {pick.result ? `, ${pick.result}` : ""}
      </span>
    </li>
  );
}
