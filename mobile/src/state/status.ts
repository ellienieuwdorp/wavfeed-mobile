/**
 * What every view says about gathering (DESIGN-UI section 9, in the phone's places): the line under the large title,
 * either "Updated 12 min ago" or the catch-up pair while the first walk runs, and which empty state a view with no rows
 * draws. The first walk counts as running between turns too, while its cursor is still held.
 */
import { soFar, updatedAgo, copy } from '@/copy';
import { useNow } from '@/lib/useNow';
import { readKv } from '@/store';

import { useAppState, useLiveQuery } from './appState';
import { readStoredIdentity, WALK_KEY } from './gatherSink';

export type StatusLine =
  | { readonly kind: 'updated'; readonly text: string }
  | { readonly kind: 'catchUp'; readonly primary: string; readonly secondary: string | null };

export type GatherStatus = {
  /** False until the store has answered; views draw no empty state before it. */
  readonly loaded: boolean;
  /** Whether this store has ever held a signed-in Fan. */
  readonly hasIdentity: boolean;
  readonly catchingUp: boolean;
  readonly line: StatusLine | null;
};

export function useGatherStatus(): GatherStatus {
  const { gather } = useAppState();
  const now = useNow();
  const held = useLiveQuery(async (db) => ({
    identity: await readStoredIdentity(db),
    walkPending: (await readKv(db, WALK_KEY)) !== null,
  }));
  const hasIdentity = held?.identity != null || gather.identity !== null;
  const catchingUp = hasIdentity && !gather.initialWalkDone && (gather.phase !== 'idle' || held?.walkPending === true);

  let line: StatusLine | null = null;
  if (catchingUp) {
    line =
      gather.storiesSoFar === 0 && gather.phase === 'probing'
        ? { kind: 'catchUp', primary: copy.catchUp.settingUp, secondary: null }
        : { kind: 'catchUp', primary: soFar(gather.storiesSoFar), secondary: copy.catchUp.gathering };
  } else if (gather.lastSuccessAt !== null) {
    line = { kind: 'updated', text: updatedAgo(gather.lastSuccessAt, now) };
  }
  return { loaded: held !== null, hasIdentity, catchingUp, line };
}
