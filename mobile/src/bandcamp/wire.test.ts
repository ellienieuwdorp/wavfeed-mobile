/// <reference types="node" />
/**
 * The identity probe's reading of `collection_summary`: only JSON with a numeric `fan_id` is
 * signed in, only a readable answer that is not one decides signed out, and a 5xx, 403 or 429 is Bandcamp refusing,
 * which says nothing about the session (ADR-0017).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readProbe, type BandcampAnswer, type Identity, type Wire } from './wire';

const JSON_TYPE = 'application/json; charset=utf-8';
const HTML_TYPE = 'text/html; charset=utf-8';

function wire(status: number, contentType: string, text: string): Wire {
  return { status, ok: status >= 200 && status < 300, contentType, url: 'https://bandcamp.com/api/fan/2/collection_summary', text };
}

test('reads each answer the probe can get', () => {
  const signedIn = JSON.stringify({ fan_id: 4417093, collection_summary: { fan_id: 4417093, username: 'ellie' } });
  const cases: readonly [string, Wire | null, BandcampAnswer<Identity>][] = [
    ['a Fan', wire(200, JSON_TYPE, signedIn), { kind: 'ok', value: { fanId: 4417093, username: 'ellie' } }],
    ['a Fan with no handle', wire(200, JSON_TYPE, '{"fan_id":4417093}'), { kind: 'ok', value: { fanId: 4417093, username: null } }],
    ['no answer', null, { kind: 'unreachable' }],
    ['the login page', wire(200, HTML_TYPE, '<!DOCTYPE html><html>'), { kind: 'logged_out' }],
    ['JSON with no fan_id', wire(200, JSON_TYPE, '{"error":true}'), { kind: 'logged_out' }],
    ['JSON that does not parse', wire(200, JSON_TYPE, '{"fan_id":'), { kind: 'logged_out' }],
    ['a 401', wire(401, JSON_TYPE, '{}'), { kind: 'logged_out' }],
    ['a 403', wire(403, HTML_TYPE, 'Forbidden'), { kind: 'error', status: 403 }],
    ['a 429', wire(429, HTML_TYPE, 'Too Many Requests'), { kind: 'error', status: 429 }],
    ['a 503', wire(503, HTML_TYPE, ''), { kind: 'error', status: 503 }],
  ];
  for (const [name, answer, expected] of cases) assert.deepEqual(readProbe(answer), expected, name);
});
