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

const ios = Platform.OS === 'ios';
const thisDevice = ios ? 'this iPhone' : 'this phone';
const ThisDevice = ios ? 'This iPhone' : 'This phone';

export const sep = ' · ';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

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

/** "out Tue 13 Oct", the release day in dayLabel's form (task 0041, decision 10); "out today" on the day. */
export function outOnPhrase(value: string | Date, now: Date): string {
  return isSameDay(value, now) ? 'out today' : `out ${dayLabel(value, now)}`;
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
    custody: `${ThisDevice} gathers your feed with its own Bandcamp sign-in, on ${thisDevice}. wavfeed never receives it.`,
    devicesHead: 'Connected devices',
    thisDevice,
    deviceName: ThisDevice,
    added: (at: Date, now: Date) => `added ${formatDatePart(at, { year: at.getFullYear() !== now.getFullYear() })}`,
    disconnect: 'Disconnect',
    appearanceHead: 'Appearance',
    appearance: { light: 'Light', dark: 'Dark', system: 'System' },
    removeAll: `Remove everything gathered on ${thisDevice}`,
    removeAllTitle: `Remove everything gathered on ${thisDevice}?`,
    removeAllBody: `Your feed and everything gathered for it leave ${thisDevice}. Your Bandcamp account is not touched, and ${thisDevice} stays signed in to Bandcamp.`,
    removeAllConfirm: 'Remove',
    cancel: 'Cancel',
    usageHead: 'Usage',
    share: 'Share what I use and what breaks',
    usageFoot: (code: string | null) =>
      `When this is on, ${thisDevice} sends wavfeed counts of what gets used and a short report when something goes wrong, stored by Cloudflare in the EU. The detail goes after 90 days, which days it was used after a year. Never your Bandcamp sign-in, your name, or which releases you play.${
        code === null ? '' : ` Your code is ${code}. Quote it if you write in about a problem.`
      }`,
    turnedOff: (code: string) => `Turned off. Your code was ${code}; quote it to have what was sent deleted.`,
    privacy: 'Privacy',
    feedback: 'Send feedback',
    feedbackSubject: 'wavfeed feedback',
    feedbackBody: (facts: FeedbackFacts) =>
      `\n\n${joinMiddot([versionLine(facts.version, facts.build), facts.os, facts.code === null ? null : `code ${facts.code}`])}`,
    version: versionLine,
  },
  /** The one-time ask after Connect closes (task 0038 decision 3); nothing is sent before its yes. */
  usageAsk: {
    title: 'Before wavfeed counts anything',
    body: [
      `A few people are testing wavfeed, and it helps to know which parts get used and what breaks. If you say yes, ${thisDevice} sends counts of what gets tapped and a short report when the app hits an error.`,
      'Never your Bandcamp sign-in, your name, or which releases you play or wishlist. The counts go to wavfeed, stored by Cloudflare in the EU. The detail is deleted after 90 days, and which days the app was used after a year.',
      'Nothing is sent until you say yes here. Settings can turn it off at any time.',
    ],
    yes: 'Yes, send counts',
    notNow: 'Not now',
  },
  connect: {
    title: 'Connect Bandcamp',
    lead: `Your feed is already here. To keep it fresh from ${thisDevice}, sign in to Bandcamp once.`,
    custody: `The sign-in stays on ${thisDevice} and is used only to read your own feed and to add or remove wishlist items you press. wavfeed's server never receives it. Signing out of Bandcamp on ${thisDevice} removes it.`,
    signIn: 'Sign in to Bandcamp',
    notNow: 'Not now',
    cancel: 'Cancel',
    host: 'bandcamp.com',
    refusal: (other: string | null, owner: string) =>
      `That is a different Bandcamp account${other === null ? '' : ` (${other})`}. ${ThisDevice}'s feed belongs to ${owner}.`,
    unreachable: 'Bandcamp did not answer. Try again in a moment.',
    pageFailed: "Bandcamp's sign-in did not load. Cancel, then try again.",
  },
  notice: {
    signedOut: `Bandcamp signed ${thisDevice} out, so nothing new is arriving from it.`,
    signInAgain: 'Sign in again',
    dismiss: 'Dismiss',
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
    buy: 'Buy on Bandcamp ↗',
    buyLabel: 'Buy on Bandcamp',
    trackTitle: (n: number, title: string) => `${n}. ${title}`,
    openOnBandcamp: (title: string) => `Open ${title} on Bandcamp`,
  },
} as const;
