/// <reference types="node" />
/** How the player sheet sizes its art (artSide). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ART_FLOOR, artSide } from './artSide';

// The iOS sheet over its first Track row (app/player.tsx): 318pt that holds, 64pt of title, subtitle and facts lines
// and the 25pt "Tracks" line.
const above = { fixed: 318, rowLines: 64, plainLines: 25 };

test('the art keeps the content width while the first Track row shows, then shrinks to its floor', () => {
  // An iPhone 17 Pro: 402pt less two 24pt sides, 874pt less the 62pt status bar, the 10pt sheet drop and the 34pt home
  // indicator. An iPhone SE: 375pt less the sides, 667pt less its 20pt status bar and the drop.
  const cases: [content: number, visible: number, fontScale: number, side: number][] = [
    [354, 768, 1, 354],
    [354, 768, 1.118, 350], // 768 - 318 - 89 x 1.118 = 350.5
    [327, 637, 1.353, ART_FLOOR], // 637 - 318 - 89 x 1.353 = 198.6
    [354, 700, 0.823, 297], // the Type lines hold their 64pt below the default size: 700 - 318 - 64 - 25 x 0.823 = 297.4
  ];
  for (const [content, visible, fontScale, side] of cases) assert.equal(artSide(content, visible, fontScale, above), side, `${visible} at ${fontScale}`);
});
