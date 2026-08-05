"use client";

/**
 * Game-card redesign — every lifecycle state, stacked for phone scrolling.
 * Self-contained preview: component, styles, and sample data in one file so
 * the card system can be judged on a phone before it replaces GameCard.
 *
 * Type: Barlow Condensed carries team names and the cover verdict because a
 * condensed athletic grotesque reads like a broadcast scorebug at arm's
 * length, while IBM Plex Mono with tabular figures sets every number — score,
 * clock, spread, margin, distance — so digits hold their column while the
 * feed scrolls. Color: the base is a warm charcoal (#141110 family) that sits
 * quietly on OLED at 11pm, with each team's primary color washing only its
 * half of the card so a glance binds score to school without reading.
 * One amber (#FFB428) is reserved exclusively for cover status — it never
 * appears anywhere else, so amber on screen always means "your number is in
 * play right now."
 */

import { useEffect, useRef, useState } from "react";

/* =====================================================================
   Sample-data types (local to the preview; the real card will read
   GameView + a crew-picks join)
   ===================================================================== */

interface Team {
  school: string;
  abbr: string;
  color: string;
  /** ESPN logo id */
  logoId: number;
  rank: number | null;
  record: string | null;
}

interface CrewMate {
  name: string;
  initials: string;
  /** their pick'em record today */
  record: string;
}

interface Pick {
  side: "home" | "away";
  /** spread from the picked team's perspective, e.g. LSU -2.5 → -2.5 */
  line: number;
}

interface LiveGame {
  kind: "live";
  id: number;
  away: Team;
  home: Team;
  awayPts: number;
  homePts: number;
  period: number;
  clock: string;
  possession: "home" | "away";
  down: number;
  distance: number | "Goal";
  /** field spot as a broadcast prints it, e.g. "LSU 41" */
  spot: string;
  redZone: boolean;
  /** possession changed since the user last had the app open */
  possFlipped: boolean;
  lastPlay: string;
  pick: Pick;
  crewWith: CrewMate[];
  crewAgainst: CrewMate[];
}

interface PregameGame {
  kind: "pre";
  id: number;
  away: Team;
  home: Team;
  kickoff: string;
  tv: string;
  /** home-perspective spread, negative = home favored */
  spread: number;
  total: number;
  /** model's home-perspective number */
  modelSpread: number;
  myPick: Pick | null;
  crewAway: number;
  crewHome: number;
}

interface FinalGame {
  kind: "final";
  id: number;
  away: Team;
  home: Team;
  awayPts: number;
  homePts: number;
  ot: boolean;
  pick: Pick;
}

type Card = LiveGame | PregameGame | FinalGame;

/* =====================================================================
   Cover math + formatting
   ===================================================================== */

type CoverTier = "covering" | "bubble" | "losing";

/** Points the pick is covering by (negative = not covering). */
function coverMargin(pick: Pick, homePts: number, awayPts: number): number {
  const margin = pick.side === "home" ? homePts - awayPts : awayPts - homePts;
  return margin + pick.line;
}

/** Bubble = within a field goal of the number, either side of it. */
function coverTier(cm: number): CoverTier {
  if (Math.abs(cm) <= 3) return "bubble";
  return cm > 0 ? "covering" : "losing";
}

/** Broadcast-style margin: 1.5 → "1½", 0.5 → "½", 7 → "7". */
function fmtHalf(n: number): string {
  const a = Math.abs(n);
  const whole = Math.trunc(a);
  const half = a % 1 !== 0;
  if (whole === 0 && half) return "½";
  return `${whole}${half ? "½" : ""}`;
}

function fmtMargin(cm: number): string {
  if (cm === 0) return "EVEN";
  return `${cm > 0 ? "+" : "−"}${fmtHalf(cm)}`;
}

function fmtLine(line: number): string {
  if (line === 0) return "PK";
  return line > 0 ? `+${line}` : `−${Math.abs(line)}`;
}

const DOWN = ["", "1st", "2nd", "3rd", "4th"];
const Q = ["", "1st", "2nd", "3rd", "4th", "OT", "2OT"];

function underTwo(period: number, clock: string): boolean {
  if (period !== 2 && period !== 4) return false;
  const m = /^(\d+):(\d\d)$/.exec(clock);
  return m !== null && Number(m[1]) < 2;
}

