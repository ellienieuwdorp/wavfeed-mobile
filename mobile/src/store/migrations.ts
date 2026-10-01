/**
 * The store's numbered migrations and the runner that applies each once, recorded in `schema_migrations` (task 0036,
 * ADR-0004). Kept apart from `openStore` so a Node check can build the same store over `node:sqlite`. Migrations ship
 * over the air with the JavaScript, and expo-updates can roll a phone back to an older bundle that runs on the newer
 * schema, so every migration is additive only: new tables and new columns with defaults, never a rename, a drop or a
 * changed meaning. A store newer than the code is reported and opened as it is (review finding ARCH-13).
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { reportCode } from '../tally/errors';

/** A fold transaction on its own connection waits this long for the Fetcher's write, and the other way round. */
export const BUSY_TIMEOUT_MS = 5000;

type Migration = { readonly version: number; readonly sql: string };

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      create table raw_documents (
        id integer primary key,
        endpoint text not null,
        payload text not null,
        fetched_at text not null,
        content_hash text not null,
        unique (endpoint, content_hash)
      );
      create index raw_documents_release_key
        on raw_documents (json_extract(payload, '$.itemType'), json_extract(payload, '$.itemId'))
        where endpoint = 'release_page';

      create table fans (
        fan_id integer primary key,
        username text not null,
        name text,
        location text,
        image_id integer,
        first_seen_at text not null,
        last_seen_at text not null
      );

      create table pages (
        band_id integer primary key,
        name text not null,
        url text,
        image_id integer,
        genre_id integer,
        first_seen_at text not null,
        last_seen_at text not null
      );

      create table releases (
        item_type text not null,
        item_id integer not null,
        band_id integer not null,
        title text not null,
        url text not null,
        album_id integer,
        album_title text,
        art_id integer,
        release_date text,
        label text,
        label_id integer,
        price real,
        currency text,
        featured_track_id integer,
        featured_track_title text,
        featured_track_duration real,
        num_streamable_tracks integer,
        also_collected_count integer,
        is_preorder integer not null default 0,
        tags text not null default '[]',
        first_seen_at text not null,
        last_seen_at text not null,
        primary key (item_type, item_id)
      );
      create index releases_band_id on releases (band_id);
      create index releases_release_date on releases (release_date);

      create table stories (
        id integer primary key,
        story_type text not null,
        fan_id integer,
        fan_key integer not null,
        item_type text not null,
        item_id integer not null,
        story_date text not null,
        raw_document_id integer not null,
        review_text text,
        unique (story_type, fan_key, item_type, item_id)
      );
      create index stories_item on stories (item_type, item_id);
      create index stories_story_date on stories (story_date);

      create table follows (
        band_id integer primary key,
        first_seen_at text not null,
        last_seen_at text not null
      );

      create table wishlist_items (
        item_type text not null,
        item_id integer not null,
        band_id integer,
        added_at text,
        last_seen_snapshot_at text not null,
        primary key (item_type, item_id)
      );

      create table band_sweeps (
        band_id integer primary key,
        last_swept_at text,
        tier text not null default 'cold',
        failures integer not null default 0
      );

      create table projection_progress (
        endpoint text primary key,
        last_raw_id integer not null
      );

      create table kv (
        key text primary key,
        value text not null
      );
    `,
  },
  {
    version: 2,
    sql: `
      create table release_page_attempts (
        item_type text not null,
        item_id integer not null,
        attempted_at text not null,
        outcome text not null,
        failures integer not null default 0,
        primary key (item_type, item_id)
      );
    `,
  },
  {
    // Feed pokes stored before the extract held the page's HTML and its crumbs; nothing folds them, so they go, and
    // secure_delete zeroes the freed pages (ADR-0003, ADR-0004 amendment 2026-09-29).
    version: 3,
    sql: `
      pragma secure_delete = on;
      delete from raw_documents where endpoint = 'fan_feed_page' and json_extract(payload, '$.html') is not null;
      pragma secure_delete = off;
    `,
  },
  {
    // The Tally outbox: built, scrubbed Tallies and Error Reports waiting to be sent after the Fan's yes, device state
    // a rebuild leaves alone and "Remove everything gathered" takes with the file (task 0038, ADR-0021).
    version: 4,
    sql: `
      create table tally_outbox (
        seq integer primary key,
        kind text not null check (kind in ('tally', 'error')),
        body text not null,
        created_at integer not null,
        batch text
      );
      create index tally_outbox_batch on tally_outbox (batch);
    `,
  },
  {
    // Where each release date came from and when it was read, and how many Tracks a release page names (task 0041,
    // decisions 1 and 4). The rows held already fill in when PROJECTION_VERSION 3 replays the Raw Documents (decision 2).
    version: 5,
    sql: `
      alter table releases add column release_date_source text;
      alter table releases add column release_date_read_at text;
      alter table releases add column num_tracks integer;
    `,
  },
  {
    // Drops, and on each Upcoming Release the newest count of Tracks that play the feed and a release page stated and
    // when, which date a Drop and make its page due (task 0041, decisions 6 to 8). A Drop's `day` is a GMT day;
    // `after_read_at` and `read_at` are the reads that showed fewer and more, `track_at` the Track page moment that
    // dated it, `track_ids` the Tracks it let out in track order. PROJECTION_VERSION 4 replays them in (ADR-0004).
    version: 6,
    sql: `
      create table drops (
        item_type text not null,
        item_id integer not null,
        day text not null,
        num_streamable_tracks integer not null,
        num_tracks integer,
        track_ids text not null default '[]',
        read_at text not null,
        after_read_at text,
        track_at text,
        dated_by text not null,
        primary key (item_type, item_id, day)
      );
      create index drops_day on drops (day);
      alter table releases add column feed_tracks_out integer;
      alter table releases add column feed_tracks_read_at text;
      alter table releases add column page_tracks_out integer;
      alter table releases add column page_tracks_read_at text;
    `,
  },
  {
    // Release pages are asked for as a desktop browser from here on (task 0041, decision 11). Each booking held already
    // is the phone's, so `asked_as_phone` marks it, the next booking clears it, and a page so marked is due once more
    // (enrichment.ts).
    version: 7,
    sql: `
      alter table release_page_attempts add column asked_as_phone integer not null default 0;
      update release_page_attempts set asked_as_phone = 1;
    `,
  },
  {
    // The documents whose fold threw, each rolled back and passed so the ones after it still fold; derived, so a
    // rebuild empties it and retries each (review finding ARCH-M1, projection.ts).
    version: 8,
    sql: `
      create table projection_failures (
        raw_document_id integer primary key,
        endpoint text not null,
        error text not null
      );
    `,
  },
];

export async function migrate(db: SQLiteDatabase): Promise<number> {
  await db.execAsync(
    'create table if not exists schema_migrations (version integer primary key, applied_at text not null)',
  );
  const row = await db.getFirstAsync<{ version: number | null }>('select max(version) as version from schema_migrations');
  const current = row?.version ?? 0;
  const latest = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
  if (current > latest) reportCode('schema_newer', new Error(`store schema ${current} is newer than the code's ${latest}`));
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.sql);
      await db.runAsync('insert into schema_migrations (version, applied_at) values (?, ?)', [
        migration.version,
        new Date().toISOString(),
      ]);
    });
  }
  return latest;
}
