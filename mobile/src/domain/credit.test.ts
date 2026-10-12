/// <reference types="node" />
/**
 * The credit line's one extra name (task 0071, decision 11): the four ways a Page and a credit relate, a compilation,
 * a Release nothing credited (decision 18), and names that differ only in case and spacing.
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
