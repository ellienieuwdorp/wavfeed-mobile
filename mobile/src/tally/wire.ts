/**
 * The ingest request as the phone builds it (ADR-0021): one Tally as `[t, name, flags, props]`, the
 * per-batch `ctx`, and the `POST /v1/batch` body assembled from outbox rows. The ingest Worker imports these shapes by
 * relative path, so this file imports only its neighbours.
 */
import { FLAGS, WIRE, type Env, type Tally, type TallyPlatform } from './catalogue';
import type { ErrorReport } from './errorReport';

/** When a Tally happened, and the two globals that ride in its `flags`. */
export type TallyAt = { readonly t: number; readonly signedIn: boolean; readonly walkDone: boolean };

export type TallyWire = readonly [t: number, name: Tally['name'], flags: number, props: Tally['props']];

export function tallyWire(tally: Tally, at: TallyAt): TallyWire {
  return [at.t, tally.name, (at.signedIn ? FLAGS.signedIn : 0) | (at.walkDone ? FLAGS.walkDone : 0), tally.props];
}

export type TallyContext = {
  readonly schema: number;
  readonly version: string;
  readonly build: string;
  readonly update: string;
  readonly env: Env;
  readonly platform: TallyPlatform;
  readonly os: number;
  /**
   * The EAS channel the binary was built for (schema 2): `production` for TestFlight and Play,
   * `apk` for the website APK, `preview` for preview builds, null in development. Schema 1 batches carry none.
   */
  readonly channel: string | null;
};

export type Envelope = {
  readonly key: string;
  readonly install: string;
  readonly batch: string;
  readonly sentAt: number;
  readonly ctx: TallyContext;
};

export type BatchBody = {
  readonly v: number;
  readonly key: string;
  readonly install: string;
  readonly batch: string;
  readonly sent_at: number;
  readonly ctx: TallyContext;
  readonly tallies: readonly TallyWire[];
  readonly errors: readonly ErrorReport[];
};

/** A row as the outbox hands it out: its `body` is the stored JSON of one `TallyWire` or one `ErrorReport`. */
export type OutboxRow = { readonly seq: number; readonly kind: 'tally' | 'error'; readonly body: string };

export function batchBody(envelope: Envelope, rows: readonly OutboxRow[]): BatchBody {
  const tallies: TallyWire[] = [];
  const errors: ErrorReport[] = [];
  for (const row of rows) {
    if (row.kind === 'tally') tallies.push(JSON.parse(row.body) as TallyWire);
    else errors.push(JSON.parse(row.body) as ErrorReport);
  }
  return {
    v: WIRE.version,
    key: envelope.key,
    install: envelope.install,
    batch: envelope.batch,
    sent_at: envelope.sentAt,
    ctx: envelope.ctx,
    tallies,
    errors,
  };
}
