/// <reference types="node" />
/**
 * `app_opened` and the foreground marker (task 0038): which AppState phases open the app, and when a marker left set
 * means the last process died in the foreground.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { openTestStore } from '../../test/nodeDb';
import { buildErrorReport } from './errorReport';
import { clearForegroundMarker, lifeStep, NEW_LIFE, setForegroundMarker, takeEndedUnexpectedly, type Life } from './lifecycle';
import { enqueueErrorSync, turnSharingOff, turnSharingOn } from './outbox';

const A = '3b9f0c52-8a0e-4c2f-9a41-6f1d2b7e9c10';
const B = 'd4e5f6a7-0000-4000-8000-000000000001';
const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);

function walk(phases: [string, string | null][]): (string | null)[] {
  let life: Life = NEW_LIFE;
  return phases.map(([phase, install]) => {
    const step = lifeStep(life, phase, install);
    life = step.life;
    return step.launch;
  });
}

describe('lifeStep', () => {
  test('the first active is cold, a return from background is warm, and inactive opens nothing', () => {
    assert.deepEqual(
      walk([['active', A], ['inactive', A], ['active', A], ['inactive', A], ['background', A], ['active', A], ['active', A]]),
      ['cold', null, null, null, null, 'warm', null],
    );
  });

  test('nothing opens while sharing is off, and a yes mid-session is that Install\'s cold open', () => {
    assert.deepEqual(walk([['active', null], ['background', null], ['active', null], ['active', A]]), [null, null, null, 'cold']);
  });

  test('a new Install after an off and a yes gets its own cold open, and only the first checks the marker', () => {
    const first = lifeStep(NEW_LIFE, 'active', A);
    assert.equal(first.checkEnded, true);
    const second = lifeStep(first.life, 'active', B);
    assert.deepEqual([second.launch, second.checkEnded], ['cold', false]);
  });

  test('the marker is set at active and cleared at inactive and background, never while off', () => {
    const markers = ['active', 'inactive', 'background', 'unknown'].map((phase) => lifeStep(NEW_LIFE, phase, A).marker);
    assert.deepEqual(markers, ['set', 'clear', 'clear', null]);
    assert.equal(lifeStep(NEW_LIFE, 'active', null).marker, null);
  });
});

describe('the foreground marker', () => {
  let db: SQLiteDatabase;
  beforeEach(async () => {
    ({ db } = await openTestStore());
  });

  test('is not written without a yes', async () => {
    await setForegroundMarker(db, NOW);
    assert.equal(await takeEndedUnexpectedly(db), false);
  });

  test('left set means the process ended in the foreground, once', async () => {
    await turnSharingOn(db, A, NOW);
    await setForegroundMarker(db, NOW);
    assert.equal(await takeEndedUnexpectedly(db), true);
    assert.equal(await takeEndedUnexpectedly(db), false);
  });

  test('cleared at inactive or background means a clean exit', async () => {
    await turnSharingOn(db, A, NOW);
    await setForegroundMarker(db, NOW);
    await clearForegroundMarker(db);
    assert.equal(await takeEndedUnexpectedly(db), false);
  });

  test('a fatal Error Report written after it already tells the story', async () => {
    await turnSharingOn(db, A, NOW);
    await setForegroundMarker(db, NOW);
    const report = buildErrorReport(new TypeError('x'), { t: NOW + 5, source: 'global', fatal: true, screen: 'feed' });
    enqueueErrorSync(db, { errorsWritten: 0 }, report);
    assert.equal(await takeEndedUnexpectedly(db), false);
  });

  test('goes with the yes at an off', async () => {
    await turnSharingOn(db, A, NOW);
    await setForegroundMarker(db, NOW);
    await turnSharingOff(db);
    await turnSharingOn(db, B, NOW);
    assert.equal(await takeEndedUnexpectedly(db), false);
  });
});
