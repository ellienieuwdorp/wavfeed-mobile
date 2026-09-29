/**
 * The pure half of the action Tallies (task 0038, the plan's catalogue): the door a push to Connect names, one
 * `sign_in_finished` per Connect visit, a Wishlist Action's codes, a play's start, and the listening one Release gets
 * from its first Track to its end or its replacement. Screens and the player hand the results to the sharing
 * provider's `track`. Times are arguments; nothing here reads a clock.
 */
import { CATALOGUE, type Screen, type Tally, type TallyName, type TallyProps } from './catalogue';
import { countBucket, crumbReplaysBucket, durationBucket } from './tally';

type TallyOf<N extends TallyName> = Extract<Tally, { readonly name: N }>;

export type ConnectFrom = TallyProps<'connect_opened'>['from'];
const CONNECT_FROM: readonly string[] = CATALOGUE.connect_opened.props.from;

/** Where each of the five doors pushes: Connect with its door as the `from` param, a closed code. */
export function connectHref(from: ConnectFrom): { readonly pathname: '/connect'; readonly params: { readonly from: ConnectFrom } } {
  return { pathname: '/connect', params: { from } };
}

/** The `from` route param each push to Connect sets; a deep link without one is no door and makes no Tally. */
export function connectFrom(param: unknown): ConnectFrom | null {
  return typeof param === 'string' && CONNECT_FROM.includes(param) ? (param as ConnectFrom) : null;
}

type SignInOutcome = TallyProps<'sign_in_finished'>['outcome'];
export type SignInFailure = Exclude<SignInOutcome, 'signed_in' | 'closed'>;

/**
 * One Connect visit. A failure line leaves the page up for another try, so it is only remembered; the visit ends once,
 * signed in or left, and a visit left after a failure reports the last one, else `closed`.
 */
export type SignInVisit = {
  readonly openedAt: number;
  readonly hadIdentity: boolean;
  readonly failure: SignInFailure | null;
  readonly done: boolean;
};

export function openSignIn(openedAt: number, hadIdentity: boolean): SignInVisit {
  return { openedAt, hadIdentity, failure: null, done: false };
}

export function failSignIn(visit: SignInVisit, failure: SignInFailure): SignInVisit {
  return visit.done ? visit : { ...visit, failure };
}

export function finishSignIn(
  visit: SignInVisit,
  how: 'signed_in' | 'left',
  now: number,
): { visit: SignInVisit; tally: TallyOf<'sign_in_finished'> | null } {
  if (visit.done) return { visit, tally: null };
  const outcome: SignInOutcome = how === 'signed_in' ? 'signed_in' : (visit.failure ?? 'closed');
  return {
    visit: { ...visit, done: true },
    tally: { name: 'sign_in_finished', props: { outcome, had_identity: visit.hadIdentity, wait: durationBucket(now - visit.openedAt) } },
  };
}

type WishlistProps = TallyProps<'wishlist_action_finished'>;
export type PressSurface = WishlistProps['surface'];

export type WishlistPressFacts = {
  readonly action: WishlistProps['action'];
  readonly surface: PressSurface;
  /** True when the press named a Track of its Release, not the Release itself. */
  readonly onTrack: boolean;
  /** The press's failure code, `other` when it threw, null when Bandcamp took it. */
  readonly failure: Exclude<WishlistProps['failure'], 'none'> | null;
  /** The wire's closing rule and its write count, null when no write was sent. */
  readonly wire: { readonly end: Exclude<WishlistProps['end'], 'none'>; readonly requests: number } | null;
};

export function wishlistActionFinished(press: WishlistPressFacts): TallyOf<'wishlist_action_finished'> {
  const result = press.failure !== null ? 'failed' : press.wire?.end === 'already_there' ? 'already_there' : 'done';
  return {
    name: 'wishlist_action_finished',
    props: {
      action: press.action,
      result,
      failure: press.failure ?? 'none',
      end: press.wire?.end ?? 'none',
      target: press.onTrack ? 'track' : 'release',
      surface: press.surface,
      // Each write after the first is a crumb Bandcamp refused and the press replayed.
      crumb_replays: crumbReplaysBucket((press.wire?.requests ?? 1) - 1),
    },
  };
}

export type PlayResult = TallyProps<'playback_started'>['result'];

export function playbackStarted(result: PlayResult, waitMs: number, screen: Screen, retried: boolean): TallyOf<'playback_started'> {
  return { name: 'playback_started', props: { result, wait: durationBucket(waitMs), screen, retried } };
}

/** The listening one Release has had: Tracks started, and time spent playing, counted up to `playingSince`. */
export type Listening = {
  readonly release: string;
  readonly tracksStarted: number;
  readonly listenedMs: number;
  readonly playingSince: number | null;
};

/**
 * What the transport tells the count: a load for a Release (another Release's load ends the one before, the same
 * Release's reload after an error or an expiry continues it), a Track starting, playing turning on or off, and the
 * last Track ending, which ends the Release's listening.
 */
export type PlayerChange =
  | { readonly kind: 'load'; readonly release: string }
  | { readonly kind: 'start'; readonly release: string }
  | { readonly kind: 'playing'; readonly on: boolean }
  | { readonly kind: 'end' };

function settled(listening: Listening, now: number): Listening {
  if (listening.playingSince === null) return listening;
  return { ...listening, listenedMs: listening.listenedMs + Math.max(0, now - listening.playingSince), playingSince: null };
}

function listened(listening: Listening, now: number, reachedEnd: boolean): Tally {
  const done = settled(listening, now);
  return {
    name: 'release_listened',
    props: { tracks_started: countBucket(done.tracksStarted), listened: durationBucket(done.listenedMs), reached_end: reachedEnd },
  };
}

export function listenStep(
  listening: Listening | null,
  change: PlayerChange,
  now: number,
): { listening: Listening | null; tally: Tally | null } {
  switch (change.kind) {
    case 'load':
      if (listening === null) return { listening, tally: null };
      if (listening.release !== change.release) return { listening: null, tally: listened(listening, now, false) };
      return { listening: settled(listening, now), tally: null };
    case 'start':
      if (listening === null || listening.release !== change.release) {
        const ended = listening === null ? null : listened(listening, now, false);
        return { listening: { release: change.release, tracksStarted: 1, listenedMs: 0, playingSince: now }, tally: ended };
      }
      return { listening: { ...listening, tracksStarted: listening.tracksStarted + 1, playingSince: listening.playingSince ?? now }, tally: null };
    case 'playing':
      if (listening === null) return { listening, tally: null };
      if (!change.on) return { listening: settled(listening, now), tally: null };
      return { listening: listening.playingSince === null ? { ...listening, playingSince: now } : listening, tally: null };
    case 'end':
      return listening === null ? { listening, tally: null } : { listening: null, tally: listened(listening, now, true) };
  }
}
