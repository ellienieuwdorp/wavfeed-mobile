/// <reference types="node" />
/**
 * The credit line's one extra name (task 0071, decision 11): the four ways a Page and a credit relate, a compilation,
 * a Release nothing credited (decision 18), and one act spelled two ways by its Page and its credit (the author's
 * request of 2026-10-15, shapes read off a real store).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { creditLine } from './credit';

test('the credit line names the artist, then the Page when it is not the artist, else the label credit', () => {
  const cases = [
    ['the artist on their own Page', { pageName: 'Madctrl', artistCredit: 'Madctrl', label: null }, ['Madctrl', null]],
    ['the artist on their own Page with a label credit', { pageName: 'Carré', artistCredit: 'Carré', label: 'Tempa.' }, ['Carré', 'Tempa.']],
    ['another artist on a label\'s Page', { pageName: 'Nyege Nyege Tapes', artistCredit: 'Jay Mitta', label: null }, ['Jay Mitta', 'Nyege Nyege Tapes']],
    ['another artist and a different label credit', { pageName: '2247', artistCredit: 'Anna Kost', label: 'Sounds of Bleak' }, ['Anna Kost', '2247']],
    ['a compilation', { pageName: 'Cassette Weather', artistCredit: 'Various Artists', label: 'Cassette Weather' }, ['Various Artists', 'Cassette Weather']],
    ['nothing credited', { pageName: 'Halfmoon Tapes', artistCredit: null, label: 'Halfmoon Tapes' }, ['Halfmoon Tapes', null]],
    ['a blank credit', { pageName: 'Halfmoon Tapes', artistCredit: '  ', label: null }, ['Halfmoon Tapes', null]],
    ['the same names in other case and spacing', { pageName: ' nightgraft ', artistCredit: 'Nightgraft', label: 'NIGHTGRAFT' }, ['Nightgraft', null]],
  ] as const;
  for (const [shape, release, [artist, extra]] of cases) {
    assert.deepEqual(creditLine(release), { artist, extra }, shape);
  }
});

test('a Page and a credit that spell one act two ways name it once, then the label credit', () => {
  const cases = [
    ['run together and lower case', { pageName: 'sirspyro', artistCredit: 'Sir Spyro', label: 'Deep Medi Musik' }, 'Deep Medi Musik'],
    ['camel case', { pageName: 'DirtyDaveP', artistCredit: 'Dirty Dave P', label: null }, null],
    ['an underscore', { pageName: 'Lorenzo_BITW', artistCredit: 'Lorenzo BITW', label: null }, null],
    ['a hyphen', { pageName: 'Walt-J', artistCredit: 'Walt J', label: null }, null],
    ['initials with stops', { pageName: 'CPI', artistCredit: 'C.P.I.', label: 'Hivern Discs' }, 'Hivern Discs'],
    ['punctuation moved', { pageName: 'Godspeed You! Black Emperor', artistCredit: 'Godspeed You Black Emperor!', label: 'kranky' }, 'kranky'],
    ['brackets', { pageName: '(Liv).e', artistCredit: 'Liv.e', label: 'In Real Life' }, 'In Real Life'],
    ['an accent', { pageName: 'Onur Ozman', artistCredit: 'Onur Özman', label: null }, null],
    ['an emoji', { pageName: 'DJ Strawberry🍓', artistCredit: 'DJ Strawberry', label: 'appendix.files' }, 'appendix.files'],
    ['a leading "the"', { pageName: 'Mountain People', artistCredit: 'The Mountain People', label: null }, null],
    ['"&" and "and"', { pageName: 'Kode9 and The Spaceape', artistCredit: 'Kode9 & The Spaceape', label: 'Hyperdub' }, 'Hyperdub'],
    ['non-breaking and zero-width spaces', { pageName: 'Nina\u00a0Kraviz', artistCredit: 'Nina\u200bKraviz', label: null }, null],
    ['a label credit spelled as the artist', { pageName: 'Tromac', artistCredit: 'Tromac', label: 'TROMAC.' }, null],
  ] as const;
  for (const [shape, release, extra] of cases) {
    assert.deepEqual(creditLine(release), { artist: release.artistCredit, extra }, shape);
  }
});

test('names that share their letters only in part stay apart', () => {
  const cases = [
    ['a collaboration', { pageName: 'Tromac', artistCredit: 'Tromac & Cadeem LaMarr', label: null }, 'Tromac'],
    ['a longer crew name', { pageName: 'TREKKIE TRAX', artistCredit: 'TREKKIE TRAX CREW', label: null }, 'TREKKIE TRAX'],
    ['"the" inside a name', { pageName: 'Source', artistCredit: 'The Source Experience', label: null }, 'Source'],
    ['names of symbols alone', { pageName: '★', artistCredit: '☆', label: null }, '★'],
  ] as const;
  for (const [shape, release, extra] of cases) {
    assert.deepEqual(creditLine(release), { artist: release.artistCredit, extra }, shape);
  }
});
