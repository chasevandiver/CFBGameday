/**
 * Two sport glyphs the icon set does not have (NAV-2), drawn to its
 * conventions — 24px box, 2px round stroke, `currentColor` — so they sit in
 * the bottom bar beside the library's icons as the same family.
 */

interface IconProps {
  size?: number | string;
  "aria-hidden"?: boolean;
}

const base = (size: number | string | undefined) => ({
  width: size ?? 24,
  height: size ?? 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

/** A basketball: the ball, its two seams and the curved ribs either side. */
export function BasketballIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2v20" />
      <path d="M5.2 4.7c2.6 2 4.1 4.6 4.1 7.3s-1.5 5.3-4.1 7.3" />
      <path d="M18.8 4.7c-2.6 2-4.1 4.6-4.1 7.3s1.5 5.3 4.1 7.3" />
    </svg>
  );
}

/** A football on the diagonal, with its laces. */
export function FootballIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M3.5 20.5c-1-6 .7-10.800 3.900-13.900S15 2.500 20.500 3.500c1 6-.7 10.800-3.900 13.900S9.500 21.500 3.500 20.500z" />
      <path d="M9.500 14.500l5-5M11 11l2 2M13 9l2 2M9 13l2 2" />
    </svg>
  );
}