const logoUrl = (id: number) => `https://a.espncdn.com/i/teamlogos/ncaa/500-dark/${id}.png`;

/* =====================================================================
   Shared bits
   ===================================================================== */

function Logo({ team, dim = false }: { team: Team; dim?: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`gc-logo ${dim ? "gc-logo-dim" : ""}`}>
      {!broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl(team.logoId)}
          alt=""
          width={48}
          height={48}
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="gc-logo-fallback" style={{ background: team.color }}>
          {team.abbr.slice(0, 3)}
        </span>
      )}
    </span>
  );
}

function TeamName({ team }: { team: Team }) {
  return (
    <span className="gc-name">
      {team.school}
      {team.rank !== null && <sup className="gc-rank">{team.rank}</sup>}
    </span>
  );
}

/** Possession marker — a tiny football, unmistakable at a glance. */
function Ball() {
  return (
    <svg className="gc-ball" width="17" height="11" viewBox="0 0 17 11" role="img" aria-label="has possession">
      <ellipse cx="8.5" cy="5.5" rx="7.8" ry="4.7" fill="#9A6430" stroke="#5C3A18" strokeWidth="0.8" />
      <path
        d="M5.4 5.5h6.2M6.9 4.2v2.6M8.5 4.2v2.6M10.1 4.2v2.6"
        stroke="#F4EFE6"
        strokeWidth="0.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* =====================================================================
   Cover strip — the loudest element on a live card
   ===================================================================== */

function CoverStrip({ cm, pickLabel }: { cm: number; pickLabel: string }) {
  const tier = coverTier(cm);
  const word =
    tier === "covering" ? "Covering" : tier === "losing" ? "Not covering" : cm === 0 ? "On the number" : "On the bubble";
  return (
    <div className={`gc-cover gc-cover-${tier}`}>
      <span className="gc-cover-word">{word}</span>
      <span className="gc-cover-margin">{fmtMargin(cm)}</span>
      {tier === "bubble" && <span className="gc-cover-sub">a FG flips it</span>}
      <span className="gc-cover-pick">Pick {pickLabel}</span>
    </div>
  );
}

/* =====================================================================
   Crew standing — who else is riding this side
   ===================================================================== */

function CrewLine({
  withMe,
  against,
  pickTeam,
  oppTeam,
}: {
  withMe: CrewMate[];
  against: CrewMate[];
  pickTeam: Team;
  oppTeam: Team;
}) {
  return (
    <div className="gc-crew">
      <span className="gc-crew-avs" style={{ "--tc": pickTeam.color } as React.CSSProperties}>
        {withMe.map((c) => (
          <i key={c.name} className="gc-av" title={`${c.name} ${c.record}`}>
            {c.initials}
          </i>
        ))}
      </span>
      <span className="gc-crew-with">
        {withMe.length === 0
          ? "Only you on this side"
          : withMe.map((c) => `${c.name} ${c.record}`).join(" · ") + " with you"}
      </span>
      {against.length > 0 && (
        <span className="gc-crew-fade">
          {against.map((c) => c.name).join(", ")} on {oppTeam.abbr}
        </span>
      )}
    </div>
  );
}

/* =====================================================================
   LIVE card — the hero
   ===================================================================== */

function LiveCard({ g }: { g: LiveGame }) {
  // score-pop when a number ticks so a reopened app shows what moved
  const prev = useRef({ h: g.homePts, a: g.awayPts });
  const [pop, setPop] = useState<{ side: "home" | "away"; key: number } | null>(null);
  useEffect(() => {
    const p = prev.current;
    if (g.homePts !== p.h) setPop({ side: "home", key: g.homePts });
    else if (g.awayPts !== p.a) setPop({ side: "away", key: g.awayPts });
    prev.current = { h: g.homePts, a: g.awayPts };
  }, [g.homePts, g.awayPts]);

  const cm = coverMargin(g.pick, g.homePts, g.awayPts);
  const tier = coverTier(cm);
  const pickTeam = g.pick.side === "home" ? g.home : g.away;
  const oppTeam = g.pick.side === "home" ? g.away : g.home;
  const posTeam = g.possession === "home" ? g.home : g.away;
  const u2m = underTwo(g.period, g.clock);
  const fourth = g.down === 4;
  const dd = `${DOWN[g.down]} & ${g.distance === "Goal" ? "Goal" : g.distance}`;

  const row = (side: "home" | "away") => {
    const team = side === "home" ? g.home : g.away;
    const pts = side === "home" ? g.homePts : g.awayPts;
    const popping = pop?.side === side;
    return (
      <div
        className={`gc-row ${popping ? "gc-row-pop" : ""}`}
        key={popping ? `${side}-${pop.key}` : side}
        style={{ "--tc": team.color } as React.CSSProperties}
      >
        <span className="gc-rail" aria-hidden />
        <Logo team={team} />
        <TeamName team={team} />
        <span className="gc-row-right">
          {g.possession === side && <Ball />}
          <span className={`gc-score ${popping ? "gc-score-pop" : ""}`}>{pts}</span>
        </span>
      </div>
    );
  };

  return (
    <article className={`gc-card gc-card-live ${tier === "bubble" ? "gc-card-bubble" : ""}`}>
      <CoverStrip cm={cm} pickLabel={`${pickTeam.abbr} ${fmtLine(g.pick.line)}`} />
      <div className="gc-rows">
        {row("away")}
        {row("home")}
      </div>

      <div className={`gc-sitline ${g.redZone ? "gc-sit-rz" : ""}`}>
        <span className="gc-sit">
          {fourth ? <span className="gc-down4">{dd}</span> : <span className="gc-dd">{dd}</span>}
          <span className="gc-spot"> at {g.spot}</span>
          {g.redZone && <span className="gc-rz">Red zone</span>}
          {g.possFlipped && (
            <span
              className="gc-flip"
              style={{ "--tc": posTeam.color } as React.CSSProperties}
              title="Possession changed since you last looked"
            >
              ⟳ {posTeam.abbr} ball
            </span>
          )}
        </span>
        <span className={`gc-clock ${u2m ? "gc-u2m" : ""}`}>
          {Q[g.period]} · {g.clock}
        </span>
      </div>

      <div className="gc-lastplay">
        <span className="gc-lastplay-tag">Last</span> {g.lastPlay}
      </div>

      <CrewLine withMe={g.crewWith} against={g.crewAgainst} pickTeam={pickTeam} oppTeam={oppTeam} />
    </article>
  );
}

/* =====================================================================
   PREGAME card — tap a half to pick it, no confirm step
   ===================================================================== */

function PregameCard({ g }: { g: PregameGame }) {
  const [pick, setPick] = useState<Pick | null>(g.myPick);

  const lineFor = (side: "home" | "away") => (side === "home" ? g.spread : -g.spread);
  const tap = (side: "home" | "away") =>
    setPick((p) => (p?.side === side ? null : { side, line: lineFor(side) }));

  const edge = g.modelSpread - g.spread; // negative → model likes home more than market
  const modelSide = edge < 0 ? g.home : g.away;
  const modelLine = edge < 0 ? g.modelSpread : -g.modelSpread;

  const half = (side: "home" | "away") => {
    const team = side === "home" ? g.home : g.away;
    const on = pick?.side === side;
    const off = pick !== null && !on;
    return (
      <button
        type="button"
        onClick={() => tap(side)}
        aria-pressed={on}
        aria-label={`Pick ${team.school} ${fmtLine(lineFor(side))}`}
        className={`gc-half ${on ? "gc-half-on" : ""} ${off ? "gc-half-off" : ""}`}
        style={{ "--tc": team.color } as React.CSSProperties}
      >
        <span className="gc-rail" aria-hidden />
        <Logo team={team} />
        <span className="gc-half-id">
          <TeamName team={team} />
          {team.record && <span className="gc-record">{team.record}</span>}
        </span>
        <span className="gc-half-line">
          {fmtLine(lineFor(side))}
          {on && <span className="gc-locked">Locked</span>}
        </span>
      </button>
    );
  };

  return (
    <article className="gc-card gc-card-pre">
      <div className="gc-prehead">
        <span>
          {g.kickoff} · {g.tv}
        </span>
        <span>O/U {g.total}</span>
      </div>
      {half("away")}
      {half("home")}
      <div className="gc-prefoot">
        <span className="gc-model">
          Model {modelSide.abbr} {fmtLine(modelLine)}
          {Math.abs(edge) >= 2 && <span className="gc-edge"> · edge {fmtHalf(edge)}</span>}
        </span>
        {pick === null ? (
          <span className="gc-hint">Tap a side to pick</span>
        ) : (
          <span className="gc-split">
            <i
              className="gc-split-bar"
              style={{ "--tc": g.away.color, flexGrow: Math.max(g.crewAway, 0.2) } as React.CSSProperties}
            />
            <i
              className="gc-split-bar"
              style={{ "--tc": g.home.color, flexGrow: Math.max(g.crewHome, 0.2) } as React.CSSProperties}
            />
            <span className="gc-split-label">
              {g.crewAway} {g.away.abbr} · {g.crewHome} {g.home.abbr}
            </span>
          </span>
        )}
      </div>
    </article>
  );
}

/* =====================================================================
   FINAL card — resolved and quiet
   ===================================================================== */

function FinalCard({ g }: { g: FinalGame }) {
  const cm = coverMargin(g.pick, g.homePts, g.awayPts);
  const covered = cm > 0;
  const push = cm === 0;
  const pickTeam = g.pick.side === "home" ? g.home : g.away;

  const row = (side: "home" | "away") => {
    const team = side === "home" ? g.home : g.away;
    const pts = side === "home" ? g.homePts : g.awayPts;
    const opp = side === "home" ? g.awayPts : g.homePts;
    const lost = pts < opp;
    return (
      <div className={`gc-frow ${lost ? "gc-frow-lost" : ""}`} style={{ "--tc": team.color } as React.CSSProperties}>
        <Logo team={team} dim />
        <TeamName team={team} />
        <span className="gc-fscore">{pts}</span>
      </div>
    );
  };

  return (
    <article className="gc-card gc-card-final">
      <div className="gc-finhead">
        <span className={`gc-verdict ${push ? "gc-verdict-push" : covered ? "gc-verdict-win" : "gc-verdict-loss"}`}>
          {push ? "Push" : covered ? "Covered" : "Missed"} {!push && fmtMargin(cm)} · {pickTeam.abbr}{" "}
          {fmtLine(g.pick.line)}
        </span>
        <span className="gc-finlabel">Final{g.ot ? " / OT" : ""}</span>
      </div>
      {row("away")}
      {row("home")}
    </article>
  );
}

/* =====================================================================
   Sample slate — sorted the way the feed sorts: bubble and danger first,
   comfortable live next, pregame after, finals sink
   ===================================================================== */

const T = (school: string, abbr: string, color: string, logoId: number, rank: number | null, record: string): Team => ({
  school,
  abbr,
  color,
  logoId,
  rank,
  record,
});

const LSU = T("LSU", "LSU", "#461D7C", 99, 9, "7-2");
const OLEMISS = T("Ole Miss", "MISS", "#CE1126", 145, 14, "8-1");
const OSU = T("Ohio State", "OSU", "#BB0000", 194, 1, "9-0");
const PSU = T("Penn State", "PSU", "#041E42", 213, 12, "7-2");
const TENN = T("Tennessee", "TENN", "#FF8200", 2633, 8, "8-1");
const OU = T("Oklahoma", "OU", "#841617", 201, 19, "6-3");
const ISU = T("Iowa State", "ISU", "#C8102E", 66, 21, "7-2");
const KSU = T("Kansas State", "KSU", "#512888", 2306, null, "5-4");
const ORE = T("Oregon", "ORE", "#154733", 2483, 3, "9-0");
const UW = T("Washington", "UW", "#4B2E83", 264, null, "6-3");
const USC = T("USC", "USC", "#990000", 30, 17, "7-2");
const MICH = T("Michigan", "MICH", "#00274C", 130, 11, "7-2");
const ND = T("Notre Dame", "ND", "#0C2340", 87, 6, "8-1");
const MIA = T("Miami", "MIA", "#F47321", 2390, 10, "7-2");
const TEX = T("Texas", "TEX", "#BF5700", 251, 5, "8-1");
const ARK = T("Arkansas", "ARK", "#9D2235", 8, null, "4-5");

const JAKE: CrewMate = { name: "Jake", initials: "JK", record: "3-1" };
const MO: CrewMate = { name: "Mo", initials: "MO", record: "2-2" };
const TY: CrewMate = { name: "Ty", initials: "TY", record: "4-0" };
const SAM: CrewMate = { name: "Sam", initials: "SM", record: "1-3" };

/** Bubble + under two minutes: the sweat. Score ticks below to demo the pop. */
const BUBBLE: LiveGame = {
  kind: "live",
  id: 1,
  away: OLEMISS,
  home: LSU,
  awayPts: 23,
  homePts: 24,
  period: 4,
  clock: "1:58",
  possession: "away",
  down: 2,
  distance: 6,
  spot: "LSU 41",
  redZone: false,
  possFlipped: false,
  lastPlay: "Hayes rush up the middle for 6 yds to the LSU 41",
  pick: { side: "home", line: -2.5 },
  crewWith: [JAKE, TY],
  crewAgainst: [SAM],
};

/** Covering, but the other team is at the goal line: green strip, red situation. */
const REDZONE: LiveGame = {
  kind: "live",
  id: 2,
  away: PSU,
  home: OSU,
  awayPts: 14,
  homePts: 28,
  period: 3,
  clock: "4:16",
  possession: "away",
  down: 1,
  distance: "Goal",
  spot: "OSU 4",
  redZone: true,
  possFlipped: false,
  lastPlay: "Reyes pass short left to Warren for 21 yds to the OSU 4",
  pick: { side: "home", line: -6.5 },
  crewWith: [MO],
  crewAgainst: [],
};

/** Fourth down with the cover on the line. */
const FOURTH: LiveGame = {
  kind: "live",
  id: 3,
  away: KSU,
  home: ISU,
  awayPts: 16,
  homePts: 27,
  period: 4,
  clock: "6:40",
  possession: "away",
  down: 4,
  distance: 1,
  spot: "ISU 39",
  redZone: false,
  possFlipped: false,
  lastPlay: "Ramos rush for 4 yds to the ISU 39 — KSU keeping the offense on",
  pick: { side: "home", line: -4.5 },
  crewWith: [JAKE, MO, TY],
  crewAgainst: [],
};

/** Losing, and possession just flipped on a pick-six-saving INT. */
const LOSING: LiveGame = {
  kind: "live",
  id: 4,
  away: OU,
  home: TENN,
  awayPts: 17,
  homePts: 27,
  period: 3,
  clock: "9:21",
  possession: "home",
  down: 1,
  distance: 10,
  spot: "TENN 44",
  redZone: false,
  possFlipped: true,
  lastPlay: "Bailey pass intercepted by Carter, returned 12 yds to the TENN 44",
  pick: { side: "away", line: 3.5 },
  crewWith: [SAM],
  crewAgainst: [JAKE, TY],
};

/** Comfortable: double-digit cushion, low heart rate. */
const COMFY: LiveGame = {
  kind: "live",
  id: 5,
  away: ORE,
  home: UW,
  awayPts: 41,
  homePts: 17,
  period: 4,
  clock: "11:05",
  possession: "home",
  down: 2,
  distance: 9,
  spot: "UW 28",
  redZone: false,
  possFlipped: false,
  lastPlay: "Foster sacked for a loss of 6 at the UW 28",
  pick: { side: "away", line: -13.5 },
  crewWith: [JAKE, MO, TY, SAM],
  crewAgainst: [],
};

const PRE_UNPICKED: PregameGame = {
  kind: "pre",
  id: 6,
  away: MICH,
  home: USC,
  kickoff: "Sat 7:30 PM",
  tv: "FOX",
  spread: -3,
  total: 48.5,
  modelSpread: -6,
  myPick: null,
  crewAway: 2,
  crewHome: 3,
};

const PRE_PICKED: PregameGame = {
  kind: "pre",
  id: 7,
  away: ND,
  home: MIA,
  kickoff: "Sat 6:00 PM",
  tv: "ABC",
  spread: 1.5,
  total: 54.5,
  modelSpread: 3.5,
  myPick: { side: "home", line: 1.5 },
  crewAway: 1,
  crewHome: 4,
};

const FINAL: FinalGame = {
  kind: "final",
  id: 8,
  away: TEX,
  home: ARK,
  awayPts: 38,
  homePts: 20,
  ot: false,
  pick: { side: "away", line: -9.5 },
};

/* =====================================================================
   Page — sticky day header + the sorted stack
   ===================================================================== */

export default function CardRedesignPage() {
  // Demo driver: tick the bubble game's score every 12s so the score-pop and
  // the cover strip's bubble → covering transition can be seen without live
  // data. LSU TD puts the pick a score clear; then back to the one-point sweat.
  const [ticked, setTicked] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setTicked((v) => !v), 12000);
    return () => clearInterval(t);
  }, []);

  const bubble: LiveGame = ticked
    ? {
        ...BUBBLE,
        homePts: 31,
        possession: "away",
        down: 1,
        distance: 10,
        spot: "MISS 25",
        lastPlay: "Harris 12-yd touchdown run, PAT good",
      }
    : BUBBLE;

  const cards: Card[] = [bubble, REDZONE, FOURTH, LOSING, COMFY, PRE_UNPICKED, PRE_PICKED, FINAL];

  return (
    <div className="gc-shell">
      <style>{CSS}</style>
      <header className="gc-sticky">
        <span className="gc-sticky-day">Sat · Week 11</span>
        <span className="gc-sticky-rec">
          You <b>3–1</b> · 2nd of 5
        </span>
      </header>
      <main className="gc-feed">
        {cards.map((c) =>
          c.kind === "live" ? (
            <LiveCard key={c.id} g={c} />
          ) : c.kind === "pre" ? (
            <PregameCard key={c.id} g={c} />
          ) : (
            <FinalCard key={c.id} g={c} />
          ),
        )}
      </main>
    </div>
  );
}

