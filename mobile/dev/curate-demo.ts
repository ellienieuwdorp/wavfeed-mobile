/**
 * `node --import ./test/register.mjs dev/curate-demo.ts`: reads the Demo's Releases from public Bandcamp pages and
 * writes `src/demo/releases.ts` (task 0043, decision 4). Each label's /music grid names its newest Releases, and each
 * Release's page is read through the app's own session with no cookie, a second and a half apart (ADR-0001). A page
 * keeps its `tralbum` and `band` blobs as Bandcamp wrote them, less each Track's lyrics and the merch packages.
 */
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BandcampSession } from '@/bandcamp/session';
import type { ItemType } from '@/domain/types';

const LABELS = ['ghostly', 'hyperdub', 'erasedtapes', 'intlanthem', 'stonesthrow', 'kompakt', 'planetmu'];
const PER_LABEL = 8;
const GAP_MS = 1_000;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/demo/releases.ts');
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

type GridItem = { readonly itemType: ItemType; readonly itemId: number; readonly url: string };

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** The grid's `<li data-item-id="album-123">` rows in the label's own order, each with its link's URL less the query. */
function readGrid(html: string, origin: string): GridItem[] {
  const items: GridItem[] = [];
  const pattern = /<li data-item-id="(album|track)-(\d+)"[\s\S]*?<a href="([^"]+)"/g;
  for (const match of html.matchAll(pattern)) {
    const [, kind, itemId, href] = match;
    if (kind === undefined || itemId === undefined || href === undefined) continue;
    const url = new URL(href.replaceAll('&amp;', '&'), origin);
    items.push({ itemType: kind === 'album' ? 'a' : 't', itemId: Number(itemId), url: `${url.origin}${url.pathname}` });
  }
  return items;
}

function trimmed(tralbum: unknown): unknown {
  if (typeof tralbum !== 'object' || tralbum === null) return tralbum;
  const { packages: _packages, ...rest } = tralbum as Record<string, unknown>;
  const trackinfo = Array.isArray(rest.trackinfo)
    ? rest.trackinfo.map((track: unknown) => {
        if (typeof track !== 'object' || track === null) return track;
        const { lyrics: _lyrics, ...kept } = track as Record<string, unknown>;
        return kept;
      })
    : rest.trackinfo;
  return { ...rest, trackinfo };
}

async function main(): Promise<void> {
  const session = new BandcampSession();
  const pages: { readonly fetchedAt: string; readonly payload: unknown }[] = [];
  const seen = new Set<number>();
  for (const label of LABELS) {
    const origin = `https://${label}.bandcamp.com`;
    const response = await fetch(`${origin}/music`, { headers: { 'User-Agent': USER_AGENT } });
    await sleep(GAP_MS);
    if (!response.ok) {
      console.warn(`${label}: /music answered ${response.status}`);
      continue;
    }
    const grid = readGrid(await response.text(), origin).filter((item) => !seen.has(item.itemId));
    let kept = 0;
    for (const item of grid) {
      if (kept === PER_LABEL) break;
      seen.add(item.itemId);
      const answer = await session.fetchReleasePage(item.url, { itemType: item.itemType, itemId: item.itemId });
      await sleep(GAP_MS);
      if (answer.kind !== 'ok' || answer.value.kind !== 'page') {
        console.warn(`${item.url}: ${answer.kind === 'ok' ? answer.value.kind : answer.kind}`);
        continue;
      }
      const { fetchedAt, payload } = answer.value.document;
      const page = payload as { tralbum: unknown };
      pages.push({ fetchedAt, payload: { ...page, tralbum: trimmed(page.tralbum) } });
      kept += 1;
    }
    console.log(`${label}: ${kept} releases`);
  }
  const body = { readAt: new Date().toISOString(), sources: LABELS.map((label) => `https://${label}.bandcamp.com/music`), pages };
  const header = `/** Written by dev/curate-demo.ts (task 0043, decision 4); re-run it rather than editing this. */\nimport type { DemoReleases } from './types';\n\n`;
  await writeFile(OUT, `${header}export const demoReleases: DemoReleases = ${JSON.stringify(body)};\n`);
  console.log(`${pages.length} release pages to ${OUT}`);
}

await main();
