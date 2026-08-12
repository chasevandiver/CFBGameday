import { ImageResponse } from "next/og";

/**
 * Link card for the demo, inherited by `/demo/slate`.
 *
 * The site-wide tile one segment up says what the product is; this one has a
 * different job, because this is the link that actually gets sent to people.
 * It previews the thing the screens are built around — a live score with a
 * verdict on it — and it says "sample data" on its face, so a card sitting in
 * a group chat carries the same disclaimer the page does.
 *
 * Code-generated, like the root tile: no asset, no external font fetch.
 */
export const runtime = "edge";
export const alt = "The CFB Slate — a live demo with invented games and invented money";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The brand palette, mirroring the runtime tokens in globals.css. Literal here
// rather than imported from CSS because this renders on the edge with no
// stylesheet — but they must move together.
const BG = "#020A08";
const SURFACE = "#0B2E23";
const TEXT = "#F4EFE2";
const DIM = "#8FA79B";
const ACCENT = "#E8B93D";
const WIN = "#35A46F";
const LOSS = "#E4572E";

/** One team's line in the mock scorebug, on its own colour rail. */
function Row({
  rail,
  name,
  score,
}: {
  rail: string;
  name: string;
  score: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <div style={{ width: 6, height: 46, background: rail, borderRadius: 3 }} />
      <div style={{ fontSize: 38, fontWeight: 700, color: TEXT, width: 200 }}>{name}</div>
      <div style={{ fontSize: 44, fontWeight: 800, color: TEXT }}>{score}</div>
    </div>
  );
}

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 64,
          padding: "80px",
          background: BG,
          color: TEXT,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 26,
              letterSpacing: 5,
              color: ACCENT,
              textTransform: "uppercase",
            }}
          >
            <div style={{ width: 12, height: 12, borderRadius: 6, background: ACCENT }} />
            Sample data
          </div>
          <div style={{ fontSize: 88, fontWeight: 800, lineHeight: 1.05, marginTop: 18 }}>
            The CFB Slate
          </div>
          <div style={{ fontSize: 31, color: DIM, marginTop: 18, lineHeight: 1.35 }}>
            A Saturday, mid-afternoon — every game you have money on, and whether it’s covering.
          </div>
          <div
            style={{
              display: "flex",
              gap: 14,
              marginTop: 30,
              fontSize: 22,
              color: DIM,
              letterSpacing: 1,
            }}
          >
            <div style={{ display: "flex" }}>Ratings</div>
            <div style={{ display: "flex", color: `${DIM}66` }}>·</div>
            <div style={{ display: "flex" }}>Edges</div>
            <div style={{ display: "flex", color: `${DIM}66` }}>·</div>
            <div style={{ display: "flex" }}>Pick’em</div>
            <div style={{ display: "flex", color: `${DIM}66` }}>·</div>
            <div style={{ display: "flex" }}>The crew ledger</div>
          </div>
        </div>

        {/* The card, roughly as the slate draws it: a verdict strip, two teams
            on their colour rails, and the money underneath. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 440,
            background: SURFACE,
            border: `1px solid ${LOSS}55`,
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 12,
              padding: "14px 22px",
              background: `${LOSS}22`,
              borderLeft: `6px solid ${LOSS}`,
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 700, fontStyle: "italic", color: LOSS }}>
              NOT COVERING
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, fontStyle: "italic", color: LOSS }}>−7</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "24px 22px" }}>
            <Row rail="#BB0000" name="Ohio State" score="21" />
            <Row rail="#00274C" name="Michigan" score="24" />
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
              <div
                style={{
                  display: "flex",
                  fontSize: 22,
                  color: ACCENT,
                  border: `1px solid ${ACCENT}`,
                  borderRadius: 6,
                  padding: "4px 10px",
                }}
              >
                OSU −3
              </div>
              <div style={{ display: "flex", fontSize: 22, color: WIN }}>O 44.5 hit</div>
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
