"use client";

import type { CSSProperties } from "react";
import { funOn, useFunPrefs } from "../../lib/fun-mode";

/**
 * Weather on the glass (FUN-3): the stored forecast, rendered on the card.
 * Rain streaks, snow, wind drift, a frost rim on the hard-cold games — so a
 * November night game LOOKS like a November night game.
 *
 * Fun Mode only, and an overlay by construction: absolutely positioned,
 * pointer-events none, aria-hidden, zero effect on layout. Particles are a
 * couple dozen plain-CSS spans (no canvas, no rAF), each a full-height strip
 * whose streak sweeps through on a negative-delay loop so the sky is never
 * empty on mount. All positions derive from the index — Math.random() would
 * disagree with itself across server and client renders.
 *
 * Thresholds echo the card's existing weather flags: precip at 50%, wind at
 * 20mph (the totals flag territory), snow when freezing, frost below 25°F.
 */

export interface WeatherView {
  tempF: number | null;
  windMph: number | null;
  precipProb: number | null;
}

type WxKind = "rain" | "snow" | "frost";

export function weatherKind(w: WeatherView | null): WxKind | null {
  if (!w) return null;
  const freezing = w.tempF !== null && w.tempF <= 32;
  const precip = w.precipProb !== null && w.precipProb >= 50;
  if (precip) return freezing ? "snow" : "rain";
  if (w.tempF !== null && w.tempF <= 25) return "frost";
  return null;
}

export function WeatherGlass({ weather }: { weather: WeatherView | null }) {
  const [prefs] = useFunPrefs();
  const kind = weatherKind(weather);
  if (!funOn(prefs, "weatherFx") || !kind) return null;

  const wind = weather?.windMph ?? 0;
  // Horizontal travel per fall: reads as wind above the flag threshold,
  // as ordinary drift below it.
  const drift = wind >= 20 ? Math.min(48, Math.round(wind * 1.5)) : kind === "snow" ? 10 : 4;
  const count = kind === "rain" ? 22 : kind === "snow" ? 14 : 0;

  return (
    <div
      className="fun-wx"
      data-kind={kind}
      aria-hidden
      style={{ "--wx-drift": `${drift}px` } as CSSProperties}
    >
      {Array.from({ length: count }, (_, i) => (
        <i
          key={i}
          style={
            {
              left: `${(i * 37 + 11) % 100}%`,
              "--wx-dur": `${(kind === "rain" ? 0.9 : 3.4) + ((i * 29) % 10) / (kind === "rain" ? 14 : 6)}s`,
              "--wx-delay": `-${((i * 53) % 100) / 20}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
