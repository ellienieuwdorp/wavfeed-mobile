/**
 * How the heart draws each state (DESIGN-UI section 12): its outline's colour, always at full opacity so the shape
 * clears 3:1 on the page, and the opacity of the wishlist fill under it, at rest and at the top of the pending pulse
 * (review VIS-3, VIS-M5). Pending keeps the last confirmed shape and marks the press by the fill: a remove on its way
 * holds the fill at 0.4 under the rim, an add on its way leaves it empty, and the pulse lifts either by 0.3. Under
 * reduce motion the fill stays at rest, so a pending remove still differs from on and a pending add from off by its
 * outline's colour.
 */
export type HeartState = { known: boolean; wishlisted: boolean; pending: boolean };

export type HeartLook = {
  outline: 'faint' | 'edge';
  /** The fill's opacity at rest and at the top of the pulse; null draws no fill. */
  fill: { rest: number; peak: number } | null;
};

const PENDING_FILL = 0.4;
const PULSE_LIFT = 0.3;

export function heartLook({ known, wishlisted, pending }: HeartState): HeartLook {
  if (!known) return { outline: 'faint', fill: null };
  if (pending) {
    const rest = wishlisted ? PENDING_FILL : 0;
    return { outline: 'edge', fill: { rest, peak: rest + PULSE_LIFT } };
  }
  return wishlisted ? { outline: 'edge', fill: { rest: 1, peak: 1 } } : { outline: 'faint', fill: null };
}
