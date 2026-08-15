import { ImageResponse } from "next/og";
import { BRAND } from "../../lib/brand";
import { SLATE_MARK_ASPECT, SLATE_MARK_DATA_URI } from "../../lib/brand-mark-data";

/**
 * Link card for `/welcome`.
 *
 * The site-wide tile one segment up is for a bare URL dropped in the crew's own
 * chat — people who already know what this is. This one is the card a stranger
 * sees, so it carries the four numbers the page opens with rather than a
 * tagline: the tile has to survive being the only thing somebody reads.
 *
 * Code-generated on the edge, like the others — no asset fetch, no font fetch.
 */
export const runtime = "edge";
export const alt = "The Slate — ratings, edges, pick'em and the crew ledger";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const DIM = "#8FA79B";

/** One number and its label, matching the page's own stat rail. */
function Stat({ figure, label }: { figure: string; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderLeft: `2px solid ${BRAND.chalk}26`,
        paddingLeft: 18,
        width: 236,
      }}
    >
      <div style={{ fontSize: 46, fontWeight: 800, color: BRAND.chalk }}>{figure}</div>
      <div style={{ fontSize: 19, color: DIM, marginTop: 6, lineHeight: 1.3 }}>{label}</div>
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
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: BRAND.nearBlack,
          color: BRAND.chalk,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                fontSize: 27,
                letterSpacing: 5,
                color: BRAND.gold,
                textTransform: "uppercase",
              }}
            >
              College football · NFL
            </div>
            <div style={{ fontSize: 104, fontWeight: 800, lineHeight: 1.05, marginTop: 14 }}>
              The Slate
            </div>
            <div style={{ fontSize: 33, color: DIM, marginTop: 18, lineHeight: 1.35 }}>
              Every game and every dollar riding on it, on one screen.
            </div>
          </div>
          <img
            src={SLATE_MARK_DATA_URI}
            height={150}
            width={Math.round(150 * SLATE_MARK_ASPECT)}
            alt=""
          />
        </div>

        <div style={{ display: "flex", gap: 22 }}>
          <Stat figure="136" label="FBS teams rated every week" />
          <Stat figure="4" label="rating systems per game" />
          <Stat figure="2" label="leagues, one ledger" />
          <Stat figure="0" label="predictions edited after the fact" />
        </div>
      </div>
    ),
    size,
  );
}
