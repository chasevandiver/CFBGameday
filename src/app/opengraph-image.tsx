import { ImageResponse } from "next/og";
import { BRAND } from "../lib/brand";
import { SLATE_MARK_ASPECT, SLATE_MARK_DATA_URI } from "../lib/brand-mark-data";

// Site-wide link card: a bare URL in the group chat becomes a branded tile
// (audit 08/UX-12). Code-generated — no asset, no external font fetch.
export const runtime = "edge";
export const alt = "The Slate";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "80px",
          // The icon's ground, so a shared link and the home-screen tile read
          // as the same product.
          background: BRAND.nearBlack,
          color: BRAND.chalk,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <div
            style={{
              fontSize: 34,
              letterSpacing: 6,
              color: BRAND.gold,
              textTransform: "uppercase",
            }}
          >
            Saturdays, settled
          </div>
          <div style={{ fontSize: 116, fontWeight: 800, lineHeight: 1.05, marginTop: 16 }}>
            The Slate
          </div>
          <div style={{ fontSize: 38, color: "#8FA79B", marginTop: 24 }}>
            Ratings · edges · pick&apos;em · the crew ledger
          </div>
        </div>
        {/* A stamp, not a headline — §31 puts the type first on share cards.
            The mark is inlined (src/lib/brand-mark-data.ts) because this runs on
            the edge, and a card that must reach the network to draw its own logo
            is one that sometimes ships without one. */}
        <img
          src={SLATE_MARK_DATA_URI}
          height={230}
          width={Math.round(230 * SLATE_MARK_ASPECT)}
          alt=""
        />
      </div>
    ),
    size,
  );
}
