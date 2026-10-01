/**
 * Every user-visible string in the phone app. DESIGN-UI section 8 governs them: middots between facts, no em dashes,
 * "pages you follow", and no machine nouns; gather is the verb. The week, signal, curated, Bought and catch-up phrases
 * are ported from the web's weekCopy.ts, lib/format.ts, browseCopy.ts, curatedCopy.ts, boughtCopy.ts and syncCopy.ts
 * under their function names (task 0036, decision 3).
 */
import { Platform } from 'react-native';

import type { ApiFanRef } from '@/domain/apiTypes';
import type { GatherPhase } from '@/fetcher/sink';
import {
  calendarDaysBetween,
  formatDatePart,
  formatDateRange,
  isSameDay,
  startOfWeek,
  toDate,
  weeksBetween,
} from '@/lib/dates';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/lib/time';

const ios = Platform.OS === 'ios';
const thisDevice = ios ? 'this iPhone' : 'this phone';
const ThisDevice = ios ? 'This iPhone' : 'This phone';

export const sep = ' · ';

const LONG_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function joinMiddot(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(sep);
}

function elapsedMs(value: string | Date | number, now: Date): number {
  return Math.max(0, now.getTime() - (typeof value === 'number' ? value : toDate(value).getTime()));
}

/** "12 min ago", "3 hours ago", "just now": the tail of every freshness line. */
function agoPhrase(value: string | Date | number, now: Date): string {
  const ms = elapsedMs(value, now);
  if (ms < MINUTE_MS) return 'just now';
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)} min ago`;
  if (ms < DAY_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.floor(ms / DAY_MS);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

function sameWeek(a: Date, b: Date): boolean {
  return startOfWeek(a).getTime() === startOfWeek(b).getTime();
}

// Weeks (web weekCopy.ts).

const NUMBER_WORDS = ['', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

export function quietWeeksPhrase(weeks: number): string {
  if (weeks === 1) return 'a quiet week';
  return `${NUMBER_WORDS[weeks] ?? weeks} quiet weeks`;
}

/** New releases' quiet runs are quiet about your pages; Bought's say the dates and stop. */
export const PAGES_GAP_TAIL = ', nothing from your pages';

export function gapLabel(start: Date, end: Date, weeks: number, now: Date, tail: string = PAGES_GAP_TAIL): string {
  return `${formatDateRange(start, end, now)}${sep}${quietWeeksPhrase(weeks)}${tail}`;
}

function weekOf(start: Date, now: Date): string {
  return `Week of ${formatDatePart(start, { year: start.getFullYear() !== now.getFullYear() })}`;
}

export function weekHeading(start: Date, now: Date): string {
  const distance = weeksBetween(start, startOfWeek(now));
  if (distance === -1) return 'Next week';
  if (distance === 0) return 'This week';
  if (distance === 1) return 'Last week';
  return weekOf(start, now);
}

export const UPCOMING_HEAD = 'Upcoming';

/** The same week said forwards: the days of this week not yet out are "Later this week". */
export function upcomingWeekHeading(start: Date, now: Date): string {
  const distance = weeksBetween(start, startOfWeek(now));
  if (distance === 0) return 'Later this week';
  if (distance === -1) return 'Next week';
  return weekOf(start, now);
}

export function weekDetail(start: Date, end: Date, now: Date): string {
  return formatDateRange(start, end, now, { weekday: true });
}

/** "Today", "Wed 19", "Tue 21 Jul". */
export function dayLabel(value: string | Date, now: Date): string {
  const date = toDate(value);
  if (isSameDay(date, now)) return 'Today';
  return formatDatePart(date, {
    month: date.getMonth() !== now.getMonth() || date.getFullYear() !== now.getFullYear(),
    weekday: true,
    year: date.getFullYear() !== now.getFullYear(),
  });
}

/**
 * "1 of 4 tracks": the Tracks of an Upcoming Release that play, once one does and the total is known (task 0041,
 * decision 9); a total under the count is not a known one. Counted by the total, so "1 of 1 track".
 */
export function tracksOutPhrase(out: number | null, total: number | null): string | null {
  if (out === null || total === null || out < 1 || out > total) return null;
  return `${out} of ${total} ${total === 1 ? 'track' : 'tracks'}`;
}

/**
 * "out Tue 13 Oct" (task 0041, decision 10), "out today" on the day. The month always shows, unlike in dayLabel, since a
 * Drop row sits under the week it was let out in, often another month's (finding VIS-6).
 */
export function outOnPhrase(value: string | Date, now: Date): string {
  if (isSameDay(value, now)) return 'out today';
  const date = toDate(value);
  return `out ${formatDatePart(date, { weekday: true, year: date.getFullYear() !== now.getFullYear() })}`;
}

/**
 * The player sheet's line under its title: the artist, then the Release's title unless the title line already says it,
 * as it does before a Track loads and for a single named like its Release (finding VIS-17).
 */
export function sheetSubtitle(artist: string, releaseTitle: string, trackTitle: string | null): string {
  const same = trackTitle === null || trackTitle.trim().toLowerCase() === releaseTitle.trim().toLowerCase();
  return same ? artist : artist + sep + releaseTitle;
}

/** The facts a play control speaks after its title, comma separated as speech reads them. */
export function spokenFacts(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(', ');
}

// Signal sentences (web lib/format.ts and browseCopy.ts).

const WEEKS_AGO_LIMIT = 3;

export function formatAge(value: string | Date, now: Date): string {
  const ms = elapsedMs(value, now);
  if (ms < MINUTE_MS) return 'now';
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)}m`;
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)}h`;
  const days = Math.floor(ms / DAY_MS);
  if (days < 7) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 365)}y`;
}

