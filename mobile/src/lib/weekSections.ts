/**
 * Weeks and the quiet runs between them (ADR-0011: Monday to Sunday, newest first, never an empty week section), and the
 * Upcoming band's weeks read forwards with no gaps (DESIGN-UI section 3). Ported from
 * server/apps/web/src/components/weeks/weekSections.ts with its function names (task 0036, decision 3).
 */
import { gapLabel, upcomingWeekHeading, weekDetail, weekHeading } from '@/copy';

import { addDays, startOfWeek, toDate, weeksBetween } from './dates';

export type WeekSection<T> = {
  readonly kind: 'week';
  readonly key: string;
  readonly heading: string;
  readonly detail: string;
  readonly entries: readonly T[];
};

export type GapSection = {
  readonly kind: 'gap';
  readonly key: string;
  readonly label: string;
};

export type WeekOrGap<T> = WeekSection<T> | GapSection;

export type GroupedWeek<T> = {
  readonly start: Date;
  readonly entries: readonly T[];
};

/** Weeks that arrive grouped keep their order; an empty week is closed over by the quiet run. */
export function buildSectionsFromWeeks<T>(weeks: readonly GroupedWeek<T>[], now: Date): readonly WeekOrGap<T>[] {
  const kept = [...weeks]
    .filter((week) => week.entries.length > 0 && !Number.isNaN(week.start.getTime()))
    .sort((a, b) => b.start.getTime() - a.start.getTime());
  const sections: WeekOrGap<T>[] = [];
  let previousStart: Date | null = null;
  for (const week of kept) {
    if (previousStart !== null) {
      const missing = weeksBetween(week.start, previousStart) - 1;
      if (missing >= 1) {
        const gapStart = addDays(week.start, 7);
        sections.push({
          kind: 'gap',
          key: `gap:${gapStart.getTime()}`,
          label: gapLabel(gapStart, addDays(previousStart, -1), missing, now),
        });
      }
    }
    sections.push({
      kind: 'week',
      key: `week:${week.start.getTime()}`,
      heading: weekHeading(week.start, now),
      detail: weekDetail(week.start, addDays(week.start, 6), now),
      entries: week.entries,
    });
    previousStart = week.start;
  }
  return sections;
}

/**
 * Sections over every week held, narrowed to the entries a filter keeps (task 0071, decision 8): a week the filter
 * empties drops out and becomes no quiet run, so a gap still names only weeks that held nothing at all, and as before
 * a gap stands only between two weeks.
 */
export function narrowSections<T>(sections: readonly WeekOrGap<T>[], keeps: (entry: T) => boolean): readonly WeekOrGap<T>[] {
  const narrowed: WeekOrGap<T>[] = [];
  for (const section of sections) {
    if (section.kind === 'gap') {
      if (narrowed.length > 0) narrowed.push(section);
      continue;
    }
    const entries = section.entries.filter(keeps);
    if (entries.length > 0) narrowed.push({ ...section, entries });
  }
  while (narrowed.at(-1)?.kind === 'gap') narrowed.pop();
  return narrowed;
}

/** Nearest first between and inside weeks, no quiet runs, headed forwards. */
export function buildUpcomingWeekSections<T>(
  items: readonly T[],
  dateOf: (item: T) => string | Date,
  now: Date,
): readonly WeekSection<T>[] {
  const time = (item: T): number => toDate(dateOf(item)).getTime();
  const buckets = new Map<number, { readonly start: Date; readonly entries: T[] }>();
  for (const item of items) {
    if (Number.isNaN(time(item))) continue;
    const start = startOfWeek(dateOf(item));
    const bucket = buckets.get(start.getTime());
    if (bucket === undefined) buckets.set(start.getTime(), { start, entries: [item] });
    else bucket.entries.push(item);
  }
  return [...buckets.values()]
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((week) => ({
      kind: 'week' as const,
      key: `upcoming:${week.start.getTime()}`,
      heading: upcomingWeekHeading(week.start, now),
      detail: weekDetail(week.start, addDays(week.start, 6), now),
      entries: [...week.entries].sort((a, b) => time(a) - time(b)),
    }));
}
