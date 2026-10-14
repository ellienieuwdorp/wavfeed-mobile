#!/usr/bin/env node
/**
 * Renders the Feed and New releases tab glyphs (task 0071, decision 2) to `assets/tabs/` at 24pt, one image per state
 * at @1x, @2x and @3x, black on transparent: the tab bars draw them as templates, so only the alpha counts and the
 * tint is the bar's. The selected calendar's day dot is cut out of its fill, so the bar's ground shows through it.
 * Settings keeps the system gear. Chromium draws the SVG, from any project that has Playwright installed:
 * `node scripts/tab-glyphs.mjs <path inside that project>`.
 */
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const POINTS = 24;
const SCALES = [1, 2, 3];
const OUT = new URL('../assets/tabs/', import.meta.url);

const CRESTS = 'M2 12 C3.7 12 3.6 9.3 5.3 9.3 C7 9.3 7 14.7 8.7 14.7 C10.4 14.7 10.3 9.3 12 9.3 C13.7 9.3 13.7 14.7 15.3 14.7 C17 14.7 17 9.3 18.7 9.3 C20.4 9.3 20.3 12 22 12';
const RECT = 'x="4.5" y="6" width="15" height="13.5" rx="3.25"';
const TABS = 'M9 4 V8 M15 4 V8';
const DOT = 'cx="14.5" cy="15.25" r="1.75"';
const stroke = (width = 2, fill = 'none') => `fill="${fill}" stroke="#000" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;

const GLYPHS = {
  feed: `<path d="${CRESTS}" ${stroke()}/>`,
  'feed-selected': `<path d="${CRESTS}" ${stroke(2.75)}/>`,
  releases: `<rect ${RECT} ${stroke()}/><path d="${TABS}" ${stroke()}/><circle ${DOT} fill="#000"/>`,
  'releases-selected':
    `<mask id="knock" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><circle ${DOT} fill="#000"/></mask>`
    + `<g mask="url(#knock)"><rect ${RECT} ${stroke(2, '#000')}/><path d="${TABS}" ${stroke()}/></g>`,
};

const from = process.argv[2];
if (from === undefined) {
  console.error('usage: node scripts/tab-glyphs.mjs <path inside a project with playwright installed>');
  process.exit(1);
}
const { chromium } = createRequire(resolve(from, 'package.json'))('playwright');
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const scale of SCALES) {
    const page = await browser.newPage({ deviceScaleFactor: scale, viewport: { width: POINTS, height: POINTS } });
    for (const [name, body] of Object.entries(GLYPHS)) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${POINTS}" height="${POINTS}" viewBox="0 0 24 24">${body}</svg>`;
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
      const file = `${name}${scale === 1 ? '' : `@${scale}x`}.png`;
      await page.screenshot({ path: new URL(file, OUT).pathname, omitBackground: true });
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`Rendered ${Object.keys(GLYPHS).length} tab glyphs at ${SCALES.map((s) => `@${s}x`).join(', ')} into assets/tabs.`);