export function formatDayLabel(value: string | Date, now: Date): string {
  const days = calendarDaysBetween(value, now);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  const then = toDate(value);
  if (days < 7) return LONG_WEEKDAYS[then.getDay()] ?? '';
  const weeks = weeksBetween(startOfWeek(then), startOfWeek(now));
  if (weeks === 1) return 'last week';
  if (weeks <= WEEKS_AGO_LIMIT) return `${weeks} weeks ago`;
  if ((now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth()) === 1) return 'last month';
  const year = then.getFullYear() === now.getFullYear() ? '' : ` ${then.getFullYear()}`;
  return `${then.getDate()} ${SHORT_MONTHS[then.getMonth()] ?? ''}${year}`;
}

export function releasedPhrase(value: string | Date, now: Date): string {
  return `released ${formatDayLabel(value, now)}`;
}

export const NAMED_FANS_LIMIT = 2;

export function fanName(fan: ApiFanRef): string {
  return fan.username;
}

export function describeFans(fans: readonly ApiFanRef[]): string | null {
  const first = fans[0];
  if (first === undefined) return null;
  if (fans.length > NAMED_FANS_LIMIT) return `${fans.length} you follow`;
  const others = fans.length - 1;
  if (others === 0) return fanName(first);
  return `${fanName(first)} and ${others} ${others === 1 ? 'other' : 'others'}`;
}

export type SignalSource = {
  readonly hasNewRelease: boolean;
  readonly releaseDate: string | null;
  readonly latestStoryDate: string;
  readonly buyers: readonly ApiFanRef[];
  readonly wishlisters: readonly ApiFanRef[];
};

/** "bought by dj_okonkwo and 1 other", "released Wednesday · 3 you follow bought it". */
export function signalSentence(item: SignalSource, now: Date): string {
  const parts: string[] = [];
  if (item.hasNewRelease) parts.push(releasedPhrase(item.releaseDate ?? item.latestStoryDate, now));
  const buyers = describeFans(item.buyers);
  if (buyers !== null) parts.push(parts.length === 0 ? `bought by ${buyers}` : `${buyers} bought it`);
  const wishlisters = describeFans(item.wishlisters);
  if (wishlisters !== null) parts.push(parts.length === 0 ? `wishlisted by ${wishlisters}` : `${wishlisters} wishlisted it`);
  return joinMiddot(parts);
}

/** A Release only the sweep knows has no actor, so it carries no sentence (DESIGN-UI section 3). */
export function actorSentence(item: Pick<SignalSource, 'buyers' | 'wishlisters'>): string {
  const buyers = describeFans(item.buyers);
  if (buyers !== null) return `bought by ${buyers}`;
  const wishlisters = describeFans(item.wishlisters);
  return wishlisters === null ? '' : `wishlisted by ${wishlisters}`;
}

export const SELF_RELEASED = 'self-released';

// The Curated Feed (web curatedCopy.ts).

