"use client";

import { useState } from "react";
import type { TeamView } from "../../lib/slate";

/**
 * Team logo with a colored-monogram fallback and a subtle team-color glow.
 * `size` is the box in px; the glow reads on dark and stays quiet on light.
 *
 * The prop is the four fields it actually paints rather than a whole
 * `TeamView`, so callers that hold a name and a logo — the daily puzzle's
 * guess list, for one — can use it without inventing ranks and a mascot they
 * do not have. Every existing caller passes a TeamView, which still satisfies
 * this.
 */
export type MarkTeam = Pick<TeamView, "school" | "abbr" | "color" | "logo">;

export function TeamMark({
  team,
  size = 32,
  glow = false,
}: {
  team: MarkTeam;
  size?: number;
  glow?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const color = team.color ?? "var(--push)";

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      {glow && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full opacity-40"
          style={{ background: `radial-gradient(circle, ${color} 0%, transparent 70%)`, filter: "blur(6px)" }}
        />
      )}
      {team.logo && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={team.logo}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          onError={() => setBroken(true)}
          className="relative object-contain"
          style={{ width: size, height: size }}
        />
      ) : (
        <span
          className="scorebug relative flex items-center justify-center rounded-full text-white"
          style={{
            width: size,
            height: size,
            background: color,
            fontSize: Math.max(10, size * 0.34),
            textShadow: "0 1px 2px rgba(0,0,0,.5)",
          }}
        >
          {team.abbr.slice(0, 3)}
        </span>
      )}
    </span>
  );
}
