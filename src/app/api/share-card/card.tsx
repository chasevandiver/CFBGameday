/**
 * The share card, as satori draws it.
 *
 * A direct port of `public/design/share-card-d.html`, which is the reference
 * render and where all four hero states can be looked at side by side. That
 * mockup was deliberately built flexbox-only with no grid and no `gap` so this
 * port would be mechanical, and it was — the numbers below are the mockup's.
 *
 * Presentation only. Every decision (what leads, what groups, what the heading
 * says, what the clock reads) is made by `buildCardModel` in share-card.ts, so
 * the promotion rule can be tested without rendering a PNG.
 *
 * Rules satori imposes that a browser does not:
 *  - flexbox only, and anything with more than one child needs an explicit
 *    `display: flex`
 *  - no `gap`; margins do the spacing
 *  - a missing glyph is a tofu box, not a fallback — see `sanitizeForCard`
 *  - remote images are fetched by satori itself with no timeout and no way to
 *    fall back, so logos arrive here already inlined (`resolveLogos`)
 */

import { BRAND } from "../../../lib/brand";
import { SLATE_MARK_ASPECT, SLATE_MARK_DATA_URI } from "../../../lib/brand-mark-data";
import {
  cardMetrics,
  formatOdds,
  formatUnits,
  sanitizeForCard,
  titleFontSize,
  type CardMetrics,
  type CardModel,
  type RenderBet,
  type ShareCardTeam,
} from "../../../lib/share-card";

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

/** The dim green all three existing OG routes already use. Not a BRAND token. */
const DIM = "#8FA79B";
const HAIRLINE = "rgba(244,239,226,0.20)";
const ROW_RULE = "rgba(244,239,226,0.10)";

const DISPLAY = "Graduate";
const BODY = "Archivo";
const NUM = "PlexMono";

export type Logos = Map<string, string>;

/* ── ground: field texture and the green→gold rim light (§7, §10) ─────────── */

function Ground() {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        display: "flex",
      }}
    >
      {[108, 216, 324, 432, 540, 648, 756, 864, 972].map((x, i) => (
        <div
          key={x}
          style={{
            position: "absolute",
            left: x,
            top: 0,
            width: 2,
            height: CARD_HEIGHT,
            // Every third is a five-yard marker. At this opacity the field
            // reads as tooth rather than as stripes — it is a texture, not the
            // subject.
            background: i % 3 === 0 ? "rgba(244,239,226,0.048)" : "rgba(244,239,226,0.028)",
            display: "flex",
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          left: -240,
          top: -280,
          width: 900,
          height: 900,
          background:
            "radial-gradient(circle at center, rgba(14,59,44,0.85) 0%, rgba(14,59,44,0) 68%)",
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -300,
          bottom: -340,
          width: 950,
          height: 950,
          background:
            "radial-gradient(circle at center, rgba(232,185,61,0.13) 0%, rgba(232,185,61,0) 66%)",
          display: "flex",
        }}
      />
    </div>
  );
}

/* ── crests ───────────────────────────────────────────────────────────────── */

/**
 * A team's crest, or the coloured monogram `TeamMark` already falls back to on
 * screen when a logo is broken — same fallback, so the card degrades the way
 * the app does instead of inventing a third behaviour.
 */
function Crest({
  team,
  logos,
  size,
  gap,
}: {
  team: ShareCardTeam | null;
  logos: Logos;
  size: number;
  gap?: boolean;
}) {
  const overlap = gap ? { marginLeft: Math.round(size * 0.14) } : {};
  const data = team?.logo ? logos.get(team.logo) : undefined;
  if (data) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={data} width={size} height={size} alt="" style={{ ...overlap, display: "flex" }} />
    );
  }
  return (
    <div
      style={{
        ...overlap,
        width: size,
        height: size,
        borderRadius: size / 2,
        background: team?.color ?? BRAND.raisedGreen,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: BODY,
        fontWeight: 700,
        fontSize: Math.round(size * 0.33),
        color: BRAND.chalk,
      }}
    >
      {sanitizeForCard((team?.abbr ?? "").slice(0, 3).toUpperCase())}
    </div>
  );
}

/**
 * Away then home, the order the matchup string reads in.
 *
 * A future has no game and therefore no teams at all. The monogram is no help
 * there — it would draw an empty coloured circle, which is what the first
 * render of this card actually did — so the slot takes the S instead. It keeps
 * its width either way, because the picks below it have to stay left-aligned
 * down the card.
 *
 * They sit side by side with a small gap rather than overlapping. The first
 * version tucked the home crest under the away one, which looks right for
 * artwork with transparent padding and wrong for everything else: CFBD's
 * college logos fill their square, so UNC's monogram came out half-hidden
 * behind TCU's. Two filled monogram discs collide the same way. A gap is
 * duller and always legible.
 */
