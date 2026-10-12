/**
 * The credit line under a Release's title, "artist · X" (task 0071, decision 11): X is the Page's name when the Page
 * is not the artist credit, else the label credit, else nothing; a different Page wins over a label credit, and with
 * no artist credit held the Page's name stands alone (decision 18). The parts come back apart so a row can truncate
 * the artist credit last.
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

function nameKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Two names for the same act, read past case, width and spacing ("Tempa" and " TEMPA "). */
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
