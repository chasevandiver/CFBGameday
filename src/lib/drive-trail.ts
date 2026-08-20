/**
 * Drive trail (FUN-14): the last few observed ball positions on a field
 * strip, so a march down the field is visible as a march. Pure fold over
 * what the strip actually saw — nothing interpolated, nothing invented.
 *
 * A possession change starts a fresh trail (the old drive is over), a repeat
 * of the same spot is dropped (dead-ball re-renders), and the history is
 * capped so the strip shows a drive's recent shape, not its whole biography.
 */

export interface TrailState {
  poss: string | null;
  /** Oldest → newest observed x positions (percent across the strip). */
  xs: number[];
}

export const EMPTY_TRAIL: TrailState = { poss: null, xs: [] };

export function foldTrail(
  state: TrailState,
  x: number,
  poss: string | null,
  cap = 5,
): TrailState {
  if (poss !== state.poss) return { poss, xs: [x] };
  const last = state.xs[state.xs.length - 1];
  if (last === x) return state;
  return { poss, xs: [...state.xs, x].slice(-cap) };
}