function Crests({
  bet,
  logos,
  size,
  width,
  marginRight,
}: {
  bet: RenderBet;
  logos: Logos;
  size: number;
  width: number;
  marginRight: number;
}) {
  const teamless = !bet.away && !bet.home;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", width, marginRight }}>
      {teamless ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={SLATE_MARK_DATA_URI}
          height={size}
          width={Math.round(size * SLATE_MARK_ASPECT)}
          alt=""
          style={{ opacity: 0.5, display: "flex" }}
        />
      ) : (
        <>
          <Crest team={bet.away} logos={logos} size={size} />
          {bet.home ? <Crest team={bet.home} logos={logos} size={size} gap /> : null}
        </>
      )}
    </div>
  );
}

/* ── hero ─────────────────────────────────────────────────────────────────── */

function Hero({
  bet,
  logos,
  solo,
}: {
  bet: RenderBet & { heading: string };
  logos: Logos;
  solo: boolean;
}) {
  return (
    <div
      style={{ position: "relative", display: "flex", padding: "0 56px", marginTop: solo ? 40 : 28 }}
    >
      <div
        style={{
          position: "absolute",
          left: 6,
          top: -100,
          width: 1068,
          height: 660,
          background:
            "radial-gradient(ellipse at 34% 48%, rgba(232,185,61,0.18) 0%, rgba(232,185,61,0) 62%)",
          display: "flex",
        }}
      />
      <div
        style={{
          position: "relative",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          background: BRAND.raisedGreen,
          borderRadius: 10,
          padding: "30px 34px 30px 30px",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 8,
            height: "100%",
            background: BRAND.gold,
            borderTopLeftRadius: 10,
            borderBottomLeftRadius: 10,
            display: "flex",
          }}
        />
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 30,
            letterSpacing: "0.15em",
            color: BRAND.gold,
            textTransform: "uppercase",
            display: "flex",
          }}
        >
          {bet.heading}
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", marginTop: 22 }}>
          {/* 2.14x the crest, the same side-by-side arithmetic the rows use.
              The first version carried the old overlap width here and the home
              crest sat on top of the matchup line. */}
          <Crests bet={bet} logos={logos} size={110} width={Math.round(110 * 2.14)} marginRight={28} />
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 700,
                fontSize: 68,
                lineHeight: 1.02,
                color: BRAND.chalk,
                display: "flex",
              }}
            >
              {sanitizeForCard(bet.pick)}
            </div>
            <div
              style={{ fontFamily: BODY, fontSize: 25, color: DIM, marginTop: 10, display: "flex" }}
            >
              {sanitizeForCard(bet.matchup)}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "baseline",
                marginTop: 22,
              }}
            >
              <div
                style={{
                  fontFamily: NUM,
                  fontWeight: 500,
                  fontSize: 40,
                  color: BRAND.gold,
                  display: "flex",
                }}
              >
                {formatUnits(bet.units)}
              </div>
              <div
                style={{
                  fontFamily: NUM,
                  fontWeight: 500,
                  fontSize: 23,
                  color: DIM,
                  marginLeft: 20,
                  letterSpacing: "0.06em",
                  display: "flex",
                }}
              >
                {formatOdds(bet.odds)}
                {bet.kickLong ? ` · ${bet.kickLong}` : ""}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── rows ─────────────────────────────────────────────────────────────────── */

function TierHeading({ heading, lean }: { heading: string; lean: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: 30,
        marginTop: 16,
      }}
    >
      <div
        style={{
          width: 9,
          height: 9,
          background: lean ? "rgba(143,167,155,0.55)" : BRAND.gold,
          marginRight: 15,
          display: "flex",
        }}
      />
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: 24,
          letterSpacing: "0.11em",
          textTransform: "uppercase",
          color: lean ? DIM : BRAND.chalk,
          display: "flex",
        }}
      >
        {heading}
      </div>
      <div style={{ flex: 1, height: 1, background: HAIRLINE, marginLeft: 20, display: "flex" }} />
    </div>
  );
}

