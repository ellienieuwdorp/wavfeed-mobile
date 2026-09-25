/**
 * The phone's SQLite store: Raw Documents, the derived Projection tables under the server's names minus `user_id` and triage, and the
 * Fetcher's own state (task 0036, ADR-0004). Migrations are numbered, applied once each, and recorded in `schema_migrations`.
 */
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

export type Store = { readonly db: SQLiteDatabase };

export const STORE_FILE = 'wavfeed.db';

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
];

async function migrate(db: SQLiteDatabase): Promise<number> {
  await db.execAsync(
    'create table if not exists schema_migrations (version integer primary key, applied_at text not null)',
  );
  const row = await db.getFirstAsync<{ version: number | null }>('select max(version) as version from schema_migrations');
  const current = row?.version ?? 0;
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
  return MIGRATIONS[MIGRATIONS.length - 1]?.version ?? current;
}

export async function openStore(file: string = STORE_FILE): Promise<Store> {
  const db = await openDatabaseAsync(file);
  await db.execAsync(`pragma journal_mode = wal; pragma busy_timeout = ${BUSY_TIMEOUT_MS};`);
  await migrate(db);
  return { db };
}
