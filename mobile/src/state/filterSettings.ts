/**
 * The New releases filter's settings on this install (task 0071, decisions 5 to 9): whether it is on, the people
 * minimum and its switch, and the chosen tags, kept as one JSON value in the `kv` table so they outlive a launch; a
 * rebuild of the Projection leaves them standing, as it does the walk state. No row means nothing was ever saved, and
 * the circle's first tap then opens the sheet at the first settings (people on at 2+, no tags, as the flow board draws
 * it). A tap with settings saved only turns the filter on or off. A value this code did not write, or a minimum the
 * stepper cannot show, is read back inside the stepper's range or not at all.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { clampMinimum, type ReleaseFilter, type TagCount } from '@/domain/releaseFilter';
import { readKv, writeKv } from '@/store/kv';

export const FILTER_KEY = 'releases_filter';

export type FilterSettings = {
  readonly on: boolean;
  readonly people: { readonly on: boolean; readonly min: number };
  /** Tag norm names, any of them. */
  readonly tags: readonly string[];
};

/** What the sheet opens at the first time, and what Reset returns to. */
export const FIRST_SETTINGS: FilterSettings = { on: true, people: { on: true, min: 2 }, tags: [] };

/** Whether the settings choose anything at all: with neither the people switch nor a tag, nothing is filtered. */
export function choosesAnything(settings: Pick<FilterSettings, 'people' | 'tags'>): boolean {
  return settings.people.on || settings.tags.length > 0;
}

/** Whether the filter draws as on: the circle tinted, the "Filtered by" pill under the title, the list filtered. */
export function isActive(settings: FilterSettings | null): boolean {
  return settings !== null && settings.on && choosesAnything(settings);
}

/** The filter the list applies: everything kept unless the settings are active. */
export function toReleaseFilter(settings: FilterSettings | null): ReleaseFilter {
  if (settings === null || !isActive(settings)) return { people: { on: false, min: settings?.people.min ?? FIRST_SETTINGS.people.min }, tags: [] };
  return { people: { on: settings.people.on, min: clampMinimum(settings.people.min) }, tags: settings.tags };
}

/**
 * A tap on the circle (decision 5): with nothing saved, or saved settings that choose nothing, it turns the filter on
 * and opens the sheet; otherwise it turns the filter on with the last settings, or off, and opens nothing.
 */
export function circlePress(saved: FilterSettings | null): { readonly next: FilterSettings; readonly openSheet: boolean } {
  if (saved === null) return { next: FIRST_SETTINGS, openSheet: true };
  if (!choosesAnything(saved)) return { next: { ...saved, on: true }, openSheet: true };
  return { next: { ...saved, on: !saved.on }, openSheet: false };
}

/** "Clear filters" (decision 9): the filter off and its choices back to the first ones, so every Release shows again. */
export function cleared(): FilterSettings {
  return { ...FIRST_SETTINGS, on: false };
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
  return { on: true, people: { on: true, min: clampMinimum(min) }, tags: saved?.tags ?? [] };
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
  if (typeof held.on !== 'boolean' || typeof people !== 'object' || people === null || !Array.isArray(held.tags)) return null;
  const minimum: { [key: string]: unknown } = { ...people };
  if (typeof minimum.on !== 'boolean' || typeof minimum.min !== 'number') return null;
  const tags = [...new Set(held.tags.filter((tag): tag is string => typeof tag === 'string' && tag !== ''))];
  return { on: held.on, people: { on: minimum.on, min: clampMinimum(minimum.min) }, tags };
}

export async function readFilterSettings(db: SQLiteDatabase): Promise<FilterSettings | null> {
  return parseSettings(await readKv<unknown>(db, FILTER_KEY));
}

export async function writeFilterSettings(db: SQLiteDatabase, settings: FilterSettings): Promise<void> {
  await writeKv(db, FILTER_KEY, { on: settings.on, people: { on: settings.people.on, min: clampMinimum(settings.people.min) }, tags: [...settings.tags] });
}
