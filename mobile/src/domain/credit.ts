/**
 * The credit line under a Release's title, "artist · X" (task 0071, decision 11): X is the Page's name when the Page
 * is not the artist credit, else the label credit, else nothing; a different Page wins over a label credit, and with
 * no artist credit held the Page's name stands alone (decision 18). A Page's name and a Release's credit are often two
 * spellings of one act ("sirspyro" and "Sir Spyro", "CPI" and "C.P.I.", "Onur Ozman" and "Onur Özman"), so names are
 * compared by their letters and digits and the line never says one act twice (the author's request of 2026-10-15). The
 * parts come back apart so a row can truncate the artist credit last.
 */

export type CreditLine = {
  /** The artist credit, or the Page's name when nothing credited anyone. */
  readonly artist: string;
  /** The one extra name after the separator, or null. */
  readonly extra: string | null;
};

export type CreditSource = {
  readonly pageName: string;
  readonly artistCredit: string | null;
  readonly label: string | null;
};

/** Accents on Latin, Greek and Cyrillic letters once decomposed, the only marks a spelling of a name drops. */
const ACCENTS = /[̀-ͯ]/g;
/** Everything but letters and digits: spacing of any width, punctuation, underscores, emoji, zero-width characters. */
const NOT_LETTERS = /[^\p{L}\p{N}]+/gu;

/**
 * A name read past case, width, accents, punctuation and spacing, with "&" read as "and" and a leading "the" dropped
 * ("DirtyDaveP" and "Dirty Dave P", "Godspeed You! Black Emperor" and "Godspeed You Black Emperor!", "Mountain People"
 * and "The Mountain People"). A name of symbols alone keys on its trimmed, folded self.
 */
function nameKey(name: string): string {
  const folded = name.normalize('NFKD').replace(ACCENTS, '').toLowerCase();
  const words = folded.replace(/&/g, ' and ').trim().replace(/^the\s+/, '');
  const letters = words.replace(NOT_LETTERS, '');
  return letters === '' ? folded.trim().replace(/\s+/g, ' ') : letters;
}

function sameName(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b);
}

function present(name: string | null): string | null {
  return name === null || name.trim() === '' ? null : name.trim();
}

export function creditLine(release: CreditSource): CreditLine {
  const artist = present(release.artistCredit);
  if (artist === null) return { artist: release.pageName, extra: null };
  if (!sameName(release.pageName, artist)) return { artist, extra: release.pageName };
  const label = present(release.label);
  return { artist, extra: label === null || sameName(label, artist) ? null : label };
}
