/** The player's strings (DESIGN-UI sections 8 and 10, task 0036), from the web's PlayerBar.tsx, until `src/copy.ts` takes them. */
export const playerCopy = {
  open: (title: string) => `Open the player for ${title}`,
  play: 'Play',
  pause: 'Pause',
  previous: 'Previous track',
  next: 'Next track',
  buy: 'Buy on Bandcamp ↗',
  buyLabel: 'Buy on Bandcamp',
  trackTitle: (n: number, title: string) => `${n}. ${title}`,
  openOnBandcamp: (title: string) => `Open ${title} on Bandcamp`,
  seek: (title: string) => `Position in ${title}`,
  unplayable: 'No preview on Bandcamp',
  error: "Can't play this right now",
} as const;
