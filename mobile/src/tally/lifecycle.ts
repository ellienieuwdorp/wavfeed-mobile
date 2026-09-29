/**
 * `app_opened` and the foreground marker behind `app_ended_unexpectedly` (task 0038, the plan's catalogue). `lifeStep`
 * folds each AppState phase into a process-wide `Life`: the first `active` an Install sees while sharing is on is its
 * `cold` open, a return from `background` is `warm`, and `inactive` opens nothing. The marker is set at `active` and
 * cleared at `inactive` and `background`, because a swipe away in the iOS app switcher passes through `inactive` and may
 * never reach `background`. A marker still set at the next cold open, with no fatal Error Report written after it,
 * means the process died in the foreground. Every write carries `SHARING_ON`, so nothing is kept while sharing is off.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { FOREGROUND_KEY, SHARING_ON } from './outbox';

/** `coldFor` is the Install that has had its `cold` open in this process. */
export type Life = { readonly coldFor: string | null; readonly backgrounded: boolean };
export const NEW_LIFE: Life = { coldFor: null, backgrounded: false };

export type LifeStep = {
  readonly life: Life;
  readonly launch: 'cold' | 'warm' | null;
  /** True at the first cold open of the process, when the marker still speaks of the process before. */
  readonly checkEnded: boolean;
  readonly marker: 'set' | 'clear' | null;
};

/** `install` is the held Install id while the gate is open, else null. `phase` is an AppState status. */
export function lifeStep(life: Life, phase: string, install: string | null): LifeStep {
  const backgrounded = phase === 'background' ? true : phase === 'active' ? false : life.backgrounded;
  if (install === null) return { life: { ...life, backgrounded }, launch: null, checkEnded: false, marker: null };
  if (phase === 'active') {
    const launch = life.coldFor !== install ? 'cold' : life.backgrounded ? 'warm' : null;
    return { life: { coldFor: install, backgrounded }, launch, checkEnded: life.coldFor === null, marker: 'set' };
  }
  const marker = phase === 'background' || phase === 'inactive' ? 'clear' : null;
  return { life: { ...life, backgrounded }, launch: null, checkEnded: false, marker };
}

export async function setForegroundMarker(db: SQLiteDatabase, now: number): Promise<void> {
  await db.runAsync(
    `insert into kv (key, value) select ?1, ?2 where ${SHARING_ON}
     on conflict (key) do update set value = excluded.value`,
    [FOREGROUND_KEY, String(now)],
  );
}

export async function clearForegroundMarker(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('delete from kv where key = ?', [FOREGROUND_KEY]);
}

/** Reads and clears the marker: true when it was set and no fatal Error Report was written after it. */
export async function takeEndedUnexpectedly(db: SQLiteDatabase): Promise<boolean> {
  const row = await db.getFirstAsync<{ value: string }>('delete from kv where key = ? returning value', [FOREGROUND_KEY]);
  if (row === null) return false;
  const fatal = await db.getFirstAsync<{ n: number }>(
    `select count(*) as n from tally_outbox
     where kind = 'error' and json_extract(body, '$.fatal') = 1 and created_at >= ?`,
    [Number(row.value)],
  );
  return (fatal?.n ?? 0) === 0;
}
