/**
 * The closed Tally catalogue and the Error Report's closed lists (ADR-0021): each Tally name with its
 * append-only integer code and every property's allowed values, plus the ingest envelope's limits. The phone derives
 * its types from these objects and the ingest Worker imports this file by relative path to validate against the same
 * objects, so it imports nothing.
 */

/**
 * Bumped when a code or a value changes meaning, or the `ctx` gains a field; the Worker refuses a schema it does not
 * know. Schema 2 adds `ctx.channel`.
 */
export const SCHEMA = 2;

export const COUNT = ['0', '1', '2 to 5', '6 to 20', '21 to 100', '100+'] as const;
export const DURATION = ['<1s', '1 to 3s', '3 to 10s', '10 to 60s', '1 to 10m', '10m+'] as const;
const FLAG = [false, true] as const;

export const SCREENS = [
  'feed',
  'releases',
  'releases_upcoming',
  // Retired with Bought's tab: older bundles still send them, and no screen takes them again.
  'bought',
  'bought_upcoming',
  'settings',
  'player',
  'connect',
  'bought_by',
  'other',
] as const;

/** `PressFailure` in `src/wishlist/exchange.ts`, spelled out so this file imports nothing. */
const PRESS_FAILURES = [
  'logged_out',
  'bandcamp_rejected',
  'bandcamp_unreachable',
  'not_signed_in',
  'unknown_item',
  'not_on_release',
] as const;

/** `WishlistEnd` in `src/bandcamp/wishlist.ts`. */
const WISHLIST_ENDS = [
  'ok',
  'already_there',
  'no_answer',
  'server_status',
  'crumb_replays_spent',
  'crumb_withheld',
  'crumb_refused',
  'no_page_crumb',
  'no_crumb_map',
  'page_off_bandcamp',
  'page_no_answer',
  'page_status',
  'page_refused',
  'not_json',
  'http_401',
  'error_text',
  'no_ok_field',
] as const;

type Row = { readonly code: number; readonly props: Readonly<Record<string, readonly (string | boolean)[]>> };

/** Codes 1 to 18 in the plan's order; a retired code is never reused, and a returning row takes the next free one. */
export const CATALOGUE = {
  app_opened: { code: 1, props: { launch: ['cold', 'warm'] } },
  screen_viewed: { code: 2, props: { screen: SCREENS } },
  connect_opened: {
    code: 3,
    props: { from: ['first_run', 'empty_state', 'settings', 'signed_out_notice', 'wishlist_notice'] },
  },
  sign_in_finished: {
    code: 4,
    props: {
      outcome: ['signed_in', 'other_fan_refused', 'unreachable', 'bandcamp_error', 'page_failed', 'closed'],
      had_identity: FLAG,
      wait: DURATION,
    },
  },
  sync_run_finished: { code: 5, props: { pages: COUNT, stories: COUNT, took: DURATION } },
  gather_finished: {
    code: 6,
    props: {
      reason: ['open', 'refresh', 'timer'],
      outcome: ['done', 'out_of_budget', 'paused', 'failed'],
      turns: COUNT,
      retries: COUNT,
      walk_pending: FLAG,
      failure: ['bandcamp_unreachable', 'bandcamp_error', 'store_error', 'other_fan', 'none'],
      paused: ['logged_out', 'not_connected', 'none'],
      status_class: ['4xx', '5xx', 'none'],
      took: DURATION,
      release_pages_failed: COUNT,
      sweep_breaker_opened: FLAG,
      // Which request failed the turn, its status, and whether the feed's one retry ran.
      failed_step: ['probe', 'feed_poke', 'feed_page', 'depth_probe', 'none'],
      status_code: ['2xx', '400', '401', '403', '404', '429', 'other_4xx', '5xx', 'none'],
      feed_retried: FLAG,
    },
  },
  projection_skipped: { code: 7, props: { unparsable: COUNT, unknown_story_type: COUNT, missing_fan_info: COUNT } },
  // `bought` is retired with its tab.
  feed_refreshed: { code: 8, props: { from: ['feed', 'releases', 'bought', 'gather_now'], hit_ceiling: FLAG } },
  playback_started: {
    code: 9,
    props: { result: ['playing', 'unplayable', 'error', 'refused'], wait: DURATION, screen: SCREENS, retried: FLAG },
  },
  release_listened: { code: 10, props: { tracks_started: COUNT, listened: DURATION, reached_end: FLAG } },
  playback_failed: { code: 11, props: { stage: ['mid_track'] } },
  wishlist_action_finished: {
    code: 12,
    props: {
      action: ['add', 'remove'],
      result: ['done', 'already_there', 'failed'],
      failure: [...PRESS_FAILURES, 'other', 'none'],
      end: [...WISHLIST_ENDS, 'none'],
      target: ['release', 'track'],
      // Append only: `row` and `mini_player` lost their hearts and stay for older bundles;
      // `swipe` is the row's wishlist swipe and its snackbar's Undo.
      surface: ['row', 'row_menu', 'mini_player', 'sheet', 'tracklist', 'swipe'],
      crumb_replays: ['0', '1', '2+'],
    },
  },
  release_opened_on_bandcamp: {
    code: 13,
    props: { surface: ['row_menu', 'sheet_title', 'sheet_buy'], was_playing: FLAG },
  },
  signed_out: { code: 14, props: { result: ['ok', 'unreachable'] } },
  store_removed: { code: 15, props: {} },
  notice_shown: { code: 16, props: { code: ['wishlist_failed', 'signed_out'] } },
  app_ended_unexpectedly: { code: 17, props: {} },
  tallies_dropped: { code: 18, props: { reason: ['full', 'old', 'refused'], dropped: COUNT } },
} as const satisfies Readonly<Record<string, Row>>;

