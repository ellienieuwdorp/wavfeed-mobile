/**
 * Calendar arithmetic and the short date forms ("Mon 17 Aug", "Wed 19", "20 Jul"), in local time so a Monday to Sunday week
 * is the reader's (ADR-0011). Ported from server/apps/web/src/lib/dates.ts with its function names (task 0036, decision 3);
 * `releaseDay` and `isOutYet` live in `domain/newReleases.ts` and are re-exported from there.
 */
export { isOutYet, releaseDay } from '@/domain/newReleases';

const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** A bare wire date ("2026-08-17") as local midnight; unreadable input is an Invalid Date. */
export function parseIsoDate(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined || Number.isNaN(day)) return new Date(Number.NaN);
  return new Date(year, month - 1, day);
}

export function startOfDay(value: string | Date): Date {
  const date = toDate(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(value: Date, days: number): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days);
}

/** Midnight on the Monday of the week the date falls in (ADR-0011). */
export function startOfWeek(value: string | Date): Date {
  const date = startOfDay(value);
  return addDays(date, -((date.getDay() + 6) % 7));
}

export function isSameDay(a: string | Date, b: string | Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/** Rounded, so a daylight-saving shift cannot lose a week. */
export function weeksBetween(earlier: Date, later: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / (7 * DAY_MS));
}

/** Local midnights apart, negative for a day ahead. */
export function calendarDaysBetween(value: string | Date, now: Date): number {
  return Math.round((startOfDay(now).getTime() - startOfDay(value).getTime()) / DAY_MS);
}

export type DateFormOptions = {
  readonly weekday?: boolean;
  readonly month?: boolean;
  readonly year?: boolean;
};

/** "Mon 17 Aug", "Wed 19", "20 Jul 2025". */
export function formatDatePart(value: Date, options: DateFormOptions = {}): string {
  const parts: string[] = [];
  if (options.weekday === true) parts.push(WEEKDAY_NAMES[value.getDay()] ?? '');
  parts.push(String(value.getDate()));
  if (options.month !== false) parts.push(MONTH_NAMES[value.getMonth()] ?? '');
  if (options.year === true) parts.push(String(value.getFullYear()));
  return parts.join(' ');
}

/** "Mon 17 – Sun 23 Aug", "27 Jul – 9 Aug": the en dash DESIGN-UI section 8 allows in a date range. */
export function formatDateRange(start: Date, end: Date, now: Date, options: { readonly weekday?: boolean } = {}): string {
  const weekday = options.weekday === true;
  const crossesMonth = start.getMonth() !== end.getMonth() || start.getFullYear() !== end.getFullYear();
  const showYear = end.getFullYear() !== now.getFullYear();
  const left = formatDatePart(start, { weekday, month: crossesMonth });
  const right = formatDatePart(end, { weekday, month: true, year: showYear });
  return `${left} – ${right}`;
}
