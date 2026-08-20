import { sanitizeForCard } from "../../../lib/share-card";

/**
 * The Wrapped story card (R5-C): one fact, stated huge, on the brand ground
 * (BRAND §5 hexes — satori has no CSS variables). Same 1080×1350 canvas and
 * font set as the bets card; the S-stamp is typographic because the card
 * must render with zero network.
 */

const BG = "#020A08";
const CHALK = "#F4EFE2";
const GOLD = "#E8B93D";
const DIM = "#8FA79B";
const LINE = "rgba(244, 239, 226, 0.18)";
const DISPLAY = "Graduate";
const BODY = "Archivo";
const NUM = "PlexMono";

export interface WrappedCardModel {
  year: number;
  eyebrow: string;
  headline: string;
  detail: string | null;
  sub: string | null;
}

export function WrappedShareCard({ model }: { model: WrappedCardModel }) {
  const headline = sanitizeForCard(model.headline);
  // The headline is the card: scale it to fit its own length.
  const size = headline.length <= 6 ? 220 : headline.length <= 10 ? 150 : 96;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: BG,
        padding: "72px 84px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: NUM,
          fontSize: 26,
          letterSpacing: 6,
          color: GOLD,
        }}
      >
        <span>THE SLATE WRAPPED</span>
        <span>{String(model.year)}</span>
      </div>
      <div style={{ display: "flex", borderTop: `2px solid ${GOLD}`, marginTop: 22 }} />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
        }}
      >
        <span
          style={{
            fontFamily: NUM,
            fontSize: 30,
            letterSpacing: 8,
            color: DIM,
            textTransform: "uppercase",
          }}
        >
          {sanitizeForCard(model.eyebrow)}
        </span>
        <span
          style={{
            fontFamily: NUM,
            fontWeight: 600,
            fontSize: size,
            lineHeight: 1.05,
            color: CHALK,
            marginTop: 28,
          }}
        >
          {headline}
        </span>
        {model.detail && (
          <span
            style={{
              fontFamily: BODY,
              fontSize: 34,
              lineHeight: 1.4,
              color: CHALK,
              marginTop: 34,
              maxWidth: 860,
            }}
          >
            {sanitizeForCard(model.detail)}
          </span>
        )}
        {model.sub && (
          <span style={{ fontFamily: NUM, fontSize: 26, color: DIM, marginTop: 20 }}>
            {sanitizeForCard(model.sub)}
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: `1px solid ${LINE}`,
          paddingTop: 26,
        }}
      >
        <span style={{ fontFamily: DISPLAY, fontSize: 34, color: CHALK, letterSpacing: 4 }}>
          THE SLATE
        </span>
        <span style={{ fontFamily: NUM, fontSize: 24, color: DIM }}>the receipts remember</span>
      </div>
    </div>
  );
}
