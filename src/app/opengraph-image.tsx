import { ImageResponse } from "next/og";

// Site-wide link card: a bare URL in the group chat becomes a branded tile
// (audit 08/UX-12). Code-generated — no asset, no external font fetch.
export const runtime = "edge";
export const alt = "The CFB Slate";
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
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "80px",
          background: "#12100D",
          color: "#F2EEE5",
        }}
      >
        <div style={{ fontSize: 34, letterSpacing: 6, color: "#F2B63C", textTransform: "uppercase" }}>
          Saturdays, settled
        </div>
        <div style={{ fontSize: 120, fontWeight: 800, lineHeight: 1.05, marginTop: 16 }}>
          The CFB Slate
        </div>
        <div style={{ fontSize: 40, color: "#A89F90", marginTop: 24 }}>
          Ratings · edges · pick&apos;em · the crew ledger
        </div>
      </div>
    ),
    size,
  );
}