type Catalogue = typeof CATALOGUE;
export type TallyName = keyof Catalogue;
export type TallyProps<N extends TallyName> = {
  readonly [K in keyof Catalogue[N]['props']]: Catalogue[N]['props'][K] extends readonly (infer V)[] ? V : never;
};
/** One Tally as a call site builds it: a name and exactly its declared properties. */
export type Tally = { [N in TallyName]: { readonly name: N; readonly props: TallyProps<N> } }[TallyName];

export const TALLY_NAMES = Object.keys(CATALOGUE) as TallyName[];

export type Screen = (typeof SCREENS)[number];
export type CountBucket = (typeof COUNT)[number];
export type DurationBucket = (typeof DURATION)[number];

export const ENVS = ['development', 'preview', 'production'] as const;
export type Env = (typeof ENVS)[number];
export const PLATFORMS = ['ios', 'android'] as const;
export type TallyPlatform = (typeof PLATFORMS)[number];

export const ERROR_SOURCES = ['global', 'promise', 'boundary', 'code'] as const;
export type ErrorSource = (typeof ERROR_SOURCES)[number];
/**
 * `store_open_failed` travels only in the failure screen's `mailto:`, since no yes can be read then. Append only: a
 * phone on an older bundle still sends the codes it knows. `schema_newer` and `projection_newer` are a store a newer
 * bundle wrote, opened by an older one; `query_failed` is a screen's read that threw (review findings ARCH-13, ARCH-2).
 */
export const ERROR_CODES = [
  'store_open_failed',
  'projection_replay_failed',
  'fold_failed',
  'schema_newer',
  'projection_newer',
  'query_failed',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** A Tally's `flags`: the two globals that change within a session, as bits; the Worker refuses any other bit. */
export const FLAGS = { signedIn: 1, walkDone: 2 } as const;

/** The ingest contract's envelope rules, shared by the phone that builds a batch and the Worker that checks it. */
export const WIRE = {
  version: 1,
  maxTallies: 100,
  maxErrors: 20,
  maxBytes: 65_536,
  maxFrames: 50,
  maxMessage: 200,
  osMin: 10,
  osMax: 99,
  buildPattern: /^[0-9A-Za-z.]{1,20}$/,
  /** An EAS channel name as `ctx.channel` carries it from schema 2. */
  channelPattern: /^[a-z0-9-]{0,32}$/,
  errorNamePattern: /^[A-Za-z0-9_$.]{1,60}$/,
  uuidPattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
} as const;
