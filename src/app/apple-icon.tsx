import { ImageResponse } from "next/og";

// iOS Add-to-Home-Screen tile (audit 08/UX-13): without a raster apple-icon,
// Safari screenshots the page. The manifest's SVG covers Android/maskable;
// this is the 180×180 Apple wants. Mirrors icon.svg (the goalpost mark).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#12100D",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 118,
            height: 76,
            borderRadius: 38,
            background: "#F2B63C",
            transform: "rotate(-24deg)",
            color: "#12100D",
            fontSize: 60,
            fontWeight: 800,
          }}
        >
          H
        </div>
      </div>
    ),
    size,
  );
}
