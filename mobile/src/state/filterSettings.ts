/**
 * The New releases filter's settings on this install (task 0071, decisions 5 to 9 as amended 2026-10-14): the people
 * switch with its minimum, and the chosen tags, kept as one JSON value in the `kv` table so they outlive a launch; a
 * rebuild of the Projection leaves them standing, as it does the walk state. Nothing is applied by default and there is
 * no separate on or off: the filter is active when the people switch is on or a tag is chosen. No row reads as nothing
 * chosen, the stepper ready at 2. A value this code did not write, or a minimum the stepper cannot show, is read back
 * inside the stepper's range or not at all; a value saved while the filter had its own switch reads as nothing chosen
 * when that switch was off.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { clampMinimum, type ReleaseFilter, type TagCount } from '@/domain/releaseFilter';
import { readKv, writeKv } from '@/store/kv';

export const FILTER_KEY = 'releases_filter';

export type FilterSettings = ReleaseFilter;

/** The first open, "Clear" in the sheet and "Clear filters": the people switch off at 2, no tags (Open 10 keeps 2). */
export const NOTHING_CHOSEN: FilterSettings = { people: { on: false, min: 2 }, tags: [] };

/** Whether the filter is active: the button tinted, the "Filtered by" pill under the title, the list filtered. */
export function isActive(settings: FilterSettings | null): boolean {
  return settings !== null && (settings.people.on || settings.tags.length > 0);
}

/** The filter the list applies, the saved settings with the minimum inside the stepper's range. */
export function toReleaseFilter(settings: FilterSettings | null): ReleaseFilter {
  const held = settings ?? NOTHING_CHOSEN;
  return { people: { on: held.people.on, min: clampMinimum(held.people.min) }, tags: held.tags };
}

/** The settings with one tag chosen or unchosen; choosing a tag already chosen leaves it once. */
export function withTag(settings: FilterSettings, tag: string, on: boolean): FilterSettings {
  const rest = settings.tags.filter((t) => t !== tag);
  return { people: settings.people, tags: on ? [...rest, tag] : rest };
}

/**
 * Feed's "Bought by people you follow" link (Open 8): New releases with the people filter on at the link's minimum,
 * 1+ from Feed, keeping the tags the Fan chose. A `people` value that is no number leaves the settings as they were.
 */
export function withPeopleLink(saved: FilterSettings | null, people: string | string[] | undefined): FilterSettings | null {
  const raw = Array.isArray(people) ? people[0] : people;
  if (raw === undefined || raw.trim() === '') return saved;
  const min = Number(raw);
  if (!Number.isFinite(min)) return saved;
  return { people: { on: true, min: clampMinimum(min) }, tags: saved?.tags ?? [] };
}

/**
 * What the "Filtered by" pill and "Nothing matches" name (decisions 6 and 9): the minimum with the people switch on,
 * and the chosen tags by the names the view shows, in the order they were chosen.
 */
export function namedFilter(settings: FilterSettings, tags: readonly TagCount[]): { readonly min: number | null; readonly tags: readonly string[] } {
  const names = new Map(tags.map((tag) => [tag.normName, tag.name]));
  return { min: settings.people.on ? clampMinimum(settings.people.min) : null, tags: settings.tags.map((tag) => names.get(tag) ?? tag) };
}

/** Saved settings as this code wrote them, else null; a minimum out of the stepper's range is brought inside it. */
export function parseSettings(value: unknown): FilterSettings | null {
  if (typeof value !== 'object' || value === null) return null;
  const held: { [key: string]: unknown } = { ...value };
  const people: unknown = held.people;
  if (typeof people !== 'object' || people === null || !Array.isArray(held.tags)) return null;
  const minimum: { [key: string]: unknown } = { ...people };
  if (typeof minimum.on !== 'boolean' || typeof minimum.min !== 'number') return null;
  const min = clampMinimum(minimum.min);
  // The switch the filter had until 2026-10-14: saved off, it applied nothing, so it reads as nothing chosen.
  if (held.on !== undefined && typeof held.on !== 'boolean') return null;
  if (held.on === false) return { people: { on: false, min }, tags: [] };
  const tags = [...new Set(held.tags.filter((tag): tag is string => typeof tag === 'string' && tag !== ''))];
  return { people: { on: minimum.on, min }, tags };
}

export async function readFilterSettings(db: SQLiteDatabase): Promise<FilterSettings | null> {
  return parseSettings(await readKv<unknown>(db, FILTER_KEY));
}

export async function writeFilterSettings(db: SQLiteDatabase, settings: FilterSettings): Promise<void> {
  await writeKv(db, FILTER_KEY, { people: { on: settings.people.on, min: clampMinimum(settings.people.min) }, tags: [...settings.tags] });
}
