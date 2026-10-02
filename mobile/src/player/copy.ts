/** The player's strings (DESIGN-UI sections 8 and 10, task 0036), from the web's PlayerBar.tsx, until `src/copy.ts` takes them. */
export const playerCopy = {
  /** `note` from playerNote: why nothing plays, said where the inline accessory has no room to show it (VIS-M4). */
  open: (title: string, note: string | null = null) => (note === null ? `Open the player for ${title}` : `Open the player for ${title}, ${note}`),
  play: 'Play',
  pause: 'Pause',
  /** Play's name after a failed load or a stream that died, since a press asks again (VIS-5). */
  retry: 'Try again',
  close: 'Close the player',
  previous: 'Previous track',
  next: 'Next track',
  /** The sheet's link to the Release page, at the end of its facts line; names the place, not a purchase (task 0043, decision 3). */
  bandcampLink: 'Bandcamp ↗',
  trackTitle: (n: number, title: string) => `${n}. ${title}`,
  /** What both of the sheet's links say to a screen reader: the place, not a purchase, App Review guideline 3.1.1(a) (task 0043, decision 3). */
  openOnBandcamp: (title: string) => `Open ${title} on Bandcamp`,
  seek: (title: string) => `Position in ${title}`,
  seekIdle: 'Position in the track',
  unplayable: 'No preview on Bandcamp',
  error: "Can't play this right now",
  tracks: 'Tracks',
  noPreview: 'no preview',
  preview: 'preview',
  playTrack: (n: number, title: string) => `Play ${n}. ${title}`,
  pauseTrack: (n: number, title: string) => `Pause ${n}. ${title}`,
  silentTrack: (n: number, title: string) => `${n}. ${title}, no preview`,
  /** A Track of an Upcoming Release the label has not let out yet (task 0041, decision 5). */
  trackNotOut: (n: number, title: string) => `${n}. ${title}, not out yet`,
  previewTail: 'a short preview',
} as const;
