import { ImageResponse } from "next/og";
import { BRAND, slateMarkSvg } from "../../../lib/brand";
import { createClient } from "../../../lib/supabase/server";
import { consensusFromSnapshots } from "../../../lib/consensus";
import { fmtSpread } from "../../../lib/slate";

// Per-matchup link card (audit 08/UX-12): a shared /game link renders the
// scorebug — teams, the consensus spread, kickoff — instead of a bare URL.
// Runs on the node runtime because it reads Supabase via the server client.
export const alt = "Matchup on The CFB Slate";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Same stamp the site card uses, inlined so the card never depends on a fetch.
const MARK = `data:image/svg+xml;base64,${Buffer.from(slateMarkSvg()).toString("base64")}`;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gameId = Number(id);
  const brand = (main: string, sub = "") => (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: BRAND.nearBlack,
        color: BRAND.chalk,
        textAlign: "center",
        padding: "80px",
      }}
    >
      <div style={{ fontSize: 84, fontWeight: 800 }}>{main}</div>
      {sub ? <div style={{ fontSize: 40, color: "#8FA79B", marginTop: 20 }}>{sub}</div> : null}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 40 }}>
        <img src={MARK} width={40} height={40} alt="" />
        <div style={{ fontSize: 28, letterSpacing: 4, color: BRAND.gold, textTransform: "uppercase" }}>
          The CFB Slate
        </div>
      </div>
    </div>
  );

  if (!Number.isInteger(gameId)) return new ImageResponse(brand("The CFB Slate"), size);

  const supabase = await createClient();
  const { data: game } = await supabase
    .from("games")
    .select("home_team_id, away_team_id, start_ts")
    .eq("id", gameId)
    .maybeSingle();
  if (!game) return new ImageResponse(brand("The CFB Slate"), size);

  const [{ data: teams }, { data: snaps }] = await Promise.all([
    supabase.from("teams").select("id, school, abbreviation").in("id", [game.home_team_id, game.away_team_id]),
    supabase.from("line_snapshots").select("game_id, provider, spread, total, captured_at").eq("game_id", gameId),
  ]);
  const abbr = (tid: number) => {
    const t = (teams ?? []).find((x: { id: number }) => x.id === tid);
    return t?.abbreviation ?? t?.school?.slice(0, 4).toUpperCase() ?? "TBD";
  };
  const home = abbr(game.home_team_id);
  const away = abbr(game.away_team_id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const consensus = consensusFromSnapshots((snaps ?? []) as any);
  const spread = consensus.spread === null ? null : `${home} ${fmtSpread(consensus.spread)}`;
  const kick = game.start_ts
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(game.start_ts)) + " CT"
    : "TBD";

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND.nearBlack,
          color: BRAND.chalk,
          padding: "70px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 40, fontSize: 130, fontWeight: 800 }}>
          <span>{away}</span>
          <span style={{ fontSize: 60, color: "#8FA79B" }}>@</span>
          <span>{home}</span>
        </div>
        <div style={{ fontSize: 44, color: BRAND.gold, marginTop: 36 }}>
          {spread ?? "line pending"}
        </div>
        <div style={{ fontSize: 34, color: "#8FA79B", marginTop: 16 }}>{kick}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 44, opacity: 0.72 }}>
          <img src={MARK} width={38} height={38} alt="" />
          <div style={{ fontSize: 26, letterSpacing: 4, color: BRAND.chalk, textTransform: "uppercase" }}>
            The CFB Slate
          </div>
        </div>
      </div>
    ),
    size,
  );
}