export function purchaseWindowPhrase(value: string | Date, now: Date): string {
  const days = calendarDaysBetween(value, now);
  if (days <= 0) return 'today';
  const day = toDate(value).getDay();
  const today = now.getDay();
  if (days < 7 && (day === 6 || day === 0) && (today === 1 || today === 2)) return 'over the weekend';
  if (days < 7) return 'in the past week';
  return 'in the past two weeks';
}

export function followedBuyersPhrase(count: number): string {
  return `${count} ${count === 1 ? 'person' : 'people'} you follow`;
}

export function buyersPhrase(fans: readonly ApiFanRef[]): string {
  if (fans.length > NAMED_FANS_LIMIT) return followedBuyersPhrase(fans.length);
  const [first, second] = fans;
  if (first === undefined) return followedBuyersPhrase(0);
  if (second === undefined) return fanName(first);
  return `${fanName(first)} and ${fanName(second)}`;
}

export function boughtThisPhrase(value: string | Date, now: Date): string {
  return ` bought this ${purchaseWindowPhrase(value, now)}`;
}

function absoluteDayPhrase(then: Date, now: Date): string {
  const year = then.getFullYear() === now.getFullYear() ? '' : ` ${then.getFullYear()}`;
  return `${SHORT_WEEKDAYS[then.getDay()] ?? ''} ${then.getDate()} ${SHORT_MONTHS[then.getMonth()] ?? ''}${year}`;
}

export function humanDayPhrase(value: string | Date, now: Date): string {
  const then = toDate(value);
  const days = calendarDaysBetween(then, now);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (sameWeek(then, now)) return LONG_WEEKDAYS[then.getDay()] ?? '';
  return absoluteDayPhrase(then, now);
}

function upcomingDayPhrase(then: Date, now: Date): string {
  if (calendarDaysBetween(then, now) === -1) return 'tomorrow';
  if (sameWeek(then, now)) return LONG_WEEKDAYS[then.getDay()] ?? '';
  return absoluteDayPhrase(then, now);
}

/** "released Wed 19 Aug", or "releases Fri 18 Sep" for one not out yet. */
export function releasedOnPhrase(releaseDate: string | Date | null, announcedOn: string | Date, now: Date): string {
  if (releaseDate === null) return `released ${humanDayPhrase(announcedOn, now)}`;
  const then = toDate(releaseDate);
  if (calendarDaysBetween(then, now) < 0) return `releases ${upcomingDayPhrase(then, now)}`;
  return `released ${humanDayPhrase(then, now)}`;
}

export function boughtOnPhrase(value: string | Date, now: Date): string {
  return `bought ${humanDayPhrase(value, now)}`;
}

export function quotedReview(text: string): string {
  return `“${text.trim()}”`;
}

// Bought (web boughtCopy.ts).

export type BoughtMode = 'released' | 'crossed';

export const BOUGHT_TOP_ENTRIES = 3;
export const BOUGHT_THRESHOLDS: readonly number[] = [2, 3, 4, 5];
export const DEFAULT_BOUGHT_THRESHOLD = 2;

export function thresholdOptionLabel(count: number): string {
  return `${count}+ you follow`;
}

export function expanderLabel(expanded: boolean, total: number): string {
  return expanded ? `Show top ${BOUGHT_TOP_ENTRIES}` : `Show all ${total}`;
}

// The catch-up and freshness line (web syncCopy.ts and useCatchUp.ts).

/** "Updated 12 min ago", under each large title. */
export function updatedAgo(at: number, now: Date): string {
  return `Updated ${agoPhrase(at, now)}`;
}

export function soFar(count: number): string {
  return `${new Intl.NumberFormat().format(count)} so far`;
}

/** "back to March 2021": how far the first walk has reached, a unix-seconds Story date in local time as ADR-0011 reads dates (task 0040). */
export function backTo(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return `back to ${LONG_MONTHS[date.getMonth()] ?? ''} ${date.getFullYear()}`;
}

/**
 * "2,960 so far, back to June 2026": the catch-up as the one line under each large title while something plays (task
 * 0040, decision 6), its first letter raised as that line's other forms start.
 */