function Row({ bet, logos, m }: { bet: RenderBet; logos: Logos; m: CardMetrics }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: m.rowH,
        // A surface, but only on a card short enough to need one. Same raised
        // green and radius as the hero, so this is the existing material
        // language rather than a second one.
        ...(m.panel
          ? {
              background: BRAND.raisedGreen,
              borderRadius: 10,
              paddingLeft: 28,
              paddingRight: 28,
              marginBottom: m.panelGap,
            }
          : {}),
      }}
    >
      <Crests
        bet={bet}
        logos={logos}
        size={m.crest}
        width={m.crestSlot}
        marginRight={22}
      />
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 700,
            fontSize: m.pick,
            lineHeight: 1.05,
            color: BRAND.chalk,
            display: "flex",
          }}
        >
          {sanitizeForCard(bet.pick)}
        </div>
        <div
          style={{ fontFamily: BODY, fontSize: m.matchup, color: DIM, marginTop: 6, display: "flex" }}
        >
          {sanitizeForCard(bet.matchup)}
        </div>
      </div>
      {/* Fixed width, and every stake printed to one decimal: the column that
          registers is the entire argument for shipping an image over text. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          width: m.numsW,
        }}
      >
        <div
          style={{
            fontFamily: NUM,
            fontWeight: 500,
            fontSize: m.units,
            color: BRAND.gold,
            display: "flex",
          }}
        >
          {formatUnits(bet.units)}
        </div>
        <div
          style={{
            fontFamily: NUM,
            fontWeight: 500,
            fontSize: m.sub,
            color: DIM,
            marginTop: 6,
            letterSpacing: "0.04em",
            display: "flex",
            whiteSpace: "nowrap",
          }}
        >
          {formatOdds(bet.odds)} · {bet.kickShort}
        </div>
      </div>
    </div>
  );
}

/* ── the card ─────────────────────────────────────────────────────────────── */

export function ShareCard({ model, logos }: { model: CardModel; logos: Logos }) {
  const rows = model.groups.reduce((n, g) => n + g.bets.length, 0);
  // Row size, type size and the watermark all come from the row count — a
  // two-bet slip is the common case and must not render at seven-bet sizes.
  const m = cardMetrics(rows, model.groups.length, !!model.hero);

  return (
    <div
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        background: BRAND.nearBlack,
      }}
    >
      <Ground />

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          padding: "46px 56px 0",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div
            style={{
              fontFamily: DISPLAY,
              // Shrinks to stay on one line: a wrapped title makes the header
              // taller than the row budget assumes.
              fontSize: titleFontSize(model.title),
              lineHeight: 1.02,
              color: BRAND.chalk,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              display: "flex",
            }}
          >
            {sanitizeForCard(model.title)}
          </div>
          <div
            style={{
              fontFamily: NUM,
              fontWeight: 500,
              fontSize: 22,
              letterSpacing: "0.18em",
              color: DIM,
              textTransform: "uppercase",
              marginTop: 13,
              display: "flex",
            }}
          >
            {sanitizeForCard(model.subtitle)}
          </div>
        </div>
        {/* §31: the icon appears as a small brand stamp, never a headline. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={SLATE_MARK_DATA_URI}
          height={78}
          width={Math.round(78 * SLATE_MARK_ASPECT)}
          alt=""
          style={{ display: "flex" }}
        />
      </div>

      {/* One centred region between the header and the footer.
          Leftover space is the normal case here — a fixed canvas holding a
          variable-length list, and the list is usually short. The first version
          stacked the content at the top and dumped the slack underneath, which
          on a real two-bet slip read as a card that had failed to load. Now the
          slack is split above and below, and the S sits *behind* the content
          rather than in the hole below it, so the space reads as ground (§23)
          instead of as absence. On a full card the region fills and both
          effects vanish on their own. */}
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          // Centred. An earlier pass top-aligned this because centring thin
          // rows opened a gap under the header that read as a rendering fault
          // — but sparse cards draw panels now, and a panel has enough weight
          // to sit in the middle of a poster. On a full card the slack is
          // small and centring is indistinguishable from top-aligning.
          justifyContent: "center",
        }}
      >
        {m.markH > 0 ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={SLATE_MARK_DATA_URI}
              height={m.markH}
              width={Math.round(m.markH * SLATE_MARK_ASPECT)}
              alt=""
              style={{ opacity: 0.06, display: "flex" }}
            />
          </div>
        ) : null}

      {model.hero ? <Hero bet={model.hero} logos={logos} solo={rows === 0} /> : null}

      {rows > 0 ? (
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            padding: "0 56px",
            marginTop: 26,
          }}
        >
          {model.groups.map((g) => (
            <div
              key={`${g.heading}:${g.bets[0].key}`}
              style={{ display: "flex", flexDirection: "column" }}
            >
              <TierHeading heading={g.heading} lean={g.lean} />
              {g.bets.map((b, i) => (
                <div key={b.key} style={{ display: "flex", flexDirection: "column" }}>
                  {i > 0 && !m.panel ? (
                    <div style={{ height: 1, background: ROW_RULE, display: "flex" }} />
                  ) : null}
                  <Row bet={b} logos={logos} m={m} />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}


      </div>

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          padding: "0 56px 42px",
          marginTop: 26,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 56,
            right: 56,
            top: -20,
            height: 1,
            background: "rgba(244,239,226,0.16)",
            display: "flex",
          }}
        />
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 24,
            letterSpacing: "0.20em",
            color: BRAND.chalk,
            textTransform: "uppercase",
            display: "flex",
          }}
        >
          The Slate
        </div>
        <div
          style={{
            fontFamily: NUM,
            fontWeight: 500,
            fontSize: 24,
            color: BRAND.gold,
            marginLeft: "auto",
            letterSpacing: "0.06em",
            display: "flex",
          }}
        >
          {model.count} {model.count === 1 ? "bet" : "bets"} · {formatUnits(model.units)}
          {model.overflow > 0 ? ` · +${model.overflow} more` : ""}
        </div>
      </div>
    </div>
  );
}
