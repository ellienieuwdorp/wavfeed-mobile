/// <reference types="node" />
/**
 * Times the store's view reads on a long history (task 0036): 10,000 synthetic Stories over 3,000 Releases, 500 Fans
 * and 400 Pages folded over `node:sqlite`, against the domain rules alone, then a small fold and a rebuild. That each
 * read answers what the rules answer is src/store/queries.test.ts. Run: `npm run perf`.
 */
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { enterHistory, makeHistory, oracleRows } from '../../../test/history';
import { openTestStore } from '../../../test/nodeDb';
import { buildBoughtChart } from '../../domain/boughtChart';
import { buildCrossedList } from '../../domain/boughtCrossed';
import { buildCurated } from '../../domain/curate';
import { fold, rebuild } from '../projection';
import { listStoryRows, readBought, readCurated, readNewReleases } from '../queries';
import { insertRawDocument } from '../rawDocuments';

const NOW = new Date(Date.UTC(2026, 8, 25, 12, 0, 0));
const SIZE = { pages: 400, releases: 3000, fans: 500, purchases: 6000, wishes: 2000 };

async function time(label: string, work: () => Promise<unknown>, runs = 5): Promise<void> {
  await work();
  const spent: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    await work();
    spent.push(performance.now() - start);
  }
  spent.sort((a, b) => a - b);
  console.log(`${label.padEnd(28)} median ${(spent[Math.floor(runs / 2)] ?? 0).toFixed(1).padStart(7)} ms   max ${(spent[runs - 1] ?? 0).toFixed(1).padStart(7)} ms`);
}

async function main(): Promise<void> {
  const file = join(tmpdir(), 'wavfeed-perf.db');
  for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true });
  const { db, close } = await openTestStore(file);

  const buildStart = performance.now();
  const later = await enterHistory(db, makeHistory(SIZE, NOW), NOW, 100);
  await fold(db);
  const count = async (table: string): Promise<number> => (await db.getFirstAsync<{ n: number }>(`select count(*) as n from ${table}`))?.n ?? 0;
  console.log(`built in ${((performance.now() - buildStart) / 1000).toFixed(1)} s: stories ${await count('stories')}, releases ${await count('releases')}, fans ${await count('fans')}, pages ${await count('pages')}, raw ${await count('raw_documents')}`);

  await time('listStoryRows', () => listStoryRows(db));
  await time('readNewReleases', () => readNewReleases(db, { now: NOW }));
  await time('readBought released', () => readBought(db, { mode: 'released', now: NOW }));
  await time('readBought crossed 2', () => readBought(db, { mode: 'crossed', threshold: 2, now: NOW }));
  await time('readCurated', () => readCurated(db));

  const rows = await oracleRows(db);
  await time('rules only: bought', async () => buildBoughtChart(rows));
  await time('rules only: crossed 2', async () => buildCrossedList(rows, 2));
  await time('rules only: curated', async () => buildCurated(rows));

  for (const doc of later) await insertRawDocument(db, doc);
  const foldStart = performance.now();
  const summary = await fold(db);
  console.log(`${`fold of ${later.length} documents`.padEnd(28)} ${(performance.now() - foldStart).toFixed(1).padStart(14)} ms   (${summary.storiesUpserted} stories)`);
  const rebuildStart = performance.now();
  await rebuild(db);
  console.log(`${'rebuild'.padEnd(28)} ${(performance.now() - rebuildStart).toFixed(1).padStart(14)} ms`);
  close();
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