/* =====================================================================
   Styles — warm charcoal, one amber, team color per half
   ===================================================================== */

const CSS = `
.gc-shell {
  --gc-bg: #141110;
  --gc-card: #1c1815;
  --gc-elev: #262019;
  --gc-line: rgba(244, 234, 214, 0.09);
  --gc-text: #f4efe6;
  --gc-dim: #a89d8b;
  --gc-faint: #6f665a;
  --gc-accent: #ffb428;      /* cover status only */
  --gc-accent-ink: #1c1405;
  --gc-win: #46c57f;
  --gc-loss: #f0564f;
  --gc-live: #ff4b57;
  --mono: var(--font-numeric), ui-monospace, "SFMono-Regular", monospace;
  --disp: var(--font-display), var(--font-body), sans-serif;

  min-height: 100dvh;
  background: var(--gc-bg);
  color: var(--gc-text);
  font-family: var(--font-body), system-ui, sans-serif;
}

/* ---- sticky day header ---- */
.gc-sticky {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 430px;
  margin: 0 auto;
  padding: 12px 16px 10px;
  background: color-mix(in srgb, var(--gc-bg) 82%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--gc-line);
}
.gc-sticky-day {
  font-family: var(--disp);
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.gc-sticky-rec {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: var(--gc-dim);
}
.gc-sticky-rec b { color: var(--gc-text); font-weight: 600; }

/* ---- feed ---- */
.gc-feed {
  max-width: 430px;
  margin: 0 auto;
  padding: 12px 12px 96px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ---- card chrome ---- */
.gc-card {
  background: linear-gradient(180deg, var(--gc-card), color-mix(in srgb, var(--gc-card) 88%, #000));
  border: 1px solid var(--gc-line);
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45), 0 10px 28px -14px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.gc-card-bubble {
  border-color: color-mix(in srgb, var(--gc-accent) 55%, transparent);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.45),
    0 0 0 1px color-mix(in srgb, var(--gc-accent) 30%, transparent),
    0 0 26px -8px color-mix(in srgb, var(--gc-accent) 60%, transparent);
}

/* ---- cover strip: tier 1 information ---- */
.gc-cover {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 9px 14px;
}
.gc-cover-word {
  font-family: var(--disp);
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}
.gc-cover-margin {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 19px;
  line-height: 1;
}
.gc-cover-sub {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  opacity: 0.85;
}
.gc-cover-pick {
  margin-left: auto;
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.75;
}
.gc-cover-covering {
  color: var(--gc-win);
  background: linear-gradient(90deg, color-mix(in srgb, var(--gc-win) 15%, transparent), transparent 70%);
  box-shadow: inset 3px 0 0 var(--gc-win);
}
.gc-cover-losing {
  color: var(--gc-loss);
  background: linear-gradient(90deg, color-mix(in srgb, var(--gc-loss) 17%, transparent), transparent 70%);
  box-shadow: inset 3px 0 0 var(--gc-loss);
}
.gc-cover-bubble {
  color: var(--gc-accent-ink);
  background: var(--gc-accent);
  padding-top: 10px;
  padding-bottom: 10px;
}
.gc-cover-bubble .gc-cover-pick { opacity: 0.65; }

/* ---- team rows: tier 2 ---- */
.gc-rows { padding-top: 6px; }
.gc-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 6px 14px 6px 16px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--tc) 15%, transparent), transparent 58%);
}
.gc-rail {
  position: absolute;
  left: 5px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 2px;
  background: var(--tc);
}
.gc-logo { position: relative; width: 48px; height: 48px; flex-shrink: 0; display: inline-flex; }
.gc-logo img { width: 48px; height: 48px; object-fit: contain; }
.gc-logo-dim { opacity: 0.8; }
.gc-logo-fallback {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--disp);
  font-weight: 700;
  font-size: 15px;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}
.gc-name {
  font-family: var(--disp);
  font-weight: 600;
  font-size: 20px;
  letter-spacing: 0.015em;
  line-height: 1.05;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gc-rank {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 10.5px;
  font-weight: 500;
  color: var(--gc-dim);
  margin-left: 3px;
}
.gc-row-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.gc-ball { display: block; }
.gc-score {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 27px;
  line-height: 1;
  min-width: 2ch;
  text-align: right;
}

/* score tick: pop + team-color flash, no waiting, no blinking */
@keyframes gc-pop {
  0% { transform: translateY(-7px) scale(1.16); text-shadow: 0 0 16px var(--tc); }
  55% { transform: none; }
  100% { text-shadow: 0 0 0 transparent; }
}
.gc-score-pop { animation: gc-pop 650ms cubic-bezier(0.22, 1, 0.36, 1) both; }
@keyframes gc-rowflash {
  from { box-shadow: inset 0 0 0 100vmax color-mix(in srgb, var(--tc) 22%, transparent); }
  to { box-shadow: inset 0 0 0 100vmax transparent; }
}
.gc-row-pop { animation: gc-rowflash 900ms ease-out both; }

/* ---- situation line: tier 3 (left) + quarter/clock: tier 4 (right) ---- */
.gc-sitline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 6px 10px 0;
  padding: 7px 6px;
  border-top: 1px solid var(--gc-line);
}
.gc-sit {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.gc-spot { color: var(--gc-dim); font-weight: 500; }
.gc-down4 {
  background: var(--gc-text);
  color: #171310;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
  letter-spacing: 0.02em;
}
.gc-sit-rz {
  background: linear-gradient(90deg, color-mix(in srgb, var(--gc-loss) 17%, transparent), transparent 78%);
  box-shadow: inset 3px 0 0 var(--gc-loss);
  border-top-color: transparent;
  border-radius: 8px;
  padding-left: 10px;
}
.gc-rz {
  background: color-mix(in srgb, var(--gc-loss) 24%, transparent);
  border: 1px solid color-mix(in srgb, var(--gc-loss) 55%, transparent);
  color: #ff938d;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 6px;
}
.gc-flip {
  border: 1px solid color-mix(in srgb, var(--gc-text) 45%, transparent);
  color: var(--gc-text);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 6px;
}
.gc-clock {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  font-weight: 600;
  color: var(--gc-dim);
  flex-shrink: 0;
}
.gc-u2m {
  background: var(--gc-live);
  color: #fff;
  padding: 3px 8px;
  border-radius: 7px;
  font-weight: 700;
}

/* ---- last play: tier 5 ---- */
.gc-lastplay {
  padding: 5px 16px 0;
  font-size: 11.5px;
  color: var(--gc-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gc-lastplay-tag {
  font-family: var(--mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--gc-faint);
  margin-right: 2px;
}

/* ---- crew standing ---- */
.gc-crew {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 9px 10px 0;
  padding: 8px 6px 10px;
  border-top: 1px solid var(--gc-line);
  font-size: 11px;
  color: var(--gc-dim);
  white-space: nowrap;
  overflow: hidden;
}
.gc-crew-avs { display: inline-flex; flex-shrink: 0; }
.gc-av {
  width: 19px;
  height: 19px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--mono);
  font-style: normal;
  font-size: 8px;
  font-weight: 700;
  color: var(--gc-text);
  background: color-mix(in srgb, var(--tc) 32%, var(--gc-elev));
  border: 1px solid color-mix(in srgb, var(--tc) 60%, transparent);
}
.gc-av + .gc-av { margin-left: -5px; }
.gc-crew-with { overflow: hidden; text-overflow: ellipsis; }
.gc-crew-fade { margin-left: auto; flex-shrink: 0; color: var(--gc-faint); }

/* ---- pregame ---- */
.gc-prehead {
  display: flex;
  justify-content: space-between;
  padding: 10px 16px 8px;
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 11.5px;
  color: var(--gc-dim);
}
.gc-half {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  min-height: 64px;
  padding: 6px 14px 6px 16px;
  border: 0;
  text-align: left;
  color: var(--gc-text);
  background: linear-gradient(90deg, color-mix(in srgb, var(--tc) 10%, transparent), transparent 58%);
  cursor: pointer;
  transition:
    filter 320ms cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 320ms cubic-bezier(0.34, 1.56, 0.64, 1),
    background 320ms ease;
  -webkit-tap-highlight-color: transparent;
}
.gc-half-id { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.gc-record {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 10px;
  color: var(--gc-dim);
}
.gc-half-line {
  margin-left: auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 17px;
  flex-shrink: 0;
}
@keyframes gc-spring {
  0% { transform: scale(0.97); }
  55% { transform: scale(1.015); }
  100% { transform: scale(1); }
}
.gc-half-on {
  background: linear-gradient(90deg, color-mix(in srgb, var(--tc) 34%, transparent), color-mix(in srgb, var(--tc) 8%, transparent));
  animation: gc-spring 380ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.gc-half-on .gc-rail { width: 4px; }
.gc-half-off { filter: grayscale(1); opacity: 0.38; }
.gc-locked {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--tc) 45%, #fff);
}
.gc-prefoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 6px 10px 0;
  padding: 8px 6px 10px;
  border-top: 1px solid var(--gc-line);
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  color: var(--gc-dim);
}
.gc-edge { color: var(--gc-text); }
.gc-hint { color: var(--gc-faint); }
.gc-split {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 45%;
}
.gc-split-bar {
  height: 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--tc) 75%, transparent);
}
.gc-split-label { flex-shrink: 0; }

/* ---- final: recedes ---- */
.gc-card-final {
  opacity: 0.6;
  filter: saturate(0.75);
  box-shadow: none;
}
.gc-finhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 14px 4px;
}
.gc-verdict {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid;
}
.gc-verdict-win { color: var(--gc-win); border-color: color-mix(in srgb, var(--gc-win) 45%, transparent); }
.gc-verdict-loss { color: var(--gc-loss); border-color: color-mix(in srgb, var(--gc-loss) 45%, transparent); }
.gc-verdict-push { color: var(--gc-dim); border-color: var(--gc-line); }
.gc-finlabel {
  font-family: var(--mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--gc-faint);
}
.gc-frow {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 4px 14px;
}
.gc-frow:last-child { padding-bottom: 12px; }
.gc-frow .gc-name { font-size: 17px; }
.gc-frow .gc-logo, .gc-frow .gc-logo img, .gc-frow .gc-logo-fallback { width: 48px; height: 48px; }
.gc-frow-lost { opacity: 0.5; }
.gc-fscore {
  margin-left: auto;
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 20px;
}

@media (prefers-reduced-motion: reduce) {
  .gc-score-pop, .gc-row-pop, .gc-half-on { animation: none; }
  .gc-half { transition: none; }
}
`;
