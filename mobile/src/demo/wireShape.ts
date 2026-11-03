/**
 * What the Demo and the simulator rig's sample share when they write documents the way the wire does: Bandcamp's date
 * format and a seeded generator, so the same load writes the same documents.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export type Rng = () => number;

/** mulberry32. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}

/** Bandcamp's own format, "18 Aug 2026 07:28:27 GMT". */
export function wireDate(ms: number): string {
  const d = new Date(ms);
  const time = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`;
  return `${two(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? 'Jan'} ${d.getUTCFullYear()} ${time} GMT`;
}
