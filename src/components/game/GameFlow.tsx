import { flowExtremes, gameFlowPoints, OT_BAND_END, type GameFlow as Flow } from "../../lib/game-flow";
import type { ScoringPlayRow } from "../../lib/scoring";
import { fmtPct } from "../../lib/slate";

/**
 * The Game Flow river (R5-B): the finished game's win probability, start to
 * gun — the model's number flowing between the two team colors, every
 * scoring play a marked dot, the lead changes countable at a glance.
 *
 * Server-rendered SVG, the MovementChart idiom: fixed viewBox, recessive
 * gridlines, tabular mono labels, no client JS. The ScoringTimeline directly
 * beneath is this chart's data table. Identity is never color-alone — the
 * team labels sit at the chart's poles in text ink, and the caption names
 * the prior's source honestly ("model prior" for CFB, "market prior" for
 * the NFL, which has no model by design).
 *
 * Renders nothing without clocked plays or a pregame number: an invented
 * curve on a betting product is worse than absence.
 */

interface FlowTeam {
  id: number;
  abbr: string;
  color: string | null;
}

export function GameFlow({
  plays,
  home,
  away,
  pregame,
  finalHome,
  finalAway,
}: {
  plays: ScoringPlayRow[];
  home: FlowTeam;
  away: FlowTeam;
  pregame: { margin: number; source: "model" | "market" } | null;
  finalHome: number | null;
  finalAway: number | null;
}) {
  if (pregame === null || finalHome === null || finalAway === null) return null;
  const flow: Flow = gameFlowPoints({
    plays,
    pregameMargin: pregame.margin,
    finalHome,
    finalAway,
  });
  if (flow.points.length < 3) return null;

  const w = 640;
  const h = 170;
  const padX = 8;
  const padTop = 14;
  const padBottom = 26;
  const xEnd = flow.overtime ? OT_BAND_END : 1;

  const x = (v: number) => padX + (v / xEnd) * (w - padX * 2);
  const y = (p: number) => padTop + (1 - p) * (h - padTop - padBottom);

  const line = flow.points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.x).toFixed(1)},${y(p.prob).toFixed(1)}`)
    .join(" ");
  // The river's two banks: home's color above the curve, away's below.
  const homeArea = `${line} L${x(xEnd).toFixed(1)},${y(1).toFixed(1)} L${x(0).toFixed(1)},${y(1).toFixed(1)} Z`;
  const awayArea = `${line} L${x(xEnd).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;

  const homeColor = home.color ?? "var(--push)";
  const awayColor = away.color ?? "var(--push)";
  const colorFor = (teamId: number | null) =>
    teamId === home.id ? homeColor : teamId === away.id ? awayColor : "var(--push)";

  const { flips } = flowExtremes(flow.points);
  const startProb = flow.points[0].prob;
  const marks = flow.points.filter((p) => p.mark);
  const boundaries = [0.25, 0.5, 0.75, ...(flow.overtime ? [1] : [])];
  const qLabels = [
    { cx: 0.125, label: "Q1" },
    { cx: 0.375, label: "Q2" },
    { cx: 0.625, label: "Q3" },
    { cx: 0.875, label: "Q4" },
    ...(flow.overtime ? [{ cx: (1 + OT_BAND_END) / 2, label: "OT" }] : []),
  ];

  return (
    <section className="card mt-4 overflow-hidden">
      <header className="flex items-center justify-between border-b border-chalk/8 px-4 py-2.5">
        <h2 className="text-sm text-accent">Game flow</h2>
        <span className="stat text-[11px] text-dim">
          {flips === 0 ? "wire to wire" : `${flips} lead ${flips === 1 ? "change" : "changes"}`}
        </span>
      </header>
      <figure className="px-4 pb-3 pt-2">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="h-40 w-full"
          role="img"
          aria-label={`Win probability through the game: ${home.abbr} from ${fmtPct(startProb)} pregame to ${
            finalHome > finalAway ? "the win" : finalHome < finalAway ? "the loss" : "a tie"
          }, ${flips} lead ${flips === 1 ? "change" : "changes"}. Scoring plays listed below.`}
        >
          <path d={homeArea} fill={homeColor} fillOpacity="0.13" />
          <path d={awayArea} fill={awayColor} fillOpacity="0.13" />
          {/* the 50/50 line — the one gridline that means something */}
          <line
            x1={padX}
            x2={w - padX}
            y1={y(0.5)}
            y2={y(0.5)}
            stroke="var(--line-strong)"
            strokeWidth="1"
            strokeDasharray="3 4"
          />
          {boundaries.map((b) => (
            <line
              key={b}
              x1={x(b)}
              x2={x(b)}
              y1={padTop}
              y2={h - padBottom}
              stroke="var(--line)"
              strokeWidth="1"
            />
          ))}
          <path
            d={line}
            fill="none"
            stroke="var(--text)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {marks.map((p, i) => (
            <circle
              key={i}
              cx={x(p.x)}
              cy={y(p.prob)}
              r="3"
              fill={colorFor(p.scoringTeamId)}
              stroke="var(--bg)"
              strokeWidth="1.5"
            />
          ))}
          {/* identity at the poles, in text ink — never color alone */}
          <text
            x={padX}
            y={padTop - 4}
            fontSize="10"
            fill="var(--text-dim)"
            fontFamily="var(--font-numeric), monospace"
          >
            {home.abbr} win
          </text>
          <text
            x={padX}
            y={h - padBottom + 11}
            fontSize="10"
            fill="var(--text-dim)"
            fontFamily="var(--font-numeric), monospace"
          >
            {away.abbr} win
          </text>
          {qLabels.map((q) => (
            <text
              key={q.label}
              x={x(q.cx)}
              y={h - 7}
              textAnchor="middle"
              fontSize="10"
              fill="var(--text-dim)"
              fontFamily="var(--font-numeric), monospace"
            >
              {q.label}
            </text>
          ))}
        </svg>
        <figcaption className="stat text-[11px] text-dim">
          Pregame {fmtPct(startProb)} {home.abbr} · {pregame.source === "model" ? "model" : "market"}{" "}
          prior
          {flow.unclocked > 0
            ? ` · ${flow.unclocked} ${flow.unclocked === 1 ? "play" : "plays"} without a clock not drawn`
            : ""}
        </figcaption>
      </figure>
    </section>
  );
}
