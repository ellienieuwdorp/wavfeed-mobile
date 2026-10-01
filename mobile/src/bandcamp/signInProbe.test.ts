/// <reference types="node" />
/**
 * When the sign-in sheet probes (finding FLOW-5), driven by the navigation states a WebView sends: a load start, then
 * the settled page, sometimes settled twice.
 */
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

import { PROBE_SETTLE_MS, probeGate, type PageState } from './signInProbe';

const LOGIN = 'https://bandcamp.com/login';
const RESET = 'https://bandcamp.com/forgot_password';
const LANDING = 'https://bandcamp.com/diggerfan';

let probes: number;

beforeEach(() => {
  probes = 0;
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout'] });
});

function visit(states: readonly PageState[]): ReturnType<typeof probeGate> {
  const gate = probeGate(() => {
    probes += 1;
  });
  for (const state of states) gate.navigated(state);
  return gate;
}

const load = (url: string): PageState[] => [
  { url, loading: true },
  { url, loading: false },
];

test('a page that settles past /login probes once it holds still', () => {
  visit([...load(LOGIN), ...load(LANDING)]);
  assert.equal(probes, 0);
  mock.timers.tick(PROBE_SETTLE_MS);
  assert.equal(probes, 1);
});

test('a detour page and the signed-in landing after it each probe, so the landing is not missed', () => {
  const gate = visit([...load(LOGIN), ...load(RESET)]);
  mock.timers.tick(PROBE_SETTLE_MS);
  for (const state of load(LANDING)) gate.navigated(state);
  mock.timers.tick(PROBE_SETTLE_MS);
  assert.equal(probes, 2);
});

test('a redirect chain probes once, at its end', () => {
  visit([...load(LOGIN), ...load('https://bandcamp.com/login_cb'), ...load(LANDING)]);
  mock.timers.tick(PROBE_SETTLE_MS);
  assert.equal(probes, 1);
});

test('the same page settling again with no load between does not probe again, and a reload does', () => {
  const gate = visit([...load(LOGIN), ...load(LANDING)]);
  mock.timers.tick(PROBE_SETTLE_MS);
  gate.navigated({ url: LANDING, loading: false });
  mock.timers.tick(PROBE_SETTLE_MS);
  assert.equal(probes, 1);
  for (const state of load(LANDING)) gate.navigated(state);
  mock.timers.tick(PROBE_SETTLE_MS);
  assert.equal(probes, 2);
});

test('the login page itself, and a gate cancelled with its sheet, never probe', () => {
  visit(load(LOGIN));
  visit([...load(LOGIN), ...load('https://bandcamp.com/login?from=menubar')]);
  visit([...load(LANDING)]).cancel();
  mock.timers.tick(PROBE_SETTLE_MS);
  assert.equal(probes, 0);
});