export function catchUpHeader(primary: string, secondary: string | null): string {
  const line = secondary === null ? primary : `${primary}, ${secondary}`;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

const PHASES: Readonly<Record<Exclude<GatherPhase, 'idle'>, string>> = {
  probing: 'reaching Bandcamp',
  walking: 'gathering your feed',
  lists: 'gathering your follows and wishlist',
  sweeping: 'checking pages you follow for releases',
  dating: 'adding release dates',
};

/** One address for feedback and erasure requests, the privacy page's; `hello@wavfeed.com` replaces it once that exists. */
export const FEEDBACK_ADDRESS = 'ellie@nieuwdorp.me';
export const PRIVACY_URL = 'https://wavfeed.com/privacy.html';
/** The privacy page's section on counts, where the ask's link lands: what is sent and what is never sent (task 0044 decision 3). */
export const PRIVACY_COUNTS_URL = `${PRIVACY_URL}#counts`;

/** What a feedback mail carries under the tester's words: the build, the OS and, while sharing is on, the code. */
export type FeedbackFacts = { readonly version: string; readonly build: string; readonly os: string; readonly code: string | null };

const versionLine = (version: string, build: string) => `Version ${version} (${build})`;

export const copy = {
  views: {
    feed: 'Feed',
    releases: 'New releases',
    bought: 'Bought',
    settings: 'Settings',
  },
  catchUp: {
    settingUp: 'getting set up',
    gathering: 'gathering your history',
    label: 'Catching up on your Bandcamp history',
    /** Under each large title while the first walk runs, in the slot "Updated 12 min ago" takes after it (task 0040). */
    keepOpen: 'Keep wavfeed open while it catches up',
  },
  empty: {
    nothing: 'Nothing here yet.',
    fillingReleases: 'Filling in. Releases land here as your history arrives.',
    fillingBought: 'Filling in. Purchases land here as your history arrives.',
    fillingCurated: 'Filling in. This grows as your history arrives.',
    curated: 'Nothing curated yet. It fills in as people you follow dig.',
    crossed: (threshold: number) => `Nothing yet that ${threshold} people you follow have bought.`,
    signIn: 'Sign in to Bandcamp',
  },
  feed: {
    fromPages: 'New from pages you follow',
    boughtByFollowed: 'Bought by people you follow',
    ownWords: 'In their own words',
    viewMore: 'View more',
    quoteOn: ' on ',
    quoted: quotedReview,
  },
  /** The phone's picker words and the line under it (DESIGN-UI section 3, The Bought view); the web keeps its own. */
  bought: {
    /** Each fits half an iPhone's width, and is also the segment's accessible name. */
    segment: { released: 'By release week', crossed: 'Bought by many' } satisfies Record<BoughtMode, string>,
    /** The sub tone of "Updated 12 min ago", and like it without a full stop. */
    line: {
      released: 'Releases people you follow bought, by release week',
      crossed: 'Releases multiple people you follow bought, by purchase week',
    } satisfies Record<BoughtMode, string>,
    /** The threshold menu's accessible name: CONTEXT.md keeps "buyer" off the screen. */
    thresholdLabel: 'How many people you follow bought it',
  },
  /** The Upcoming shelf's head and the title of its full list (DESIGN-UI section 3, task 0037). */
  upcoming: {
    title: UPCOMING_HEAD,
  },
  menu: {
    labelled: (label: string, value: string) => `${label}: ${value}`,
    checked: '\u2713',
  },
  /** `facts` from spokenFacts, as an Upcoming card or a Drop row adds its count and release day (task 0041). */
  play: (title: string, facts = '') => (facts === '' ? `Play ${title}` : `Play ${title}, ${facts}`),
  pause: (title: string, facts = '') => (facts === '' ? `Pause ${title}` : `Pause ${title}, ${facts}`),
  more: (n: number) => `+${n}`,
  heart: {
    add: (title: string) => `Add ${title} to your Bandcamp wishlist`,
    remove: (title: string) => `Remove ${title} from your Bandcamp wishlist`,
  },
  /** The long-press menu on a row, the canvas's four items (sections 6, 7 and 8). */
  rowMenu: {
    play: 'Play',
    add: 'Add to your Bandcamp wishlist',
    remove: 'Remove from your Bandcamp wishlist',
    open: 'Open on Bandcamp',
    share: 'Share',
    cancel: 'Cancel',
  },
  boughtBy: {
    title: 'Bought by',
    stack: (names: string) => `Bought by ${names}`,
    hint: 'Shows who bought it',
    fanPage: (username: string) => `Open ${username} on Bandcamp`,
    close: 'Close',
  },
  settings: {
    bandcampLabel: 'Bandcamp: ',
    thisDeviceHead: `Bandcamp on ${thisDevice}`,
    signedInAs: (name: string) => `Signed in as ${name}`,
    gathered: (at: number, now: Date) => `gathered ${agoPhrase(at, now)}`,
    notGatheredYet: 'not gathered yet',
    signedOut: 'Signed out on Bandcamp',
    lastGathered: (at: number, now: Date) => `last gathered ${agoPhrase(at, now)}`,
    notConnected: 'Not connected',
    notGathering: `${thisDevice} is not gathering`,
    signIn: 'Sign in to Bandcamp',
    gatherNow: 'Gather now',
    phase: (phase: GatherPhase) => (phase === 'idle' ? '' : PHASES[phase]),
    signOut: `Sign out of Bandcamp on ${thisDevice}`,
    custody: `Your Bandcamp sign-in stays on ${thisDevice} and goes when you sign out.`,
    /** In place of the custody foot after a sign-out Bandcamp never answered (review REL-3); proposed, DESIGN-UI section 8. */
    signOutUnreachable: `Bandcamp could not be reached, so your sign-in is still on ${thisDevice}. Try again when you are online.`,
    devicesHead: 'Connected devices',
    thisDevice,
    deviceName: ThisDevice,
    added: (at: Date, now: Date) => `added ${formatDatePart(at, { year: at.getFullYear() !== now.getFullYear() })}`,
    disconnect: 'Disconnect',
    appearanceHead: 'Appearance',
    appearance: { light: 'Light', dark: 'Dark', system: 'System' },
    removeAll: `Remove everything gathered on ${thisDevice}`,
    removeAllTitle: `Remove everything gathered on ${thisDevice}?`,
    /** The second sentence only while a Bandcamp sign-in is held: the Demo and a signed-out phone have none to keep. */
    removeAllBody: (signedIn: boolean) =>
      `Your feed and its history leave ${thisDevice}.${signedIn ? ' Bandcamp is not touched, and you stay signed in.' : ''}`,
    removeAllConfirm: 'Remove',
    cancel: 'Cancel',
    usageHead: 'Usage',
    share: 'Share what I use and what breaks',
    /** Two sentences at most under the switch (task 0044 decision 5); where it goes and for how long is on the privacy page. */
    usageFoot: (code: string | null) =>
      code === null
        ? 'Counts of what gets used and what breaks. Never your Bandcamp sign-in, your name or what you play.'
        : `Counts of what gets used and what breaks, never your Bandcamp sign-in, your name or what you play. Your code is ${code}; quote it if you write in.`,
    turnedOff: (code: string) => `Turned off. Your code was ${code}; quote it to have what was sent deleted.`,
    /** Under the switch when an off did not land (review SEC-2); proposed, DESIGN-UI section 8. */
    turnOffFailed: 'Sharing did not turn off and is still on. Try again in a moment.',
    privacy: 'Privacy',
    feedback: 'Send feedback',
    feedbackSubject: 'wavfeed feedback',
    feedbackBody: (facts: FeedbackFacts) =>
      `\n\n${joinMiddot([versionLine(facts.version, facts.build), facts.os, facts.code === null ? null : `code ${facts.code}`])}`,
    version: versionLine,
  },
  /** The one-time ask after a sign-in (task 0044 decisions 2 and 3); nothing is sent before its yes, and the no is never sent. */
  usageAsk: {
    title: 'May wavfeed count what gets used?',
    body: [
      'wavfeed is an early test version. Counts of what gets used and what breaks are what let it get better.',
      'Never your Bandcamp sign-in, your name or what you play. Nothing is sent until you say yes, and Settings can change your answer any time.',
    ],
    link: 'What is sent, and what is not',
    yes: 'Yes, send counts',
    no: 'No thanks',
  },
  /** The first screen, the whole app until a sign-in or the Demo (task 0044 decision 4). */
  welcome: {
    mark: 'wavfeed',
    title: 'Your Bandcamp feed, as a list of releases',
    sub: 'New from pages you follow and bought by people you follow, with previews.',
    signIn: 'Sign in to Bandcamp',
    lookAround: 'Look around first',
    custody: `Your Bandcamp sign-in stays on ${thisDevice}.`,
  },
  connect: {
    cancel: 'Cancel',
    host: 'bandcamp.com',
    refusal: (other: string | null, owner: string) =>
      `That is a different Bandcamp account${other === null ? '' : ` (${other})`}. ${ThisDevice}'s feed belongs to ${owner}.`,
    /** Each carries "Try again" beside it: a probe asked again, or the sign-in page loaded afresh (findings FLOW-5, FLOW-18). */
    unreachable: 'Bandcamp did not answer, so the sign-in is not checked yet.',
    pageFailed: "Bandcamp's sign-in did not load.",
    tryAgain: 'Try again',
  },
  /** The Demo's own lines (task 0043): under each large title, and Settings' status and foot while the store holds it. */
  demo: {
    header: 'A sample feed of real releases',
    status: 'Looking at a sample',
    statusSub: 'Real releases, made-up people',
    foot: 'Sign in and your own feed replaces the sample.',
  },
  notice: {
    signedOut: `Bandcamp signed ${thisDevice} out, so nothing new is arriving from it.`,
    signInAgain: 'Sign in again',
    dismiss: 'Dismiss',
  },
  /** The launch after an update whose parser change replays the history, shown once it takes over a second (ARCH-1). */
  replay: {
    title: 'Bringing your history up to date',
    body: 'This update reads what wavfeed gathered once more. Keep wavfeed open until it finishes.',
    done: (percent: number) => `${percent}% done`,
  },
  /**
   * What shows in place of what failed (task 0038 decision 10): a tab's screen that could not draw, the whole app when
   * the root could not, and the store that would not open, which sends nothing by itself (decision 11). Its body and
   * the start-over lines are proposed copy (review REL-4, DESIGN-UI section 8).
   */
  failed: {
    screenTitle: 'This screen did not load',
    screenBody: 'Trying again usually helps. The other tabs still work.',
    appTitle: 'wavfeed could not show this',
    appBody: 'Trying again usually helps. If it keeps happening, close wavfeed and open it again.',
    tryAgain: 'Try again',
    storeTitle: `${ThisDevice} could not open what wavfeed gathered.`,
    storeBody: 'Try again once. If it fails the same way, send a report so a person can look, or start over with an empty feed.',
    sendReport: 'Send a report by email',
    reportSubject: 'wavfeed could not open',
    /** The cause is the Error Report's scrubbed name and message, in a mail the person reads before sending. */
    reportBody: (facts: FeedbackFacts, cause: { readonly name: string; readonly message: string } | null) =>
      `\n\n${joinMiddot([
        'store_open_failed',
        cause === null ? null : [cause.name, cause.message].filter(Boolean).join(': '),
        versionLine(facts.version, facts.build),
        facts.os,
      ])}`,
    startOver: 'Start over',
    startOverTitle: `Start over on ${thisDevice}?`,
    startOverBody: `Everything wavfeed gathered leaves ${thisDevice}, and it opens on its first screen. Bandcamp is not touched.`,
    startOverConfirm: 'Start over',
    startOverFailed: 'That did not work either. Close wavfeed, open it again, then start over once more.',
    cancel: 'Cancel',
  },
  /** Dev builds only, never a release screen: the author's view of what the store holds (settings/index.tsx). */
  dev: {
    held: (
      held: { readonly documents: number; readonly stories: number; readonly releases: number; readonly follows: number },
      lastError: string | null,
    ) =>
      joinMiddot([
        `${held.documents.toLocaleString('en-GB')} documents`,
        `${held.stories.toLocaleString('en-GB')} items gathered`,
        `${held.releases.toLocaleString('en-GB')} releases`,
        `${held.follows.toLocaleString('en-GB')} pages you follow`,
        lastError === null ? null : `last error ${lastError.replaceAll('_', ' ')}`,
      ]),
  },
  player: {
    open: (title: string) => `Open the player for ${title}`,
    play: 'Play',
    pause: 'Pause',
    previous: 'Previous track',
    next: 'Next track',
    bandcampLink: 'Open on Bandcamp ↗',
    bandcampLinkLabel: 'Open on Bandcamp',
    trackTitle: (n: number, title: string) => `${n}. ${title}`,
    openOnBandcamp: (title: string) => `Open ${title} on Bandcamp`,
  },
} as const;
